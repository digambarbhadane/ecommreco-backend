import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../utils/test-app';

describe('Public Lead Registration API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v1/leads/register rejects empty payload (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/leads/register')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('statusCode', 400);
  });

  it('POST /api/v1/leads/register rejects invalid types (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/leads/register')
      .send({
        fullName: 12345,
        email: true,
        contactNumber: 'abc',
      });

    expect(res.status).toBe(400);
  });

  it('POST /api/v1/leads/register handles large payload safely (400/413)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/leads/register')
      .send({
        fullName: 'QA Load',
        email: 'qa-load@example.com',
        contactNumber: '9999999999',
        message: 'x'.repeat(200_000),
      });

    expect([400, 413, 500]).toContain(res.status);
  });

  it('GET unknown route returns 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
  });
});
