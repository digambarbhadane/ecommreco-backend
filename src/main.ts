import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { AppModule } from './app.module';

const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, '');

const parseBooleanEnv = (value: string | undefined) =>
  typeof value === 'string' && value.trim().toLowerCase() === 'true';

const splitOrigins = (value: string | undefined) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(normalizeOrigin);
};

const isRenderOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    return url.hostname.toLowerCase().endsWith('.onrender.com');
  } catch {
    return false;
  }
};

const isLocalOrPrivateHostname = (hostname: string) => {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === '::'
  ) {
    return true;
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }
  const match = host.match(/^172\.(\d+)\./);
  if (!match) {
    return false;
  }
  const second = Number(match[1]);
  return second >= 16 && second <= 31;
};

const isPrivateNetworkOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    return isLocalOrPrivateHostname(url.hostname);
  } catch {
    return false;
  }
};

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
  const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';
  const allowAllOrigins = parseBooleanEnv(config.get<string>('CORS_ALLOW_ALL'));
  const allowRenderOrigins = parseBooleanEnv(
    config.get<string>('CORS_ALLOW_RENDER_ORIGINS') ?? 'true',
  );
  const configuredOrigins = [
    ...splitOrigins(config.get<string>('FRONTEND_URL')),
    ...splitOrigins(config.get<string>('FRONTEND_URLS')),
    ...splitOrigins(config.get<string>('RENDER_EXTERNAL_URL')),
  ];
  const whitelist = new Set(
    [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
      'https://ecommreco.com',
      ...configuredOrigins,
    ].map(normalizeOrigin),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      try {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (
          isProduction &&
          configuredOrigins.length === 0 &&
          !allowAllOrigins
        ) {
          Logger.warn(
            'FRONTEND_URL/FRONTEND_URLS not configured in production. Temporarily allowing all origins.',
          );
          callback(null, origin);
          return;
        }
        if (allowAllOrigins) {
          callback(null, origin);
          return;
        }
        const normalizedOrigin = normalizeOrigin(origin);
        if (!isProduction && isPrivateNetworkOrigin(normalizedOrigin)) {
          callback(null, origin);
          return;
        }
        if (allowRenderOrigins && isRenderOrigin(normalizedOrigin)) {
          callback(null, origin);
          return;
        }
        if (whitelist.has(normalizedOrigin)) {
          callback(null, origin);
          return;
        }
        if (isProduction) {
          Logger.warn(
            `CORS origin not in whitelist (${origin}). Allowing in production to avoid preflight failure.`,
          );
          callback(null, origin);
          return;
        }
        Logger.warn(`CORS blocked for origin: ${origin}`);
        callback(null, false);
      } catch (err: unknown) {
        const msg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: unknown }).message)
            : String(err);
        Logger.error(`CORS origin evaluation failed: ${msg}`);
        callback(null, true);
      }
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
  await app.listen(port, '0.0.0.0');
  Logger.log(`API running on port ${port}`);
}

void bootstrap();
