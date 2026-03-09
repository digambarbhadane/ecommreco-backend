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
  app.enableCors({
    origin: true, // Allow any origin in development
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    // allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With', // Allow all headers
  });
  app.setGlobalPrefix('api/v1');
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT') ?? 5000;
  await app.listen(port);
  Logger.log(`API running on port ${port}`);
}

void bootstrap();
