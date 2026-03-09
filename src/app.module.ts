import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { GstsModule } from './gsts/gsts.module';
import { GstinVerificationModule } from './gstin-verification/gstin-verification.module';
import { LeadsModule } from './leads/leads.module';
import { MarketplacesModule } from './marketplaces/marketplaces.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformMarketplacesModule } from './platform-marketplaces/platform-marketplaces.module';
import { SellersModule } from './sellers/sellers.module';

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
        const uri = config.get<string>('MONGODB_URI');
        if (typeof uri === 'string' && uri.trim().length > 0) {
          return { uri };
        }
        if (config.get<string>('NODE_ENV') === 'production') {
          throw new Error('MONGODB_URI is not set');
        }
        const fallbackUri =
          config.get<string>('MONGODB_FALLBACK_URI') ??
          'mongodb://127.0.0.1:27017/seller-insights-hub';
        const useMemory =
          config.get<string>('USE_MEMORY_DB') === 'true' &&
          config.get<string>('NODE_ENV') === 'test';
        if (!useMemory) {
          return { uri: fallbackUri };
        }
        const memory = await MongoMemoryServer.create({
          instance: { dbName: 'seller-insights-hub', launchTimeout: 30000 },
        });
        return { uri: memory.getUri() };
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
  ],
})
export class AppModule {}
