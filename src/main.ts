import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
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
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const whitelist = new Set(
        [
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'http://[::1]:5173',
          process.env.FRONTEND_URL,
        ].filter((v): v is string => typeof v === 'string' && v.length > 0),
      );
      if (
        !origin ||
        whitelist.has(origin) ||
        (typeof origin === 'string' && origin.startsWith('http://localhost'))
      ) {
        callback(null, true);
      } else {
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
    ],
    optionsSuccessStatus: 204,
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin =
      typeof req.headers.origin === 'string' ? req.headers.origin : '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header(
      'Access-Control-Allow-Methods',
      'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    );
    const requestedHeaders =
      typeof req.headers['access-control-request-headers'] === 'string'
        ? req.headers['access-control-request-headers']
        : 'Content-Type, Accept, Authorization, X-Requested-With, Origin';
    res.header('Access-Control-Allow-Headers', requestedHeaders);
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  const port = config.get<number>('PORT') ?? 5000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`API running on port ${port}`);
}

void bootstrap();
