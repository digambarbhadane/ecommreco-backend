import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { LogSmsProvider } from './providers/log-sms.provider';
import { Msg91SmsProvider } from './providers/msg91-sms.provider';
import { Msg91WidgetService } from './providers/msg91-widget.service';

@Module({
  imports: [ConfigModule],
  controllers: [SmsController],
  providers: [SmsService, LogSmsProvider, Msg91SmsProvider, Msg91WidgetService],
  exports: [SmsService, Msg91WidgetService],
})
export class SmsModule {}
