import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeTestApp, createTestApp } from '../helpers/create-test-app';

const validLeadPayload = () => {
  const suffix = String(Date.now()).slice(-7);
  return {
  fullName: 'Test Lead',
  email: `lead-${suffix}@example.com`,
  contactNumber: `98765${suffix.slice(0, 5)}`,
  marketplaces: ['flipkart'],
  ordersPerMonth: '0-1000',
  termsAccepted: true,
  source: 'website',
};
};

describe('Leads registration API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 120000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('POST /api/v1/leads/register', () => {
    it('creates a lead with valid payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/leads/register')
        .send(validLeadPayload())
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it('returns 400 when terms are not accepted', async () => {
      const payload = validLeadPayload();
      payload.termsAccepted = false as unknown as true;

      await request(app.getHttpServer())
        .post('/api/v1/leads/register')
        .send(payload)
        .expect(400);
    });

    it('returns 400 for invalid contact number', async () => {
      const payload = validLeadPayload();
      payload.contactNumber = '123';

      await request(app.getHttpServer())
        .post('/api/v1/leads/register')
        .send(payload)
        .expect(400);
    });

    it('returns 400 for duplicate email on second registration', async () => {
      const payload = validLeadPayload();
      payload.email = `duplicate-${Date.now()}@example.com`;

      await request(app.getHttpServer())
        .post('/api/v1/leads/register')
        .send(payload)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/leads/register')
        .send(payload)
        .expect(400);
    });
  });
});
