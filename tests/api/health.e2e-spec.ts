import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeTestApp, createTestApp } from '../helpers/create-test-app';

describe('Health API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 120000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('GET / returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('ecommreco-api');
  });

  it('GET /api/v1/health returns ok', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('ecommreco-api');
  });
});
