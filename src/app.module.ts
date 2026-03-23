import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ThrottlerModule } from '@nestjs/throttler';
import * as mongoose from 'mongoose';
import * as path from 'path';
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

const mongoLogger = new Logger('MongoDB');

const maskMongoUri = (uri: string) =>
  uri.replace(/\/\/([^:@/]+)(:([^@/]*))?@/g, '//***:***@');

const DEFAULT_LOCAL_MONGODB_URI = 'mongodb://127.0.0.1:27017/sellerspl';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(__dirname, '..', '.env'),
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
              `Connected (${connection.name}) host=${connection.host} db=${connection.db?.databaseName ?? 'unknown'}`,
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

        const canConnect = async (uri: string) => {
          const trimmed = uri.trim();
          if (!trimmed) return false;
          try {
            const connection = await mongoose
              .createConnection(trimmed, {
                serverSelectionTimeoutMS: 10000,
                connectTimeoutMS: 10000,
                dbName:
                  typeof dbName === 'string' && dbName.trim().length > 0
                    ? dbName.trim()
                    : undefined,
              })
              .asPromise();
            await connection.close();
            return true;
          } catch {
            return false;
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
          config.get<string>('ALLOW_MEMORY_DB_FALLBACK') === 'true';

        if (!shouldUseMemory) {
          let checkedAnyMongoUri = false;
          if (typeof uri === 'string' && uri.trim().length > 0) {
            const primary = uri.trim();
            checkedAnyMongoUri = true;
            mongoLogger.log(
              `Testing MongoDB uri=${maskMongoUri(primary)} dbName=${String(dbName ?? '')}`,
            );
            const ok = await canConnect(primary);
            if (ok) {
              mongoLogger.log(`Using MongoDB uri=${maskMongoUri(primary)}`);
              return buildOptions(primary);
            }
            if (primary.startsWith('mongodb+srv://')) {
              mongoLogger.log(
                `Could not connect to MongoDB Atlas (MONGODB_URI) uri=${maskMongoUri(primary)}. Check IP allowlist (Network Access), DB user/password, and cluster hostname. Falling back to local/in-memory.`,
              );
            }
          }

          if (fallbackUri.length > 0) {
            checkedAnyMongoUri = true;
            mongoLogger.log(
              `Testing MongoDB fallback uri=${maskMongoUri(fallbackUri)}`,
            );
            const ok = await canConnect(fallbackUri);
            if (ok) {
              mongoLogger.warn(
                `Using fallback MongoDB uri=${maskMongoUri(fallbackUri)}`,
              );
              return buildOptions(fallbackUri);
            }
          }

          if (!allowMemoryFallback) {
            const databaseName =
              typeof dbName === 'string' && dbName.trim().length > 0
                ? dbName.trim()
                : '(default from URI)';
            if (!checkedAnyMongoUri) {
              throw new Error(
                'No MongoDB URI configured. Set MONGODB_URI or enable USE_MEMORY_DB=true for local in-memory database.',
              );
            }
            throw new Error(
              `Could not connect to configured MongoDB URIs for dbName=${databaseName}. Disable strict mode by setting ALLOW_MEMORY_DB_FALLBACK=true.`,
            );
          }
        }

        mongoLogger.warn('Using in-memory MongoDB (mongodb-memory-server).');
        try {
          const memory = await MongoMemoryServer.create({
            instance: { dbName: 'seller-insights-hub', launchTimeout: 30000 },
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
  ],
})
export class AppModule {}
