import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AdminTrialActionDto,
  ConfirmTrialPaymentDto,
  ConfirmSubscriptionPurchaseDto,
  ListTrialsQueryDto,
  PurchaseTrialSubscriptionDto,
  RegisterTrialDto,
} from './dto/trial.dto';
import { TrialService } from './trial.service';
import { OnboardingRegistrationService } from '../onboarding/services/onboarding-registration.service';
import { isOnboardingV2Enabled } from '../onboarding/constants/onboarding-status';

@ApiTags('Trial')
@Controller('trial')
export class TrialController {
  constructor(
    private readonly trialService: TrialService,
    private readonly onboardingRegistration: OnboardingRegistrationService,
    private readonly config: ConfigService,
  ) {}

  private useOnboardingV2() {
    return isOnboardingV2Enabled(this.config.get<string>('ONBOARDING_V2_ENABLED'));
  }

  @Get('pricing')
  @ApiOperation({ summary: 'Public trial and plan pricing info' })
  getPricing() {
    return this.trialService.getPricing();
  }

  @Get('packages')
  @ApiOperation({ summary: 'Active subscription packages for upgrade' })
  listPackages() {
    return this.trialService.listActivePackages();
  }

  @Post('register')
  @ApiOperation({ summary: 'Self-service trial registration' })
  register(@Body() dto: RegisterTrialDto) {
    if (this.useOnboardingV2()) {
      return this.onboardingRegistration.register({
        ...dto,
        ownerName: dto.ownerName,
        source: 'self_service_trial',
      });
    }
    return this.trialService.register(dto);
  }

  @Get('payment/:sellerId')
  @ApiOperation({ summary: 'Trial payment summary' })
  paymentSummary(@Param('sellerId') sellerId: string) {
    return this.trialService.getPaymentSummary(sellerId);
  }

  @Post('payment/:sellerId/init')
  @ApiOperation({ summary: 'Create Cashfree order for trial registration payment' })
  initTrialPayment(@Param('sellerId') sellerId: string) {
    return this.trialService.initTrialPayment(sellerId);
  }

  @Post('payment/:sellerId/confirm')
  @ApiOperation({ summary: 'Verify Cashfree payment and activate 7-day trial' })
  confirmPayment(
    @Param('sellerId') sellerId: string,
    @Body() dto: ConfirmTrialPaymentDto,
  ) {
    return this.trialService.confirmPayment(sellerId, dto);
  }

  @Get('me/status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller', 'super_admin')
  @ApiOperation({ summary: 'Current seller trial status' })
  myStatus(
    @Req() req: { user?: { sellerId?: string; sub?: string; id?: string } },
  ) {
    const sellerId = req.user?.sellerId || req.user?.sub || req.user?.id;
    return this.trialService.getSellerTrialStatus(String(sellerId));
  }

  @Post('me/quote')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  quote(
    @Req() req: { user?: { sellerId?: string; sub?: string; id?: string } },
    @Body() dto: PurchaseTrialSubscriptionDto,
  ) {
    const sellerId = req.user?.sellerId || req.user?.sub || req.user?.id;
    return this.trialService.quotePurchase(String(sellerId), dto);
  }

  @Post('me/purchase/init')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  @ApiOperation({
    summary: 'Create pending subscription checkout (does not activate yet)',
  })
  initPurchase(
    @Req() req: { user?: { sellerId?: string; sub?: string; id?: string } },
    @Body() dto: PurchaseTrialSubscriptionDto,
  ) {
    const sellerId = req.user?.sellerId || req.user?.sub || req.user?.id;
    return this.trialService.initPurchaseSubscription(String(sellerId), dto);
  }

  @Post('me/purchase/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  @ApiOperation({
    summary: 'Confirm gateway payment and activate subscription',
  })
  confirmPurchase(
    @Req() req: { user?: { sellerId?: string; sub?: string; id?: string } },
    @Body() dto: ConfirmSubscriptionPurchaseDto,
  ) {
    const sellerId = req.user?.sellerId || req.user?.sub || req.user?.id;
    return this.trialService.confirmPurchaseSubscription(String(sellerId), dto);
  }

  @Post('me/purchase')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  @ApiOperation({
    summary: 'Deprecated — use purchase/init then purchase/confirm',
  })
  purchase(
    @Req() req: { user?: { sellerId?: string; sub?: string; id?: string } },
    @Body() dto: PurchaseTrialSubscriptionDto,
  ) {
    const sellerId = req.user?.sellerId || req.user?.sub || req.user?.id;
    return this.trialService.purchaseSubscription(String(sellerId), dto);
  }

  @Get('admin/summary')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  adminSummary() {
    return this.trialService.adminSummary();
  }

  @Get('admin/list')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  adminList(@Query() query: ListTrialsQueryDto) {
    return this.trialService.adminList(query);
  }

  @Get('admin/:trialId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  adminDetail(@Param('trialId') trialId: string) {
    return this.trialService.adminDetail(trialId);
  }

  @Post('admin/:trialId/extend')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  extend(
    @Param('trialId') trialId: string,
    @Body() dto: AdminTrialActionDto,
    @Req() req: { user?: { sub?: string; id?: string } },
  ) {
    return this.trialService.adminExtend(
      trialId,
      dto,
      req.user?.sub || req.user?.id,
    );
  }

  @Post('admin/:trialId/end')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  end(
    @Param('trialId') trialId: string,
    @Req() req: { user?: { sub?: string; id?: string } },
  ) {
    return this.trialService.adminEndTrial(
      trialId,
      req.user?.sub || req.user?.id,
    );
  }

  @Post('admin/:trialId/suspend')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  suspend(
    @Param('trialId') trialId: string,
    @Body() dto: AdminTrialActionDto,
    @Req() req: { user?: { sub?: string; id?: string } },
  ) {
    return this.trialService.adminSuspend(
      trialId,
      dto,
      req.user?.sub || req.user?.id,
    );
  }

  @Post('admin/:trialId/delete-data')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  deleteData(
    @Param('trialId') trialId: string,
    @Req() req: { user?: { sub?: string; id?: string } },
  ) {
    return this.trialService.adminDeleteTrialData(
      trialId,
      req.user?.sub || req.user?.id,
    );
  }
}
