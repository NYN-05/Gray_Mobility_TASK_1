import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app, prisma as appPrisma } from './app';

const prisma = new PrismaClient();
const api = (body: any) => request(app).post('/identify').send(body);

beforeEach(async () => { await prisma.contact.deleteMany(); });
afterAll(async () => {
  await prisma.contact.deleteMany();
  await Promise.all([prisma.$disconnect(), appPrisma.$disconnect()]);
});

function exp({ status, body: { contact } }: request.Response, id: any, emails: string[], phones: string[], sc?: number) {
  expect(status).toBe(200);
  expect(contact.primaryContactId).toEqual(id);
  expect(contact.emails).toEqual(emails);
  expect(contact.phoneNumbers).toEqual(phones);
  if (sc !== undefined) expect(contact.secondaryContactIds).toHaveLength(sc);
}

async function primary() {
  return (await api({ email: 'a@gmail.com', phoneNumber: '111' })).body.contact.primaryContactId;
}

describe('POST /identify', () => {
  it('creates primary when no match exists', async () => {
    exp(await api({ email: 'a@gmail.com', phoneNumber: '111' }), expect.any(Number), ['a@gmail.com'], ['111'], 0);
  });

  it('creates secondary when email matches and phone is new', async () => {
    const pid = await primary();
    exp(await api({ email: 'a@gmail.com', phoneNumber: '222' }), pid, ['a@gmail.com'], ['111', '222'], 1);
  });

  it('creates secondary when phone matches and email is new', async () => {
    const pid = await primary();
    await api({ email: 'a@gmail.com', phoneNumber: '222' });
    exp(await api({ email: 'b@gmail.com', phoneNumber: '222' }), pid, ['a@gmail.com', 'b@gmail.com'], ['111', '222'], 2);
  });

  it('returns existing group when info already exists', async () => {
    const pid = await primary();
    await api({ email: 'a@gmail.com', phoneNumber: '222' });
    exp(await api({ email: 'a@gmail.com', phoneNumber: '111' }), pid, ['a@gmail.com'], ['111', '222'], 1);
  });

  it('merges two primary groups when request links them', async () => {
    const pid = await primary();
    await api({ email: 'b@gmail.com', phoneNumber: '222' });
    exp(await api({ email: 'a@gmail.com', phoneNumber: '222' }), pid, ['a@gmail.com', 'b@gmail.com'], ['111', '222'], 1);
  });

  it('repoints secondaries during merge', async () => {
    const pid = await primary();
    await api({ email: 'b@gmail.com', phoneNumber: '222' });
    await api({ email: 'c@gmail.com', phoneNumber: '333' });
    await api({ email: 'c@gmail.com', phoneNumber: '222' });
    exp(await api({ email: 'a@gmail.com', phoneNumber: '333' }), pid, ['a@gmail.com', 'b@gmail.com', 'c@gmail.com'], ['111', '222', '333'], 2);
  });

  it('returns 400 when email and phone missing', async () => {
    const r = await api({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('email or phoneNumber is required');
  });

  it('creates contact with only email', async () => {
    exp(await api({ email: 'only@email.com' }), expect.any(Number), ['only@email.com'], [], 0);
  });

  it('creates contact with only phone', async () => {
    exp(await api({ phoneNumber: '9999999999' }), expect.any(Number), [], ['9999999999'], 0);
  });
});
