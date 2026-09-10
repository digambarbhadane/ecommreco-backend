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
  ForbiddenException,
  Headers,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { OtpService } from '../otp/otp.service';
import { SendOtpDto, VerifyOtpDto, ResendOtpDto } from '../otp/dto/otp.dto';
import {
  OtpVerifiedGuard,
  verifyOtpRequired,
} from '../otp/guards/otp-verified.guard';
import { OTP_PURPOSE } from '../otp/otp.constants';
import {
  ForgotPasswordOtpDto,
  ResetPasswordWithOtpDto,
} from './dto/reset-password-otp.dto';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';
import { DevResetPasswordDto } from './dto/dev-reset-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import type { Request, Response } from 'express';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './auth-cookie.util';

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

  private normalizeOrigin(value: string) {
    return value.trim().replace(/\/+$/, '').toLowerCase();
  }

  private assertTrustedOrigin(req: Request) {
    const origin = String(req.headers.origin ?? '').trim();
    if (!origin) return;
    // Allow private LAN hosts used during local device testing (matches main.ts CORS).
    try {
      const host = new URL(origin).hostname.toLowerCase();
      const isLoopback =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '0.0.0.0';
      const isPrivate =
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
      // Windows/LAN machine names (e.g. http://Diku:8080) and mDNS (.local).
      const isLanHostname = !host.includes('.') || host.endsWith('.local');
      if (isLoopback || isPrivate || isLanHostname) return;
    } catch {
      // fall through to allow-list check
    }
    const allowed = new Set(
      [
        String(process.env.FRONTEND_URL ?? ''),
        String(process.env.API_PUBLIC_URL ?? ''),
        ...String(process.env.FRONTEND_URLS ?? '')
          .split(',')
          .map((item) => item.trim()),
        'https://ecommreco.com',
        'https://www.ecommreco.com',
        'https://uat.ecommreco.com',
        'https://dev.ecommreco.com',
        'http://localhost:8080',
        'http://127.0.0.1:8080',
      ]
        .filter(Boolean)
        .map((item) => this.normalizeOrigin(item)),
    );
    const normalized = this.normalizeOrigin(origin);
    if (!allowed.has(normalized)) {
      throw new ForbiddenException({
        success: false,
        message: 'Request origin is not allowed.',
        errorCode: 'ORIGIN_NOT_ALLOWED',
      });
    }
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
      message:
        'If an account exists for this mobile number, an OTP has been sent.',
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
  @ApiOperation({
    summary: 'Health check',
    description: 'Returns server health status',
  })
  health() {
    return this.authService.health();
  }

  @Get('database-connection')
  @ApiOperation({
    summary: 'Check database connection',
    description: 'Tests MongoDB connectivity',
  })
  databaseConnection() {
    return this.authService.databaseConnection();
  }

  @Post('forgot-password-legacy')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Forgot password (legacy email stub)',
    description:
      'Deprecated email-only stub. Use forgot-password with mobile OTP.',
    security: [],
  })
  forgotPasswordLegacy(@Body() dto: { email?: string }) {
    void dto;
    return {
      success: true,
      message: 'If the email exists, a reset link has been sent.',
    };
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  // Override the global 10/min default — short wrong-password loops must not
  // lock sellers out of the only unauthenticated entry point.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Login',
    description:
      'Authenticate user with email and password. Returns a JWT access token and sets an httpOnly refresh cookie.',
    security: [],
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertTrustedOrigin(req);
    const result = await this.authService.login(dto, req);
    const refreshToken = String(result?.data?.refreshToken ?? '').trim();
    if (refreshToken) {
      setRefreshCookie(res, refreshToken);
    }
    return this.authService.stripRefreshTokenFromResult(result);
  }

  @Post('refresh-token')
  @SkipThrottle()
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Exchange a valid refresh token (httpOnly cookie, or body for legacy clients) for a new access token.',
    security: [],
  })
  async refreshToken(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertTrustedOrigin(req);
    const refreshToken =
      String(dto.refreshToken ?? '').trim() || readRefreshCookie(req);
    const result = await this.authService.refreshAccessToken(refreshToken, req);
    const rotatedRefresh = String(result?.data?.refreshToken ?? '').trim();
    if (rotatedRefresh) {
      setRefreshCookie(res, rotatedRefresh);
    }
    return this.authService.stripRefreshTokenFromResult(result);
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
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string },
    @Headers('authorization') authorization?: string,
  ) {
    this.assertTrustedOrigin(req);
    let userId = req.user?.id;
    let sessionId = req.user?.sessionId;
    const bearer = String(authorization ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    if ((!userId || !sessionId) && bearer) {
      try {
        const decoded = await this.authService.decodeAccessToken(bearer);
        userId = userId || decoded.sub;
        sessionId = sessionId || decoded.sessionId;
      } catch {
        // ignore — may already be expired
      }
    }
    const refreshToken =
      String(body?.refreshToken ?? '').trim() || readRefreshCookie(req);
    const result = await this.authService.logout({
      userId,
      sessionId,
      refreshToken,
    });
    clearRefreshCookie(res);
    return result;
  }

  @Post('bootstrap-super-admin')
  @ApiOperation({
    summary: 'Bootstrap super admin',
    description:
      'Create the first super admin account. Requires valid setup token in x-setup-token header.',
  })
  bootstrapSuperAdmin(
    @Headers('x-setup-token') setupToken: string | undefined,
    @Body() dto: BootstrapSuperAdminDto,
  ) {
    return this.authService.bootstrapSuperAdmin({ setupToken }, dto);
  }

  @Get('debug-db')
  @ApiOperation({
    summary: 'Debug database',
    description: 'Returns database statistics. Requires x-setup-token header.',
  })
  debugDb(@Headers('x-setup-token') setupToken: string | undefined) {
    return this.authService.debugDb({ setupToken });
  }

  @Get('debug-super-admin')
  @ApiOperation({
    summary: 'Debug super admin',
    description: 'Debug super admin account. Requires x-setup-token header.',
  })
  debugSuperAdmin(@Headers('x-setup-token') setupToken: string | undefined) {
    return this.authService.debugSuperAdmin({ setupToken });
  }

  @Get('debug-identity')
  @ApiOperation({
    summary: 'Debug identity lookup',
    description:
      'Look up user or seller by identifier. Requires x-setup-token header.',
  })
  debugIdentity(
    @Headers('x-setup-token') setupToken: string | undefined,
    @Query('identifier') identifier: string | undefined,
  ) {
    return this.authService.debugIdentity({ setupToken }, { identifier });
  }

  @Post('dev-reset-password')
  @ApiOperation({
    summary: 'Reset password (dev only)',
    description:
      'Reset user or seller password. Requires x-setup-token header. Do not use in production.',
  })
  devResetPassword(
    @Headers('x-setup-token') setupToken: string | undefined,
    @Body() dto: DevResetPasswordDto,
  ) {
    return this.authService.devResetPassword({ setupToken }, dto);
  }
}
