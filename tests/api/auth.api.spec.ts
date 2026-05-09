import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../utils/test-app';

describe('Auth API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/auth/health returns success payload', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/health');
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(typeof res.body).toBe('object');
  });

  it('POST /api/v1/auth/login validates bad payload (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('statusCode', 400);
  });

  it('POST /api/v1/auth/login rejects invalid credentials (401/400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'qa@example.com', password: 'wrong-password' });

    expect([400, 401]).toContain(res.status);
  });
});
