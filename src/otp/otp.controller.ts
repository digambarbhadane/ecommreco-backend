import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { OtpService } from './otp.service';
import { ResendOtpDto, SendOtpDto, VerifyOtpDto } from './dto/otp.dto';

@ApiTags('OTP')
@Controller('otp')
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  private context(req: Request) {
    return {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    };
  }

  @Post('send')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Send mobile OTP (generic)' })
  send(@Body() dto: SendOtpDto, @Req() req: Request) {
    return this.otpService.sendOtp(
      dto.mobile,
      dto.purpose,
      this.context(req),
      dto.captchaToken,
    );
  }

  @Post('verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify mobile OTP (generic)' })
  verify(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    if (dto.reqId?.trim() && dto.otp?.trim()) {
      return this.otpService.verifyWidgetOtp(
        dto.mobile,
        dto.purpose,
        dto.reqId.trim(),
        dto.otp.trim(),
        this.context(req),
      );
    }
    if (dto.accessToken?.trim()) {
      return this.otpService.verifyWidgetAccessToken(
        dto.mobile,
        dto.purpose,
        dto.accessToken.trim(),
        this.context(req),
      );
    }
    if (!dto.otp?.trim()) {
      throw new BadRequestException('OTP or access token is required.');
    }
    return this.otpService.verifyOtp(
      dto.mobile,
      dto.otp,
      dto.purpose,
      this.context(req),
    );
  }

  @Post('resend')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Resend mobile OTP (generic)' })
  resend(@Body() dto: ResendOtpDto, @Req() req: Request) {
    return this.otpService.resendOtp(
      dto.mobile,
      dto.purpose,
      this.context(req),
      dto.captchaToken,
    );
  }
}
