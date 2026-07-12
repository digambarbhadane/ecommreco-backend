import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { CreatePanSlotRequestDto } from './dto/create-pan-slot-request.dto';
import { GeneratePaymentLinkDto } from './dto/generate-payment-link.dto';
import {
  AdminRemarksDto,
  PaymentProofDto,
  VerifyPaymentDto,
} from './dto/admin-action.dto';
import { PanSlotRequestsService } from './pan-slot-requests.service';

type RequestWithUser = Request & {
  user?: { id?: string; role?: string; email?: string; fullName?: string; name?: string };
};

@ApiTags('PAN Slot Requests')
@ApiBearerAuth()
@Controller('pan-slot-requests')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PanSlotRequestsController {
  constructor(private readonly panSlotRequestsService: PanSlotRequestsService) {}

  @Post()
  @Roles('seller')
  @ApiOperation({ summary: 'Create PAN slot request (seller)' })
  create(@Body() dto: CreatePanSlotRequestDto, @Req() req: RequestWithUser) {
    return this.panSlotRequestsService.createForSeller(req.user ?? {}, dto);
  }

  @Get()
  @Roles('seller')
  @ApiOperation({ summary: 'List own PAN slot requests (seller)' })
  listMine(@Req() req: RequestWithUser) {
    return this.panSlotRequestsService.listForSeller(req.user ?? {});
  }

  @Get('pricing')
  @Roles('seller', 'super_admin')
  @ApiOperation({ summary: 'List PAN slot pricing tiers' })
  listPricing() {
    return this.panSlotRequestsService.listPricing();
  }

  @Get('quote')
  @Roles('seller', 'super_admin')
  @ApiOperation({ summary: 'Get estimated amount with GST breakdown' })
  getQuote(
    @Query('requestedPanSlots') requestedPanSlots: string,
    @Query('durationType') durationType: string,
  ) {
    return this.panSlotRequestsService.getQuote(
      Number(requestedPanSlots),
      durationType,
    );
  }

  @Get(':id')
  @Roles('seller')
  @ApiOperation({ summary: 'Get PAN slot request by id (seller)' })
  getById(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.panSlotRequestsService.getByIdForSeller(req.user ?? {}, id);
  }

  @Post(':id/payment-proof')
  @Roles('seller')
  @ApiOperation({ summary: 'Upload payment proof (seller)' })
  uploadProof(
    @Param('id') id: string,
    @Body() body: PaymentProofDto,
    @Req() req: RequestWithUser,
  ) {
    return this.panSlotRequestsService.uploadPaymentProof(req.user ?? {}, id, body);
  }

  @Post(':id/mark-payment-completed')
  @Roles('seller')
  @ApiOperation({ summary: 'Mark payment completed (seller)' })
  markPaymentCompleted(
    @Param('id') id: string,
    @Body() body: PaymentProofDto,
    @Req() req: RequestWithUser,
  ) {
    return this.panSlotRequestsService.markPaymentCompleted(
      req.user ?? {},
      id,
      body.paymentReference,
    );
  }

  @Post(':id/cancel')
  @Roles('seller')
  @ApiOperation({ summary: 'Cancel PAN slot request (seller)' })
  cancel(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.panSlotRequestsService.cancelBySeller(req.user ?? {}, id);
  }
}
