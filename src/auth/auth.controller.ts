import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  BadRequestException,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { OtpService } from '../otp/otp.service';
import { SendOtpDto, VerifyOtpDto, ResendOtpDto } from '../otp/dto/otp.dto';
import { OtpVerifiedGuard, verifyOtpRequired } from '../otp/guards/otp-verified.guard';
import { OTP_PURPOSE } from '../otp/otp.constants';
import {
  ForgotPasswordOtpDto,
  ResetPasswordWithOtpDto,
} from './dto/reset-password-otp.dto';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';
import { DevResetPasswordDto } from './dto/dev-reset-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import type { Request } from 'express';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
  ) {}

  private otpContext(req: Request) {
    return {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    };
  }

  @Post('send-otp')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Send mobile OTP' })
  sendOtp(@Body() dto: SendOtpDto, @Req() req: Request) {
    return this.otpService.sendOtp(
      dto.mobile,
      dto.purpose,
      this.otpContext(req),
      dto.captchaToken,
    );
  }

  @Get('msg91-widget-config')
  @ApiOperation({
    summary: 'MSG91 OTP widget public config (captcha settings)',
    security: [],
  })
  getMsg91WidgetConfig() {
    return this.otpService.getMsg91WidgetConfig();
  }

  @Post('verify-otp')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify mobile OTP' })
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    if (dto.reqId?.trim() && dto.otp?.trim()) {
      return this.otpService.verifyWidgetOtp(
        dto.mobile,
        dto.purpose,
        dto.reqId.trim(),
        dto.otp.trim(),
        this.otpContext(req),
      );
    }
    if (dto.accessToken?.trim()) {
      return this.otpService.verifyWidgetAccessToken(
        dto.mobile,
        dto.purpose,
        dto.accessToken.trim(),
        this.otpContext(req),
      );
    }
    if (!dto.otp?.trim()) {
      throw new BadRequestException('OTP or access token is required.');
    }
    return this.otpService.verifyOtp(
      dto.mobile,
      dto.otp,
      dto.purpose,
      this.otpContext(req),
    );
  }

  @Post('resend-otp')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Resend mobile OTP' })
  resendOtp(@Body() dto: ResendOtpDto, @Req() req: Request) {
    return this.otpService.resendOtp(
      dto.mobile,
      dto.purpose,
      this.otpContext(req),
      dto.captchaToken,
    );
  }

  @Post('forgot-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Forgot password — send OTP to mobile',
    description:
      'Sends OTP for password reset when an account exists. Always returns a generic success message.',
    security: [],
  })
  async forgotPassword(@Body() dto: ForgotPasswordOtpDto, @Req() req: Request) {
    const account = await this.authService.findAccountByMobile(dto.mobile);
    if (account.user || account.seller) {
      await this.otpService.sendOtp(
        dto.mobile,
        OTP_PURPOSE.FORGOT_PASSWORD,
        this.otpContext(req),
      );
    }
    return {
      success: true,
      message: 'If an account exists for this mobile number, an OTP has been sent.',
    };
  }

  @Post('reset-password')
  @UseGuards(ThrottlerGuard, OtpVerifiedGuard)
  @verifyOtpRequired(OTP_PURPOSE.FORGOT_PASSWORD)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Reset password after OTP verification',
    security: [],
  })
  resetPassword(@Body() dto: ResetPasswordWithOtpDto) {
    return this.authService.resetPasswordWithOtp(dto);
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check', description: 'Returns server health status' })
  health() {
    return this.authService.health();
  }

  @Get('database-connection')
  @ApiOperation({ summary: 'Check database connection', description: 'Tests MongoDB connectivity' })
  databaseConnection() {
    return this.authService.databaseConnection();
  }

  @Post('forgot-password-legacy')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Forgot password (legacy email stub)',
    description: 'Deprecated email-only stub. Use forgot-password with mobile OTP.',
    security: [],
  })
  forgotPasswordLegacy(@Body() dto: { email?: string }) {
    void dto;
    return { success: true, message: 'If the email exists, a reset link has been sent.' };
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Login',
    description:
      'Authenticate user with email and password. Returns JWT access + refresh tokens on success. Rate limited.',
    security: [],
  })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req);
  }

  @Post('refresh-token')
  @SkipThrottle()
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Exchange a valid refresh token for a new access token. Does not rotate the refresh token.',
    security: [],
  })
  refreshToken(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
  ) {
    return this.authService.refreshAccessToken(dto.refreshToken, req);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Logout current session',
    description:
      'Revokes the current session. Prefer sending Authorization Bearer access token and/or refreshToken in body.',
    security: [],
  })
  async logout(
    @Req() req: Request & { user?: { id?: string; sessionId?: string } },
    @Body() body: { refreshToken?: string },
    @Headers('authorization') authorization?: string,
  ) {
    let userId = req.user?.id;
    let sessionId = req.user?.sessionId;
    const bearer = String(authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if ((!userId || !sessionId) && bearer) {
      try {
        const decoded = await this.authService.decodeAccessToken(bearer);
        userId = userId || decoded.sub;
        sessionId = sessionId || decoded.sessionId;
      } catch {
        // ignore — may already be expired
      }
    }
    return this.authService.logout({
      userId,
      sessionId,
      refreshToken: body?.refreshToken,
    });
  }

  @Post('bootstrap-super-admin')
  @ApiOperation({ summary: 'Bootstrap super admin', description: 'Create the first super admin account. Requires valid setup token in x-setup-token header.' })
  bootstrapSuperAdmin(
    @Headers('x-setup-token') setupToken: string | undefined,
    @Body() dto: BootstrapSuperAdminDto,
  ) {
    return this.authService.bootstrapSuperAdmin({ setupToken }, dto);
  }

  @Get('debug-db')
  @ApiOperation({ summary: 'Debug database', description: 'Returns database statistics. Requires x-setup-token header.' })
  debugDb(@Headers('x-setup-token') setupToken: string | undefined) {
    return this.authService.debugDb({ setupToken });
  }

  @Get('debug-super-admin')
  @ApiOperation({ summary: 'Debug super admin', description: 'Debug super admin account. Requires x-setup-token header.' })
  debugSuperAdmin(@Headers('x-setup-token') setupToken: string | undefined) {
    return this.authService.debugSuperAdmin({ setupToken });
  }

  @Get('debug-identity')
  @ApiOperation({ summary: 'Debug identity lookup', description: 'Look up user or seller by identifier. Requires x-setup-token header.' })
  debugIdentity(
    @Headers('x-setup-token') setupToken: string | undefined,
    @Query('identifier') identifier: string | undefined,
  ) {
    return this.authService.debugIdentity({ setupToken }, { identifier });
  }

  @Post('dev-reset-password')
  @ApiOperation({ summary: 'Reset password (dev only)', description: 'Reset user or seller password. Requires x-setup-token header. Do not use in production.' })
  devResetPassword(
    @Headers('x-setup-token') setupToken: string | undefined,
    @Body() dto: DevResetPasswordDto,
  ) {
    return this.authService.devResetPassword({ setupToken }, dto);
  }
}
