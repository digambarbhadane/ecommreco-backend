import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsString, Matches } from 'class-validator';
import { SmsService } from './sms.service';

class SendSmsDto {
  @IsString()
  @Matches(/^[6-9]\d{9}$/)
  mobile!: string;

  @IsString()
  message!: string;
}

@ApiTags('SMS')
@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('send')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Send transactional SMS via configured provider' })
  send(@Body() dto: SendSmsDto) {
    return this.smsService.sendSms(dto.mobile, dto.message);
  }
}
