import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../utils/test-app';

describe('API endpoint smoke coverage', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const protectedRoutes = [
    '/api/v1/roles',
    '/api/v1/users',
    '/api/v1/profile',
    '/api/v1/marketplaces',
    '/api/v1/platform-marketplaces',
    '/api/v1/subscription/package',
    '/api/v1/sales-activity/today',
    '/api/v1/notifications',
    '/api/v1/notifications/activity-logs',
    '/api/v1/account-manager/conversion-leads',
    '/api/v1/sellers/super-admin',
    '/api/v1/leads',
    '/api/v1/gsts',
    '/api/v1/gstin/verify',
    '/api/v1/report-imports/config',
  ];

  it.each(protectedRoutes)('GET %s should reject unauthenticated requests', async (path) => {
    const res = await request(app.getHttpServer()).get(path);
    expect([401, 403, 404]).toContain(res.status);
  });

  it('GET /api/v1/auth/database-connection returns a status payload', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/database-connection');
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('returns 404 for unknown versioned endpoint', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope/nope');
    expect(res.status).toBe(404);
  });
});
