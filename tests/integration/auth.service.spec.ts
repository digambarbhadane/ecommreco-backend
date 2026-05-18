import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../src/auth/auth.service';
import { User, UserDocument } from '../../src/users/schemas/user.schema';
import { closeTestApp, createTestApp } from '../helpers/create-test-app';

describe('AuthService (integration)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let userModel: Model<UserDocument>;

  beforeAll(async () => {
    app = await createTestApp();
    authService = app.get(AuthService);
    userModel = app.get(getModelToken(User.name));
  }, 120000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('health() reports database connected', () => {
    const result = authService.health();
    expect(result.success).toBe(true);
    expect(result.data.database).toBe('connected');
  });

  it('login() succeeds for seeded super admin', async () => {
    const result = await authService.login(
      {
        email: process.env.DEV_SUPER_ADMIN_EMAIL ?? 'superadmin@test.com',
        password: process.env.DEV_SUPER_ADMIN_PASSWORD ?? 'password123',
      },
      { headers: {}, ip: '127.0.0.1' } as import('express').Request,
    );

    expect(result.success).toBe(true);
    expect(result.data.accessToken).toBeDefined();
    expect(result.data.user.role).toBe('super_admin');
  });

  it('login() fails for wrong password', async () => {
    await expect(
      authService.login(
        {
          email: process.env.DEV_SUPER_ADMIN_EMAIL ?? 'superadmin@test.com',
          password: 'definitely-wrong-password',
        },
        { headers: {}, ip: '127.0.0.1' } as import('express').Request,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('does not return password hash in login response', async () => {
    const result = await authService.login(
      {
        email: process.env.DEV_SUPER_ADMIN_EMAIL ?? 'superadmin@test.com',
        password: process.env.DEV_SUPER_ADMIN_PASSWORD ?? 'password123',
      },
      { headers: {}, ip: '127.0.0.1' } as import('express').Request,
    );

    expect(result.data.user).not.toHaveProperty('password');
  });

  it('stores bcrypt hashed passwords for new users', async () => {
    const email = `hashtest-${Date.now()}@test.com`;
    const plain = 'TestPass123!';
    const hashed = await bcrypt.hash(plain, 10);
    await userModel.create({
      publicId: `test-${Date.now()}`,
      fullName: 'Hash Test',
      email,
      username: email,
      password: hashed,
      role: 'sales_manager',
      status: 'approved',
      profileCompleted: true,
    });

    const doc = await userModel.findOne({ email }).lean().exec();
    expect(doc?.password).toBeDefined();
    expect(doc?.password).not.toBe(plain);
    expect(await bcrypt.compare(plain, doc!.password)).toBe(true);
  });
});
