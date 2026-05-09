import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

export const createTestApp = async (): Promise<INestApplication> => {
  process.env.NODE_ENV = 'test';
  process.env.USE_MEMORY_DB = 'true';
  process.env.ALLOW_MEMORY_DB_FALLBACK = 'true';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
};
