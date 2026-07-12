import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app } from './app';

const prisma = new PrismaClient();

/** Clean the database before each test to ensure isolation */
beforeEach(async () => {
  await prisma.contact.deleteMany();
});

/** Clean up and disconnect Prisma after all tests */
afterAll(async () => {
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
});

describe('POST /identify', () => {
  /** Scenario 1: Completely new email and phone → creates a primary contact */
  it('creates a primary contact when no matches exist', async () => {
    const res = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '111' });

    expect(res.status).toBe(200);
    expect(res.body.contact.primaryContactId).toBeDefined();
    expect(res.body.contact.emails).toEqual(['a@gmail.com']);
    expect(res.body.contact.phoneNumbers).toEqual(['111']);
    expect(res.body.contact.secondaryContactIds).toEqual([]);
  });

  /** Scenario 2: Email matches existing, phone is new → creates secondary */
  it('creates a secondary contact when email matches and phone is new', async () => {
    const res1 = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '111' });
    const primaryId = res1.body.contact.primaryContactId;

    const res2 = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '222' });

    expect(res2.status).toBe(200);
    expect(res2.body.contact.primaryContactId).toBe(primaryId);
    expect(res2.body.contact.emails).toEqual(['a@gmail.com']);
    expect(res2.body.contact.phoneNumbers).toEqual(['111', '222']);
    expect(res2.body.contact.secondaryContactIds).toHaveLength(1);
  });

  /** Scenario 3: Phone matches existing, email is new → creates secondary */
  it('creates a secondary contact when phone matches and email is new', async () => {
    const res1 = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '111' });
    const primaryId = res1.body.contact.primaryContactId;

    await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '222' });

    const res3 = await request(app)
      .post('/identify')
      .send({ email: 'b@gmail.com', phoneNumber: '222' });

    expect(res3.status).toBe(200);
    expect(res3.body.contact.primaryContactId).toBe(primaryId);
    expect(res3.body.contact.emails).toEqual(['a@gmail.com', 'b@gmail.com']);
    expect(res3.body.contact.phoneNumbers).toEqual(['111', '222']);
    expect(res3.body.contact.secondaryContactIds).toHaveLength(2);
  });

  /** Scenario 4: Both email and phone already exist in the group → no new entry */
  it('returns existing group when both fields already exist', async () => {
    const res1 = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '111' });
    const primaryId = res1.body.contact.primaryContactId;

    await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '222' });

    const res3 = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '111' });

    expect(res3.status).toBe(200);
    expect(res3.body.contact.primaryContactId).toBe(primaryId);
    expect(res3.body.contact.secondaryContactIds).toHaveLength(1);
  });

  /**
   * Scenario 5: Hardest case — request connects two separate primary groups.
   * The newer primary should be demoted to secondary.
   */
  it('merges two primary groups when request links them', async () => {
    const res1 = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '111' });
    const primaryIdA = res1.body.contact.primaryContactId;

    await request(app)
      .post('/identify')
      .send({ email: 'b@gmail.com', phoneNumber: '222' });

    const res3 = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '222' });

    expect(res3.status).toBe(200);
    expect(res3.body.contact.primaryContactId).toBe(primaryIdA);
    expect(res3.body.contact.emails).toEqual(['a@gmail.com', 'b@gmail.com']);
    expect(res3.body.contact.phoneNumbers).toEqual(['111', '222']);
    expect(res3.body.contact.secondaryContactIds).toHaveLength(1);
  });

  /**
   * Scenario 6: Merge where the demoted primary already has secondaries.
   * All secondaries must be repointed to the surviving primary.
   */
  it('repoints secondaries of demoted primary during merge', async () => {
    const res1 = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '111' });
    const primaryIdA = res1.body.contact.primaryContactId;

    await request(app)
      .post('/identify')
      .send({ email: 'b@gmail.com', phoneNumber: '222' });

    await request(app)
      .post('/identify')
      .send({ email: 'c@gmail.com', phoneNumber: '333' });

    /* This links C(primary) with B(primary) via phone — C merges into B */
    await request(app)
      .post('/identify')
      .send({ email: 'c@gmail.com', phoneNumber: '222' });

    /* This links A(primary) with B's group via C's phone — B's group merges into A */
    const res5 = await request(app)
      .post('/identify')
      .send({ email: 'a@gmail.com', phoneNumber: '333' });

    expect(res5.status).toBe(200);
    expect(res5.body.contact.primaryContactId).toBe(primaryIdA);
    expect(res5.body.contact.emails).toEqual(['a@gmail.com', 'b@gmail.com', 'c@gmail.com']);
    expect(res5.body.contact.phoneNumbers).toEqual(['111', '222', '333']);
    expect(res5.body.contact.secondaryContactIds).toHaveLength(2);
  });

  /** Edge case: Missing both fields should return 400 */
  it('returns 400 when both email and phoneNumber are missing', async () => {
    const res = await request(app)
      .post('/identify')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('email or phoneNumber is required');
  });

  /** Edge case: Only email provided */
  it('creates contact with only email', async () => {
    const res = await request(app)
      .post('/identify')
      .send({ email: 'only@email.com' });

    expect(res.status).toBe(200);
    expect(res.body.contact.emails).toEqual(['only@email.com']);
    expect(res.body.contact.phoneNumbers).toEqual([]);
  });

  /** Edge case: Only phoneNumber provided */
  it('creates contact with only phoneNumber', async () => {
    const res = await request(app)
      .post('/identify')
      .send({ phoneNumber: '9999999999' });

    expect(res.status).toBe(200);
    expect(res.body.contact.phoneNumbers).toEqual(['9999999999']);
    expect(res.body.contact.emails).toEqual([]);
  });
});
