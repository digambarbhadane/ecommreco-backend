import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

const MONGO_READY_LABEL: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private buildPayload() {
    const mongoState = this.connection?.readyState ?? 0;
    const mongo = MONGO_READY_LABEL[mongoState] ?? 'unknown';
    return {
      status: mongoState === 1 ? 'ok' : 'degraded',
      service: 'ecommreco-api',
      env: this.config.get<string>('NODE_ENV') ?? 'development',
      mongo,
      timestamp: new Date().toISOString(),
    };
  }

  /** Root liveness probe (excluded from global `api/v1` prefix). */
  @Get()
  @ApiOperation({ summary: 'Root health check' })
  root() {
    return this.buildPayload();
  }

  /** Prefixed health check for Render and API clients. */
  @Get('health')
  @ApiOperation({ summary: 'API health check' })
  health() {
    return this.buildPayload();
  }
}
