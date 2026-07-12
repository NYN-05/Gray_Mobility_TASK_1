import express from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
app.use(express.json());

function buildResponse(primaryId: number, contacts: { id: number; email: string | null; phoneNumber: string | null }[]) {
  const emails = [...new Set(contacts.map(c => c.email).filter(e => e))];
  const phoneNumbers = [...new Set(contacts.map(c => c.phoneNumber).filter(e => e))];
  const secondaryContactIds = contacts.filter(c => c.id !== primaryId).map(c => c.id);
  return { contact: { primaryContactId: primaryId, emails, phoneNumbers, secondaryContactIds } };
}

async function identifyContact(prisma: PrismaClient, email?: string, phoneNumber?: string) {
  const e = email?.trim().toLowerCase() || null;
  const p = phoneNumber?.trim() || null;
  const contactData = { email: e, phoneNumber: p };

  return prisma.$transaction(async (tx) => {
    const matches = await tx.contact.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(e ? [{ email: e }] : []),
          ...(p ? [{ phoneNumber: p }] : []),
        ],
      },
      select: { id: true, linkedId: true, linkPrecedence: true },
      orderBy: { id: 'asc' },
    });

    if (!matches.length) {
      const contact = await tx.contact.create({
        data: { ...contactData, linkPrecedence: 'primary' },
        select: { id: true, email: true, phoneNumber: true },
      });
      return buildResponse(contact.id, [contact]);
    }

    const primaryIds = [...new Set(
      matches.map(c => c.linkPrecedence === 'primary' || c.linkedId === null ? c.id : c.linkedId!)
    )].sort((a, b) => a - b);

    const primaryId = primaryIds[0];
    const toDemote = primaryIds.slice(1);

    if (toDemote.length) {
      await tx.contact.updateMany({
        where: { linkedId: { in: toDemote }, deletedAt: null },
        data: { linkedId: primaryId },
      });
      await tx.contact.updateMany({
        where: { id: { in: toDemote }, deletedAt: null },
        data: { linkedId: primaryId, linkPrecedence: 'secondary' },
      });
    }

    const group = await tx.contact.findMany({
      where: { deletedAt: null, OR: [{ id: primaryId }, { linkedId: primaryId }] },
      select: { id: true, email: true, phoneNumber: true },
      orderBy: { createdAt: 'asc' },
    });

    const emails = new Set(group.map(c => c.email));
    const phones = new Set(group.map(c => c.phoneNumber));
    if ((!e || emails.has(e)) && (!p || phones.has(p))) {
      return buildResponse(primaryId, group);
    }

    const secondary = await tx.contact.create({
      data: { ...contactData, linkedId: primaryId, linkPrecedence: 'secondary' },
      select: { id: true, email: true, phoneNumber: true },
    });
    return buildResponse(primaryId, [...group, secondary]);
  });
}

app.post('/identify', async (req, res) => {
  try {
    const { email, phoneNumber } = req.body as { email?: string; phoneNumber?: string };
    if (!email && !phoneNumber) {
      return res.status(400).json({ error: 'email or phoneNumber is required' });
    }
    const result = await identifyContact(prisma, email, phoneNumber);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in /identify:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export { app, prisma, identifyContact };
