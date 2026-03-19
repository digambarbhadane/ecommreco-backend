import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
        const buildOptions = (uri: string) => {
          const base = {
            uri,
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 20000,
            bufferCommands: false,
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
            return buildOptions(uri);
          }
          throw new Error('MONGODB_URI is not set');
        }
        const fallbackUri =
          config.get<string>('MONGODB_FALLBACK_URI') ??
          'mongodb://127.0.0.1:27017/seller-insights-hub';

        const forceMemory = config.get<string>('USE_MEMORY_DB') === 'true';
        const shouldUseMemory = forceMemory || nodeEnv === 'test';

        if (!shouldUseMemory) {
          if (typeof uri === 'string' && uri.trim().length > 0) {
            const ok = await canConnect(uri);
            if (ok) return buildOptions(uri);
          }

          const ok = await canConnect(fallbackUri);
          if (ok) return buildOptions(fallbackUri);
        }

        const memory = await MongoMemoryServer.create({
          instance: { dbName: 'seller-insights-hub', launchTimeout: 30000 },
        });
        return buildOptions(memory.getUri());
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
  ],
})
export class AppModule {}
