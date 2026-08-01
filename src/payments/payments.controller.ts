import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreatePaymentOrderDto } from './dto/create-order.dto';
import {
  CancelSubscriptionDto,
  RenewSubscriptionDto,
  RefundPaymentDto,
  VerifyPaymentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';
import { PaymentWebhookService } from './payment-webhook.service';
import { PaymentLogService } from './payment-log.service';

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
};

type RequestWithUser = Request & { user?: RequestUser };

@ApiTags('Payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly webhookService: PaymentWebhookService,
    private readonly paymentLog: PaymentLogService,
  ) {}

  @Get('subscription/plans')
  @ApiOperation({ summary: 'List available subscription plans' })
  listPlans() {
    return this.paymentsService.listPlans();
  }

  @Post('payments/create-order')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller', 'super_admin')
  @ApiOperation({ summary: 'Create Cashfree payment order' })
  createOrder(
    @Body() dto: CreatePaymentOrderDto,
    @Req() req: RequestWithUser,
  ) {
    return this.paymentsService.createOrder(dto, req.user);
  }

  @Post('payments/verify')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller', 'super_admin')
  @ApiOperation({ summary: 'Verify payment with Cashfree' })
  verifyPayment(
    @Body() dto: VerifyPaymentDto,
    @Req() req: RequestWithUser,
  ) {
    return this.paymentsService.verifyPayment(dto, req.user);
  }

  @Get('payments/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller', 'super_admin')
  @ApiOperation({ summary: 'Get payment history' })
  paymentHistory(
    @Req() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.getPaymentHistory(
      req.user,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get('subscription/current')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller', 'super_admin')
  @ApiOperation({ summary: 'Get current subscription' })
  currentSubscription(@Req() req: RequestWithUser) {
    return this.paymentsService.getCurrentSubscription(req.user);
  }

  @Post('subscription/renew')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  @ApiOperation({ summary: 'Renew subscription' })
  renewSubscription(
    @Body() dto: RenewSubscriptionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.paymentsService.renewSubscription(dto, req.user);
  }

  @Post('subscription/cancel')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller')
  @ApiOperation({ summary: 'Cancel subscription' })
  cancelSubscription(
    @Body() dto: CancelSubscriptionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.paymentsService.cancelSubscription(dto, req.user);
  }

  @Post('payments/refund')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  @ApiOperation({ summary: 'Initiate refund (admin only)' })
  refundPayment(
    @Body() dto: RefundPaymentDto,
    @Req() req: RequestWithUser,
  ) {
    return this.paymentsService.refundPayment(dto, req.user);
  }

  @Get('payments/admin/dashboard')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  @ApiOperation({ summary: 'Admin payment dashboard metrics' })
  adminDashboard() {
    return this.paymentsService.getAdminDashboard();
  }

  @Get('payments/invoices/:invoiceNumber/download')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('seller', 'super_admin')
  @ApiOperation({ summary: 'Download invoice PDF' })
  async downloadInvoice(
    @Param('invoiceNumber') invoiceNumber: string,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ) {
    const { pdfPath, invoice } = await this.paymentsService.downloadInvoice(
      invoiceNumber,
      req.user,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${invoiceNumber}.pdf"`,
    );
    fs.createReadStream(pdfPath).pipe(res);
  }

  @Get('payments/logs')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Search payment audit logs' })
  paymentLogs(
    @Query('orderId') orderId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('eventType') eventType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentLog.list({
      orderId,
      sellerId,
      eventType: eventType as any,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Post('webhooks/cashfree')
  @ApiOperation({ summary: 'Cashfree payment webhook' })
  async cashfreeWebhook(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Headers('x-webhook-signature') signature?: string,
    @Headers('x-webhook-timestamp') timestamp?: string,
  ) {
    const rawBody =
      (req as Request & { rawBody?: string }).rawBody ??
      JSON.stringify(body);
    return this.webhookService.handleCashfreeWebhook(
      rawBody,
      signature ?? '',
      timestamp,
      body as any,
    );
  }
}
