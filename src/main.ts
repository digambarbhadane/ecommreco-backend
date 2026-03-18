import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api/v1');
  const config = app.get(ConfigService);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      const whitelist = new Set(
        [
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'http://[::1]:5173',
          process.env.FRONTEND_URL,
        ].filter((v): v is string => typeof v === 'string' && v.length > 0),
      );
      if (!origin) {
        callback(null, true);
        return;
      }
      if (whitelist.has(origin)) {
        callback(null, origin);
        return;
      }
      callback(null, origin);
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Requested-With',
      'Origin',
      'x-setup-token',
    ],
    optionsSuccessStatus: 204,
  });

  const configuredPort = config.get<string>('PORT');
  const parsedPort =
    typeof configuredPort === 'string' ? Number(configuredPort) : undefined;
  const port = Number.isFinite(parsedPort) ? (parsedPort as number) : 5000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`API running on port ${port}`);
}

void bootstrap();
