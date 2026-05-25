import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  private buildPayload() {
    return {
      status: 'ok',
      service: 'ecommreco-api',
      env: this.config.get<string>('NODE_ENV') ?? 'development',
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
