/**
 * Global test environment. Runs before each test file.
 * Uses in-memory MongoDB (NODE_ENV=test) — see AppModule Mongoose factory.
 */
process.env.NODE_ENV = 'test';
process.env.USE_MEMORY_DB = 'true';
process.env.ALLOW_MEMORY_DB_FALLBACK = 'true';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-jwt-secret-minimum-32-characters-long-for-hs256';
process.env.SUPER_ADMIN_SETUP_TOKEN =
  process.env.SUPER_ADMIN_SETUP_TOKEN ?? 'test-setup-token';
process.env.CORS_ALLOW_ALL = 'true';
process.env.FRONTEND_URL = 'http://localhost:8080';
process.env.DEV_SUPER_ADMIN_EMAIL = 'superadmin@test.com';
process.env.DEV_SUPER_ADMIN_PASSWORD = 'password123';
process.env.DEV_SUPER_ADMIN_NAME = 'Test Super Admin';
process.env.EMAIL_USE_QUEUE = 'false';
process.env.SMTP_HOST = 'smtp.ethereal.email';
process.env.SMTP_PORT = '587';
process.env.POSTMARK_API_KEY =
  process.env.POSTMARK_API_KEY ?? 'test-postmark-api-key';
process.env.CASHFREE_CLIENT_ID =
  process.env.CASHFREE_CLIENT_ID ?? 'test-cashfree-client-id';
process.env.CASHFREE_CLIENT_SECRET =
  process.env.CASHFREE_CLIENT_SECRET ?? 'test-cashfree-client-secret';
process.env.EMAIL_AUTH = process.env.EMAIL_AUTH ?? 'auth@test.com';
process.env.EMAIL_BILLING = process.env.EMAIL_BILLING ?? 'billing@test.com';
process.env.EMAIL_NOTIFICATION =
  process.env.EMAIL_NOTIFICATION ?? 'notify@test.com';

jest.setTimeout(120000);
