import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { GeneratePaymentLinkDto } from './dto/generate-payment-link.dto';
import {
  AdminRemarksDto,
  UpdatePricingDto,
  VerifyPaymentDto,
} from './dto/admin-action.dto';
import { PanSlotRequestsService } from './pan-slot-requests.service';

type RequestWithUser = Request & {
  user?: {
    id?: string;
    role?: string;
    email?: string;
    fullName?: string;
    name?: string;
  };
};

@ApiTags('PAN Slot Requests (Admin)')
@ApiBearerAuth()
@Controller('admin/pan-slot-requests')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PanSlotRequestsAdminController {
  constructor(
    private readonly panSlotRequestsService: PanSlotRequestsService,
  ) {}

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'List all PAN slot requests' })
  list(
    @Query('status') status?: string,
    @Query('sellerId') sellerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    return this.panSlotRequestsService.adminList({
      status,
      sellerId,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('revenue-report')
  @Roles('super_admin')
  @ApiOperation({ summary: 'PAN slot revenue report' })
  revenueReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    return this.panSlotRequestsService.revenueReport({ from, to, sellerId });
  }

  @Get(':id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Get PAN slot request by id' })
  getById(@Param('id') id: string) {
    return this.panSlotRequestsService.adminGetById(id);
  }

  @Put(':id/approve')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Approve request for payment processing' })
  approve(
    @Param('id') id: string,
    @Body() body: AdminRemarksDto,
    @Req() req: RequestWithUser,
  ) {
    return this.panSlotRequestsService.adminApprove(
      id,
      req.user ?? {},
      body.adminRemarks,
    );
  }

  @Put(':id/reject')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Reject PAN slot request' })
  reject(
    @Param('id') id: string,
    @Body() body: AdminRemarksDto,
    @Req() req: RequestWithUser,
  ) {
    return this.panSlotRequestsService.adminReject(
      id,
      req.user ?? {},
      body.adminRemarks,
    );
  }

  @Put(':id/generate-payment-link')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Generate payment link for request' })
  generatePaymentLink(
    @Param('id') id: string,
    @Body() dto: GeneratePaymentLinkDto,
    @Req() req: RequestWithUser,
  ) {
    return this.panSlotRequestsService.adminGeneratePaymentLink(
      id,
      req.user ?? {},
      dto,
    );
  }

  @Put(':id/verify-payment')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Verify seller payment' })
  verifyPayment(
    @Param('id') id: string,
    @Body() body: VerifyPaymentDto,
    @Req() req: RequestWithUser,
  ) {
    return this.panSlotRequestsService.adminVerifyPayment(
      id,
      req.user ?? {},
      body,
    );
  }

  @Put(':id/assign-slots')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Assign purchased PAN slots to seller' })
  assignSlots(
    @Param('id') id: string,
    @Body() body: AdminRemarksDto,
    @Req() req: RequestWithUser,
  ) {
    return this.panSlotRequestsService.adminAssignSlots(
      id,
      req.user ?? {},
      body.adminRemarks,
    );
  }
}

@ApiTags('PAN Slot Transactions (Admin)')
@ApiBearerAuth()
@Controller('admin/pan-slot-transactions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PanSlotTransactionsAdminController {
  constructor(
    private readonly panSlotRequestsService: PanSlotRequestsService,
  ) {}

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'List PAN slot transactions (audit)' })
  list(
    @Query('sellerId') sellerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    return this.panSlotRequestsService.adminListTransactions({
      sellerId,
      from,
      to,
      status,
      limit: limit ? Number(limit) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }
}

@ApiTags('PAN Slot Pricing (Admin)')
@ApiBearerAuth()
@Controller('admin/pan-slot-pricing')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PanSlotPricingAdminController {
  constructor(
    private readonly panSlotRequestsService: PanSlotRequestsService,
  ) {}

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'List pricing configuration' })
  list() {
    return this.panSlotRequestsService.listPricing();
  }

  @Put(':durationType')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Update pricing for a duration tier' })
  update(
    @Param('durationType') durationType: string,
    @Body() body: UpdatePricingDto,
  ) {
    return this.panSlotRequestsService.updatePricing(durationType, body);
  }
}
