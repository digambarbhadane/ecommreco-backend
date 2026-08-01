import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ContactSalesDto,
  OnboardingConfirmPaymentDto,
  OnboardingConfirmPublicDto,
  OnboardingRegisterDto,
} from './dto/onboarding.dto';
import { OnboardingService } from './services/onboarding.service';

type RequestUser = { id?: string; sub?: string; role?: string };

@ApiTags('Onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register for trial (always succeeds; payment separate)' })
  register(@Body() dto: OnboardingRegisterDto) {
    return this.onboardingService.register(dto);
  }

  @Get('payment-links/:token')
  @ApiOperation({ summary: 'Validate sales payment link token' })
  validatePaymentLink(@Param('token') token: string) {
    return this.onboardingService.validatePaymentLink(token);
  }

  @Post('payment-links/:token/checkout')
  @ApiOperation({ summary: 'Start checkout from sales payment link' })
  checkoutFromLink(@Param('token') token: string) {
    return this.onboardingService.checkoutFromPaymentLink(token);
  }

  @Post('payment/confirm-public')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify payment after checkout (no auth; email must match order)' })
  confirmPaymentPublic(@Body() dto: OnboardingConfirmPublicDto) {
    return this.onboardingService.verifyAndActivateByEmail(dto.orderId, dto.email);
  }

  @Post('payment/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  @ApiOperation({ summary: 'Verify payment and activate trial' })
  confirmPayment(
    @Body() dto: OnboardingConfirmPaymentDto,
    @Req() req: { user?: RequestUser },
  ) {
    const userId = String(req.user?.id ?? req.user?.sub ?? '');
    return this.onboardingService.verifyAndActivate(userId, dto.orderId);
  }

  @Post('payment/retry')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  @ApiOperation({ summary: 'Create new payment attempt for pending user' })
  retryPayment(@Req() req: { user?: RequestUser }) {
    const userId = String(req.user?.id ?? req.user?.sub ?? '');
    return this.onboardingService.resumePayment(userId);
  }

  @Get('me/status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  myStatus(@Req() req: { user?: RequestUser }) {
    const userId = String(req.user?.id ?? req.user?.sub ?? '');
    return this.onboardingService.getMyStatus(userId);
  }

  @Get('me/payments')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  myPayments(@Req() req: { user?: RequestUser }) {
    const userId = String(req.user?.id ?? req.user?.sub ?? '');
    return this.onboardingService.getPaymentHistory(userId);
  }

  @Post('contact-sales')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  contactSales(
    @Body() dto: ContactSalesDto,
    @Req() req: { user?: RequestUser },
  ) {
    const userId = String(req.user?.id ?? req.user?.sub ?? '');
    return this.onboardingService.contactSales(userId, dto.message);
  }
}
