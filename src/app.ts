import express from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

interface IdentifyRequest {
  email?: string;
  phoneNumber?: string;
}

interface IdentifyResponse {
  contact: {
    primaryContactId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}

/**
 * Determines the root primary contact ID from a list of contacts.
 * - If a contact has linkPrecedence "primary", its id is the root.
 * - If a contact is secondary (linkedId set), its linkedId points to the root.
 * - Returns the smallest root ID among all contacts (oldest primary).
 */
function findPrimaryId(contacts: { id: number; linkPrecedence: string; linkedId: number | null }[]): number {
  const rootIds = new Set<number>();
  for (const c of contacts) {
    if (c.linkPrecedence === 'primary') {
      // This contact itself is a primary entry
      rootIds.add(c.id);
    } else if (c.linkedId !== null) {
      // Secondary contact — its linkedId points to the primary
      rootIds.add(c.linkedId);
    }
  }
  // Return the oldest primary (smallest id) among the candidates
  const sorted = Array.from(rootIds).sort((a, b) => a - b);
  return sorted[0];
}

/**
 * BFS-based traversal to collect all contacts belonging to the same identity group.
 * Starting from entryId, it queries for:
 *   1. The contact with id = entryId
 *   2. All contacts whose linkedId = entryId (direct secondaries)
 *   3. If entryId itself is a secondary, follows its linkedId up to the primary
 * Uses a visited set to avoid cycles and redundant queries.
 */
async function collectGroup(prisma: PrismaClient, entryId: number): Promise<any[]> {
  const visited = new Set<number>();
  const queue = [entryId];
  const result: any[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    // Skip if already visited AND not yet in result (prevents re-processing)
    if (visited.has(currentId) && !result.some((r) => r.id === currentId)) continue;
    visited.add(currentId);

    // Find the current contact and all contacts pointing to it
    const batch = await prisma.contact.findMany({
      where: {
        OR: [
          { id: currentId },
          { linkedId: currentId },
        ],
        deletedAt: null,
      },
    });

    for (const contact of batch) {
      // Skip non-current contacts that are already visited
      if (contact.id !== currentId && visited.has(contact.id)) continue;

      // Mark non-current contacts as visited
      if (contact.id !== currentId) {
        visited.add(contact.id);
      }
      result.push(contact);

      // Follow the linkedId chain upward (secondary → primary)
      if (contact.linkedId !== null && !visited.has(contact.linkedId)) {
        queue.push(contact.linkedId);
      }
    }
  }

  return result;
}

/**
 * Core identity reconciliation logic.
 *
 * Decision flow:
 * 1. Query database by email OR phoneNumber
 * 2. No matches → create a new PRIMARY contact
 * 3. Matches found → determine the distinct primary groups involved
 * 4. If multiple primary groups are linked → merge them (demote newer primaries to secondary)
 * 5. If the request brings new email or phone → create a SECONDARY contact under the oldest primary
 * 6. Return consolidated response with all emails, phones, and secondary IDs
 */
async function identifyContact(
  prisma: PrismaClient,
  email?: string,
  phoneNumber?: string
): Promise<IdentifyResponse> {
  // Step 1: Find all non-deleted contacts matching email OR phone
  const matchingContacts = await prisma.contact.findMany({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(phoneNumber ? [{ phoneNumber }] : []),
      ],
      deletedAt: null,
    },
    orderBy: { id: 'asc' },
  });

  // Step 2: No matches — create a new primary contact
  if (matchingContacts.length === 0) {
    const newContact = await prisma.contact.create({
      data: {
        email: email ?? null,
        phoneNumber: phoneNumber ?? null,
        linkPrecedence: 'primary',
      },
    });
    return buildResponse(newContact.id, [newContact]);
  }

  // Step 3: Collect the distinct primary groups from matching contacts
  const primaryIds = new Set<number>();
  for (const c of matchingContacts) {
    const rootId = findPrimaryId([c]);
    const group = await collectGroup(prisma, rootId);
    const groupPrimaryId = findPrimaryId(group);
    primaryIds.add(groupPrimaryId);
  }

  // Step 4: Merge if the request connects multiple primary groups
  const sortedPrimaryIds = Array.from(primaryIds).sort((a, b) => a - b);
  const oldestPrimaryId = sortedPrimaryIds[0];

  if (sortedPrimaryIds.length > 1) {
    // Demote all newer primaries to secondary and repoint their entire group
    const primariesToDemote = sortedPrimaryIds.slice(1);
    for (const demoteId of primariesToDemote) {
      const group = await collectGroup(prisma, demoteId);
      for (const c of group) {
        await prisma.contact.update({
          where: { id: c.id },
          data: {
            linkedId: oldestPrimaryId,
            // The demoted primary itself becomes secondary; its secondaries stay secondary
            linkPrecedence: c.id === demoteId ? 'secondary' : c.linkPrecedence,
          },
        });
      }
    }
  }

  // Step 5: Check if the request brings new information not yet in the group
  const fullGroup = await collectGroup(prisma, oldestPrimaryId);

  const hasNewEmail = email && !fullGroup.some((c) => c.email === email);
  const hasNewPhone = phoneNumber && !fullGroup.some((c) => c.phoneNumber === phoneNumber);

  if (hasNewEmail || hasNewPhone) {
    // Create a secondary contact to capture the new information
    await prisma.contact.create({
      data: {
        email: email ?? null,
        phoneNumber: phoneNumber ?? null,
        linkedId: oldestPrimaryId,
        linkPrecedence: 'secondary',
      },
    });
    const updatedGroup = await collectGroup(prisma, oldestPrimaryId);
    return buildResponse(oldestPrimaryId, updatedGroup);
  }

  // Step 6: No new info, return existing consolidated group
  return buildResponse(oldestPrimaryId, fullGroup);
}

/**
 * Builds the standardised IdentifyResponse from a primary ID and its group of contacts.
 * Deduplicates emails/phoneNumbers and identifies secondary contact IDs.
 */
function buildResponse(
  primaryId: number,
  contacts: any[]
): IdentifyResponse {
  const emails = Array.from(
    new Set(contacts.map((c) => c.email).filter((e): e is string => e !== null))
  );
  const phoneNumbers = Array.from(
    new Set(contacts.map((c) => c.phoneNumber).filter((p): p is string => p !== null))
  );
  const secondaryContactIds = contacts
    .filter((c) => c.id !== primaryId)
    .map((c) => c.id)
    .sort((a, b) => a - b);

  return {
    contact: {
      primaryContactId: primaryId,
      emails,
      phoneNumbers,
      secondaryContactIds,
    },
  };
}

/**
 * POST /identify
 *
 * Accepts { email?: string, phoneNumber?: string }
 * Returns consolidated contact information for the identified person.
 */
app.post('/identify', async (req, res) => {
  try {
    const { email, phoneNumber } = req.body as IdentifyRequest;

    // Both fields cannot be empty simultaneously
    if (!email && !phoneNumber) {
      return res.status(400).json({ error: 'email or phoneNumber is required' });
    }

    const result = await identifyContact(prisma, email, phoneNumber);
    return res.status(200).json(result);
  } catch (error) {
    // Log internally but return a generic error to the caller
    console.error('Error in /identify:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export { app, prisma, identifyContact };
