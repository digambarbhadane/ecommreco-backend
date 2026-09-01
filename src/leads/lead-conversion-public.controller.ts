import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import {
  LeadConversionConfirmByLinkDto,
  LeadConversionPublicConfirmDto,
} from './dto/lead-conversion-checkout.dto';
import { LeadConversionPaymentService } from './lead-conversion-payment.service';

@ApiTags('Lead Conversion Payment')
@Controller('leads/conversion-payment')
export class LeadConversionPublicController {
  constructor(
    private readonly conversionPayment: LeadConversionPaymentService,
  ) {}

  @Post('confirm-by-link')
  @ApiOperation({ summary: 'Confirm Cashfree payment link after seller payment' })
  confirmByLink(@Body() dto: LeadConversionConfirmByLinkDto) {
    return this.conversionPayment.confirmByLinkId(dto.linkId);
  }

  @Get(':token')
  @ApiOperation({ summary: 'Validate lead conversion payment link (legacy token)' })
  getCheckout(@Param('token') token: string) {
    return this.conversionPayment.getPublicCheckout(token);
  }

  @Post(':token/checkout')
  @ApiOperation({ summary: 'Create checkout session (legacy token flow)' })
  checkout(@Param('token') token: string) {
    return this.conversionPayment.checkoutFromPublicLink(token);
  }

  @Post(':token/confirm')
  @ApiOperation({ summary: 'Confirm payment (legacy token flow)' })
  confirm(
    @Param('token') token: string,
    @Body() dto: LeadConversionPublicConfirmDto,
  ) {
    return this.conversionPayment.confirmPaymentPublic(token, dto.orderId);
  }
}
