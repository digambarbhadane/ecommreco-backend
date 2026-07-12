import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingService } from './billing.service';

type RequestWithUser = Request & {
  user?: { id?: string; role?: string; email?: string; fullName?: string; name?: string };
};

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('seller')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get seller billing summary and invoices' })
  getSummary(@Req() req: RequestWithUser) {
    return this.billingService.getSummary(req.user ?? {});
  }

  @Get('invoices/:invoiceId/download')
  @ApiOperation({ summary: 'Download invoice as HTML (printable PDF)' })
  async downloadInvoice(
    @Param('invoiceId') invoiceId: string,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ) {
    const { html, filename } = await this.billingService.buildInvoiceDownload(
      req.user ?? {},
      invoiceId,
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  }
}
