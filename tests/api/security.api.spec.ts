import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../utils/test-app';

describe('Protected APIs - authz guards', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const protectedEndpoints: Array<{ method: 'get' | 'post' | 'patch' | 'delete'; path: string; body?: Record<string, unknown> }> = [
    { method: 'get', path: '/api/v1/users' },
    { method: 'get', path: '/api/v1/roles' },
    { method: 'get', path: '/api/v1/sellers' },
    { method: 'get', path: '/api/v1/account-manager/payment-completed-sellers' },
    { method: 'get', path: '/api/v1/profile' },
    { method: 'get', path: '/api/v1/gsts' },
    { method: 'get', path: '/api/v1/report-imports/config' },
    { method: 'get', path: '/api/v1/platform-marketplaces' },
    { method: 'post', path: '/api/v1/leads', body: { contactNumber: '9999999999' } },
    { method: 'post', path: '/api/v1/subscription/package', body: { name: 'Test', price: 100 } },
  ];

  it.each(protectedEndpoints)(
    '$method $path should reject without token (401/403)',
    async ({ method, path, body }) => {
      const req = request(app.getHttpServer())[method](path);
      if (body) {
        req.send(body);
      }
      const res = await req;
      expect([401, 403]).toContain(res.status);
    },
  );
});
