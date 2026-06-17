/// <reference types="node" />
import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { AppModule } from './app.module';
import {
  buildSwaggerConfig,
  createDocumentOptions,
  normalizeSwaggerDocument,
} from '../config/swagger';

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

const DEFAULT_DEV_ORIGINS = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://[::1]:8080',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
<<<<<<< HEAD
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.header('Access-Control-Allow-Private-Network', 'true');
    }
    next();
  });
=======
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: '', method: RequestMethod.GET }],
  });

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
<<<<<<< HEAD
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://localhost:4200',
      'http://127.0.0.1:4200',
      'http://[::1]:4200',
=======
      ...DEFAULT_DEV_ORIGINS,
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
      'https://ecommreco.com',
      'https://www.ecommreco.com',
      'https://uat.ecommreco.com',
      ...configuredOrigins,
    ].map(normalizeOrigin),
  );

<<<<<<< HEAD
  app.use((req, res, next) => {
    if (req.method !== 'OPTIONS') {
      next();
      return;
    }

    const originHeader =
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (originHeader) {
      res.header('Access-Control-Allow-Origin', originHeader);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    res.header(
      'Access-Control-Allow-Methods',
      'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    );
    const requestedHeaders =
      typeof req.headers['access-control-request-headers'] === 'string'
        ? req.headers['access-control-request-headers']
        : undefined;
    res.header(
      'Access-Control-Allow-Headers',
      requestedHeaders ??
        'Content-Type,Accept,Authorization,X-Requested-With,Origin,x-setup-token',
    );
    res.header('Access-Control-Max-Age', '86400');
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.header('Access-Control-Allow-Private-Network', 'true');
    }
    res.sendStatus(204);
  });
=======
  const allowOrigin = (origin: string | undefined): boolean | string => {
    if (!origin) {
      return true;
    }
    if (allowAllOrigins) {
      return origin;
    }
    const normalizedOrigin = normalizeOrigin(origin);
    if (isPrivateNetworkOrigin(normalizedOrigin)) {
      return origin;
    }
    if (allowRenderOrigins && isRenderOrigin(normalizedOrigin)) {
      return origin;
    }
    if (whitelist.has(normalizedOrigin)) {
      return origin;
    }
    Logger.warn(
      `CORS: origin not in whitelist (${origin}); denying.`,
    );
    return false;
  };
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      try {
<<<<<<< HEAD
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
        if (isPrivateNetworkOrigin(normalizedOrigin)) {
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
=======
        const decision = allowOrigin(origin);
        callback(null, decision);
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
      } catch (err: unknown) {
        const msg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: unknown }).message)
            : String(err);
        Logger.error(`CORS origin evaluation failed: ${msg}`);
        callback(null, origin ?? true);
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
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
      'x-setup-token',
    ],
    exposedHeaders: ['Content-Disposition', 'Content-Type'],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  });

  const configuredPort = config.get<string>('PORT');
  const parsedPort =
    typeof configuredPort === 'string' ? Number(configuredPort) : undefined;
  const port =
    typeof parsedPort === 'number' && Number.isFinite(parsedPort)
      ? parsedPort
      : 5000;

  const swaggerEnabled =
    nodeEnv !== 'production' ||
    config.get<string>('ENABLE_SWAGGER') === 'true';
  if (swaggerEnabled) {
    const swaggerConfig = buildSwaggerConfig();
    const document = normalizeSwaggerDocument(
      SwaggerModule.createDocument(
        app,
        swaggerConfig,
        createDocumentOptions(),
      ),
    );

    SwaggerModule.setup('api/v1/docs', app, document, {
      jsonDocumentUrl: 'api/v1/docs-json',
      yamlDocumentUrl: 'api/v1/docs-yaml',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        filter: true,
        showRequestDuration: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
      customSiteTitle: 'EcommReco API Docs',
    });

    Logger.log(`Swagger UI: http://localhost:${port}/api/v1/docs`);
    Logger.log(`OpenAPI JSON: http://localhost:${port}/api/v1/docs-json`);
  } else {
    Logger.warn(
      'Swagger documentation is disabled in production (set ENABLE_SWAGGER=true to enable)',
    );
  }

  await app.listen(port, '0.0.0.0');
  Logger.log(`API running on http://0.0.0.0:${port}`);
  Logger.log(`Health: http://0.0.0.0:${port}/ and http://0.0.0.0:${port}/api/v1/health`);
  Logger.log(
    `CORS: allowAll=${allowAllOrigins} env=${nodeEnv} whitelist=${whitelist.size} origins`,
  );
}

void bootstrap();
