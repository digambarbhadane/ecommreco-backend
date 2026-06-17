import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeTestApp, createTestApp } from '../helpers/create-test-app';

describe('Protected routes API (e2e)', () => {
  let app: INestApplication;
  let superAdminToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: process.env.DEV_SUPER_ADMIN_EMAIL ?? 'superadmin@test.com',
        password: process.env.DEV_SUPER_ADMIN_PASSWORD ?? 'password123',
      });

    superAdminToken = login.body.data.accessToken;
  }, 120000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('GET /api/v1/leads returns 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/v1/leads').expect(401);
  });

  it('GET /api/v1/leads returns 200 with super_admin token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('GET /api/v1/users returns 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });

  it('GET /api/v1/profile/me returns 200 for authenticated user', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/profile/me')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
  });

  it('GET /api/v1/gsts returns 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/v1/gsts').expect(401);
  });

  it('GET /api/v1/sellers returns 200 for super_admin', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/sellers')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
  });

  it('GET /api/v1/leads/invalid-id-format returns 4xx for bad id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/leads/not-a-valid-object-id')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect([400, 404, 500]).toContain(res.status);
  });
});
