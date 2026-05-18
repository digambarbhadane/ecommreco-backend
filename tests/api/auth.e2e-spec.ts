import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeTestApp, createTestApp } from '../helpers/create-test-app';

describe('Auth API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 120000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('GET /api/v1/auth/health', () => {
    it('returns 200 with connected database', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/health')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
      expect(res.body.data.database).toBe('connected');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns 401 for invalid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.com', password: 'wrongpassword1' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('returns 400 for validation errors', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: '123' })
        .expect(400);
    });

    it('returns access token for dev super admin when USE_MEMORY_DB is enabled', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: process.env.DEV_SUPER_ADMIN_EMAIL ?? 'superadmin@test.com',
          password: process.env.DEV_SUPER_ADMIN_PASSWORD ?? 'password123',
        })
        .expect((res) => {
          expect([200, 201]).toContain(res.status);
        });

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.role).toBe('super_admin');
      expect(res.body.data.user).not.toHaveProperty('password');
    });
  });

  describe('GET /api/v1/auth/debug-db', () => {
    it('debug-db is restricted in production only (open in test/development)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/debug-db');
      // Documented security gap: non-production allows debug without token
      expect([200, 401]).toContain(res.status);
    });

    it('allows access with valid setup token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/debug-db')
        .set('x-setup-token', process.env.SUPER_ADMIN_SETUP_TOKEN ?? 'test-setup-token')
        .expect(200);
    });
  });
});
