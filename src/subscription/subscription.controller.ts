import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import { CreateSubscriptionPackageDto } from './dto/create-package.dto';
import { UpdateSubscriptionPackageDto } from './dto/update-package.dto';
import { SubscriptionService } from './subscription.service';

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  fullName?: string;
  username?: string;
  name?: string;
};

type RequestWithUser = Request & { user?: RequestUser };

@ApiTags('Subscriptions')
@ApiBearerAuth()
@Controller('subscription')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post('package')
  @ApiOperation({ summary: 'Create subscription package' })
  @Roles('super_admin')
  createPackage(
    @Body() dto: CreateSubscriptionPackageDto,
    @Req() req: RequestWithUser,
  ) {
    return this.subscriptionService.createPackage(dto, req.user);
  }

  @Get('package')
  @ApiOperation({ summary: 'List all subscription packages' })
  @Roles('super_admin')
  listPackages() {
    return this.subscriptionService.listPackages(true);
  }

  @Patch('package/:id')
  @ApiOperation({ summary: 'Update subscription package' })
  @Roles('super_admin')
  updatePackage(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPackageDto,
    @Req() req: RequestWithUser,
  ) {
    return this.subscriptionService.updatePackage(id, dto, req.user);
  }

  @Delete('package/:id')
  @ApiOperation({ summary: 'Delete subscription package (soft delete)' })
  @Roles('super_admin')
  deletePackage(@Param('id') id: string) {
    return this.subscriptionService.softDeletePackage(id);
  }

  @Get('package/active')
  @ApiOperation({ summary: 'List active subscription packages' })
  @Roles('super_admin', 'sales_manager')
  listActivePackages() {
    return this.subscriptionService.listPackages(false);
  }

  @Post('assign')
  @ApiOperation({ summary: 'Assign subscription to lead', description: 'Assign a subscription package to a lead.' })
  @Roles('super_admin', 'sales_manager')
  assignSubscription(
    @Body() dto: AssignSubscriptionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.subscriptionService.assignSubscription(dto, req.user);
  }

  @Get(':leadId')
  @ApiOperation({ summary: 'Get lead subscription details' })
  @Roles('super_admin', 'sales_manager')
  getLeadSubscription(
    @Param('leadId') leadId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.subscriptionService.getLeadSubscription(leadId, req.user);
  }

  @Post(':leadId/send-payment-link')
  @ApiOperation({ summary: 'Send payment link email', description: 'Send Cashfree payment link email to lead.' })
  @Roles('super_admin', 'sales_manager')
  sendPaymentLinkEmail(
    @Param('leadId') leadId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.subscriptionService.sendPaymentLinkEmail(leadId, req.user);
  }
}
