import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { AppModule } from './app.module';

const isErrnoException = (err: unknown): err is NodeJS.ErrnoException =>
  !!err && typeof err === 'object' && 'code' in err;

async function listenWithFallbackPorts(
  app: Awaited<ReturnType<typeof NestFactory.create>>,
  preferredPort: number,
) {
  const host = '0.0.0.0';
  const maxAttempts = 20;

  for (let i = 0; i < maxAttempts; i += 1) {
    const port = preferredPort + i;
    try {
      await app.listen(port, host);
      return port;
    } catch (err: unknown) {
      if (isErrnoException(err) && err.code === 'EADDRINUSE') {
        Logger.warn(`Port ${port} is in use. Trying ${port + 1}...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Could not bind to any port in range ${preferredPort}-${preferredPort + maxAttempts - 1}`,
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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
      callback(new Error(`CORS blocked for origin: ${origin}`));
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
  const port =
    typeof parsedPort === 'number' && Number.isFinite(parsedPort)
      ? parsedPort
      : 5000;
  const boundPort = await listenWithFallbackPorts(app, port);
  Logger.log(`API running on port ${boundPort}`);
}

void bootstrap();
