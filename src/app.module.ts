import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ThrottlerModule } from '@nestjs/throttler';
import * as mongoose from 'mongoose';
import { AuthModule } from './auth/auth.module';
import { GstsModule } from './gsts/gsts.module';
import { GstinVerificationModule } from './gstin-verification/gstin-verification.module';
import { LeadsModule } from './leads/leads.module';
import { MarketplacesModule } from './marketplaces/marketplaces.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformMarketplacesModule } from './platform-marketplaces/platform-marketplaces.module';
import { SellersModule } from './sellers/sellers.module';
import { AccountManagerModule } from './account-manager/account-manager.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';
import { ProfileModule } from './profile/profile.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { EmailModule } from './email/email.module';
import { SalesActivityModule } from './sales-activity/sales-activity.module';
import { ReportImportModule } from './report-import/report-import.module';
import { HealthModule } from './health/health.module';
import { setMongoStorageMode } from './config/mongo-connection';
import {
  getMongoUriCandidates,
  mongoConnectionHint,
} from './config/mongo-uri';

const mongoLogger = new Logger('MongoDB');

const maskMongoUri = (uri: string) =>
  uri.replace(/\/\/([^:@/]+)(:([^@/]*))?@/g, '//***:***@');

const DEFAULT_LOCAL_MONGODB_URI = 'mongodb://127.0.0.1:27017/sellerspl';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const dbName = config.get<string>('MONGODB_DB_NAME');
        const connectionFactory = (connection: mongoose.Connection) => {
          connection.on('connected', () => {
            mongoLogger.log(
              `✅ CONNECTED (${connection.name}) host=${connection.host} db=${connection.db?.databaseName ?? 'unknown'}`,
            );
          });
          connection.on('disconnected', () => {
            mongoLogger.warn(`Disconnected (${connection.name})`);
          });
          connection.on('error', (err: unknown) => {
            const msg =
              err && typeof err === 'object' && 'message' in err
                ? String((err as { message?: unknown }).message)
                : String(err);
            mongoLogger.error(`Connection error (${connection.name}): ${msg}`);
          });
          return connection;
        };
        const buildOptions = (uri: string) => {
          const base = {
            uri,
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 20000,
            bufferCommands: false,
            connectionFactory,
          };
          if (typeof dbName === 'string' && dbName.trim().length > 0) {
            return { ...base, dbName };
          }
          return base;
        };

        const canConnect = async (
          uri: string,
        ): Promise<{ ok: true } | { ok: false; message: string }> => {
          const trimmed = uri.trim();
          if (!trimmed) return { ok: false, message: 'empty URI' };
          try {
            const connection = await mongoose
              .createConnection(trimmed, {
                serverSelectionTimeoutMS: 15000,
                connectTimeoutMS: 15000,
                dbName:
                  typeof dbName === 'string' && dbName.trim().length > 0
                    ? dbName.trim()
                    : undefined,
              })
              .asPromise();
            await connection.close();
            return { ok: true };
          } catch (err: unknown) {
            const message =
              err && typeof err === 'object' && 'message' in err
                ? String((err as { message?: unknown }).message)
                : String(err);
            return { ok: false, message };
          }
        };

        const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
        const uri = config.get<string>('MONGODB_URI');
        if (nodeEnv === 'production') {
          if (typeof uri === 'string' && uri.trim().length > 0) {
            mongoLogger.log(
              `Using MongoDB (production) uri=${maskMongoUri(uri.trim())} dbName=${String(dbName ?? '')}`,
            );
            return buildOptions(uri.trim());
          }
          throw new Error('MONGODB_URI is not set');
        }
        const fallbackEnv = config.get<string>('MONGODB_FALLBACK_URI');
        const fallbackUri =
          typeof fallbackEnv === 'string' && fallbackEnv.trim().length > 0
            ? fallbackEnv.trim()
            : DEFAULT_LOCAL_MONGODB_URI;

        const forceMemory = config.get<string>('USE_MEMORY_DB') === 'true';
        const shouldUseMemory = forceMemory || nodeEnv === 'test';
        const allowMemoryFallback =
          nodeEnv !== 'production' &&
          config.get<string>('ALLOW_MEMORY_DB_FALLBACK') === 'true';

        if (!shouldUseMemory) {
          const uriCandidates = getMongoUriCandidates(config);
          if (
            fallbackUri.length > 0 &&
            !uriCandidates.includes(fallbackUri)
          ) {
            uriCandidates.push(fallbackUri);
          }
          if (uriCandidates.length === 0 && typeof uri === 'string' && uri.trim()) {
            uriCandidates.push(uri.trim());
          }
          const errors: string[] = [];

          for (let i = 0; i < uriCandidates.length; i++) {
            const candidate = uriCandidates[i];
            const isLocalMongo = /mongodb:\/\/(127\.0\.0\.1|localhost)/.test(
              candidate,
            );
            mongoLogger.log(
              `Testing MongoDB uri=${maskMongoUri(candidate)} dbName=${String(dbName ?? '')}`,
            );
            const result = await canConnect(candidate);
            if (result.ok) {
              setMongoStorageMode(isLocalMongo ? 'fallback' : 'atlas');
              if (isLocalMongo) {
                mongoLogger.warn(
                  `⚠️ Using local MongoDB uri=${maskMongoUri(candidate)}`,
                );
              } else {
                mongoLogger.log(
                  `✅ Using MongoDB Atlas uri=${maskMongoUri(candidate)} dbName=${String(dbName ?? '')}`,
                );
              }
              return buildOptions(candidate);
            }
            errors.push(`${maskMongoUri(candidate)}: ${result.message}`);
            const hint = mongoConnectionHint(result.message);
            if (hint) {
              mongoLogger.warn(hint);
            } else if (candidate.startsWith('mongodb+srv://')) {
              mongoLogger.warn(
                `Could not connect to MongoDB Atlas uri=${maskMongoUri(candidate)}. Check IP allowlist, credentials, and hostname.`,
              );
            }
          }

          if (!allowMemoryFallback) {
            const databaseName =
              typeof dbName === 'string' && dbName.trim().length > 0
                ? dbName.trim()
                : '(default from URI)';
            if (uriCandidates.length === 0) {
              throw new Error(
                'No MongoDB URI configured. Set MONGODB_URI or enable USE_MEMORY_DB=true for local in-memory database.',
              );
            }
            const detail = errors.length > 0 ? ` Last errors: ${errors.join('; ')}` : '';
            throw new Error(
              `Could not connect to configured MongoDB URIs for dbName=${databaseName}.${detail} Set ALLOW_MEMORY_DB_FALLBACK=true only for offline dev.`,
            );
          }
        }

        setMongoStorageMode('memory');
        const memoryDbName =
          typeof dbName === 'string' && dbName.trim().length > 0
            ? dbName.trim()
            : 'ecommreco_dev';
        mongoLogger.error(
          `❌ Atlas unreachable — using IN-MEMORY MongoDB (db=${memoryDbName}). ` +
            `Your Atlas users/sellers are NOT available; login will return 401. ` +
            `Fix MONGODB_URI / network / IP allowlist, or set ALLOW_MEMORY_DB_FALLBACK=false to fail fast.`,
        );
        try {
          const memory = await MongoMemoryServer.create({
            instance: { dbName: memoryDbName, launchTimeout: 30000 },
          });
          return buildOptions(memory.getUri());
        } catch (err: unknown) {
          const msg =
            err && typeof err === 'object' && 'message' in err
              ? String((err as { message?: unknown }).message)
              : String(err);
          throw new Error(
            `MongoDB connection failed. Atlas/local MongoDB unreachable and mongodb-memory-server could not start: ${msg}`,
          );
        }
      },
    }),
    AuthModule,
    GstsModule,
    GstinVerificationModule,
    LeadsModule,
    MarketplacesModule,
    NotificationsModule,
    PlatformMarketplacesModule,
    SellersModule,
    AccountManagerModule,
    RolesModule,
    UsersModule,
    ProfileModule,
    SubscriptionModule,
    EmailModule,
    SalesActivityModule,
    ReportImportModule,
    HealthModule,
  ],
})
export class AppModule {}
