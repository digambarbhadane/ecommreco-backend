import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailConfigService } from './config/email.config';

@Module({
  imports: [ConfigModule],
  providers: [EmailService, EmailConfigService],
  exports: [EmailService],
})
export class EmailModule {}
