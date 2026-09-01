import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiProduces,
} from '@nestjs/swagger';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListImportedRowsDto } from './dto/list-imported-rows.dto';
import { ListAnalyticsOrdersDto } from './dto/list-analytics-orders.dto';
import { ListAnalyticsPaymentsDto } from './dto/list-analytics-payments.dto';
import { ListAnalyticsPayoutsDto } from './dto/list-analytics-payouts.dto';
import { GetAnalyticsPayoutDetailsDto } from './dto/get-analytics-payout-details.dto';
import { UpsertPayoutReceiptDto } from './dto/upsert-payout-receipt.dto';
import { ResetPayoutReceiptDto } from './dto/reset-payout-receipt.dto';
import { UploadReportDto } from './dto/upload-report.dto';
import { ReportImportService } from './report-import.service';
import { UploadService } from './services/upload.service';
import { ImportSessionService } from './services/import-session.service';
import { ImportWorkflowService } from './services/import-workflow.service';
import { ImportJobService } from './services/import-job.service';
import { ReconciliationService } from './services/reconciliation.service';
import { DeleteSlotDto, WorkflowStatusDto } from './dto/import-workflow.dto';
import {
  MarketplaceUploadKey,
  ReportUploadMultipart,
} from './marketplace-upload.routes';
import { StateWiseReportService } from './services/state-wise-report.service';
import { StateSkuWiseReportService } from './services/state-sku-wise-report.service';
import { StateWiseExportDto } from './dto/state-wise-export.dto';
import { Gstr1B2csExportDto } from './dto/gstr1-b2cs-export.dto';
import { Gstr1B2csReportService } from './services/gstr1-b2cs-report.service';
import { GeographyAnalyticsService } from './services/geography-analytics.service';
import { GeographyAnalyticsDto } from './dto/geography-analytics.dto';
import { MulterExceptionFilter } from './filters/multer-exception.filter';
import type { Request } from 'express';
import type { UploadedReportFiles } from './marketplace-upload.routes';
import { MULTER_UPLOAD_LIMITS } from '../config/upload-limits';

type RequestWithUser = Request & {
  user?: { id?: string; email?: string; name?: string; role?: string };
};

@ApiTags('Report-Import')
@ApiBearerAuth()
@Controller('report-imports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@UseFilters(MulterExceptionFilter)
export class ReportImportController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly reportImportService: ReportImportService,
    private readonly importSessionService: ImportSessionService,
    private readonly importWorkflowService: ImportWorkflowService,
    private readonly importJobService: ImportJobService,
    private readonly reconciliationService: ReconciliationService,
    private readonly stateWiseReportService: StateWiseReportService,
    private readonly stateSkuWiseReportService: StateSkuWiseReportService,
    private readonly gstr1B2csReportService: Gstr1B2csReportService,
    private readonly geographyAnalyticsService: GeographyAnalyticsService,
  ) {}

  @Post('import-session')
  @ApiOperation({
    summary: 'Start multi-file import session',
    description:
      'Create a session, upload each Excel file separately, then commit. Avoids single huge upload timeouts.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  createImportSession(
    @Query('marketplace') marketplace: string,
    @Body() dto: UploadReportDto,
  ) {
    const key = (marketplace ?? '')
      .trim()
      .toLowerCase() as MarketplaceUploadKey;
    if (!['flipkart', 'amazon', 'meesho', 'myntra'].includes(key)) {
      throw new BadRequestException('marketplace query is required');
    }
    return this.importSessionService.createSession(key, dto);
  }

  @Post('import-session/:sessionId/file')
  @ApiOperation({ summary: 'Add one report file to import session' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: MULTER_UPLOAD_LIMITS,
    }),
  )
  @Roles('seller', 'super_admin', 'accounts_manager')
  addImportSessionFile(
    @Param('sessionId') sessionId: string,
    @Body('slot') slot: string,
    @Body('sellerId') sellerId: string,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('file is required');
    }
    if (!slot?.trim()) {
      throw new BadRequestException('slot is required');
    }
    if (!sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.importSessionService.addFile(
      sessionId,
      sellerId.trim(),
      slot.trim(),
      {
        buffer: file.buffer,
        originalname: file.originalname,
      },
    );
  }

  @Post('import-session/:sessionId/commit')
  @ApiOperation({
    summary: 'Commit import session',
    description: 'Parse Excel data in memory and save rows to the database.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  commitImportSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: UploadReportDto,
  ) {
    return this.importSessionService.commit(sessionId, dto);
  }

  @Get('config')
  @ApiOperation({
    summary: 'Get import config',
    description:
      'Returns required sheets and columns for a marketplace import.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  getConfig(@Query('marketplace') marketplace?: string) {
    const name = (marketplace ?? '').trim().toLowerCase();
    if (name && name.includes('amazon')) {
      return {
        success: true,
        data: {
          marketplace: 'amazon',
          requiredSheets: [
            'MTR B2B Report (single sheet)',
            'MTR B2C Report (single sheet)',
          ],
          requiredColumns: {
            'MTR B2C Report': [
              'Seller Gstin',
              'Order Id',
              'Sku',
              'Hsn/sac',
              'Transaction Type',
              'Payment Method / Payment Method Code',
              'Fullfilment Channel',
              'Quantity',
              'Invoice Amount',
              'Tax Exclusive Gross',
              'Igst Rate',
              'Igst Tax',
              'Cgst Rate',
              'Cgst Tax',
              'Sgst Rate',
              'Sgst Tax',
              'Invoice Number',
              'Invoice Date',
              'Ship To Postal Code',
              'Ship To State',
            ],
            'MTR B2B Report (if uploaded)': [
              'Seller Gstin',
              'Order Id',
              'Sku',
              'Hsn/sac',
              'Transaction Type',
              'Payment Method / Payment Method Code',
              'Fullfilment Channel',
              'Quantity',
              'Invoice Amount',
              'Tax Exclusive Gross',
              'Igst Rate',
              'Igst Tax',
              'Cgst Rate',
              'Cgst Tax',
              'Sgst Rate',
              'Sgst Tax',
              'Invoice Number',
              'Invoice Date',
              'Ship To Postal Code',
              'Ship To State',
              'Customer Bill To Gstid (mandatory in B2B)',
              'Buyer Name (mandatory in B2B)',
            ],
          },
        },
      };
    }
    if (name && name.includes('myntra')) {
      return {
        success: true,
        data: {
          marketplace: 'myntra',
          processingNote:
            'Upload the 4 required reports together (MDirect Orders and Returns are optional). Rows are built from Sales Revenue Packed B2C and enriched by order id. GSTR RTO marks RTO Return; GSTR RT marks Customer Return.',
          requiredSheets: [
            'GSTR Report Packed',
            'Sales Revenue Packed B2C (primary)',
            'GSTR Report RTO',
            'GSTR Report RT',
          ],
          optionalSheets: ['MDirect Orders Report', 'MDirect Returns Report'],
          requiredColumns: {
            'GSTR Report Packed': [
              'seller_gstin',
              'order_id',
              'payment_method',
              'seller_type',
              'quantity',
              'seller_price',
              'base_value',
              'igst_rate',
              'igst_amt',
              'cgst_rate',
              'cgst_amt',
              'sgst_rate',
              'sgst_amt',
              'customer_delivery_state_code',
            ],
            'MDirect Orders Report (optional)': [
              'order_release_id',
              'seller_sku_code',
            ],
            'Sales Revenue Packed B2C': [
              'Sale_Order_Code',
              'Invoice_Number',
              'Packing_Date',
            ],
            'GSTR Report RTO': ['tax_seller_gstin', 'order_id'],
            'GSTR Report RT': ['tax_seller_gstin', 'shipment_id'],
            'MDirect Returns Report (optional)': ['order_id'],
          },
        },
      };
    }
    if (name && name.includes('meesho')) {
      return {
        success: true,
        data: {
          marketplace: 'meesho',
          processingNote:
            'Upload all 4 files together. Rows are built from TCS Sales Report and enriched by sub_order_num from the other reports.',
          requiredSheets: [
            'TCS Sales Report (primary — one row per order in DB)',
            'TCS Sales Return Report',
            'Order Report',
            'Return In-Transit Report',
            'Return Out for Delivery Report',
            'Return Delivery Complete Report',
          ],
          requiredColumns: {
            'TCS Sales Report': [
              'gstin',
              'sub_order_num',
              'hsn_code',
              'quantity',
              'total_invoice_value',
              'total_taxable_sale_value',
              'gst_rate',
              'tax_amount',
              'order_date',
              'end_customer_state_new',
            ],
            'Order Report': [
              'Sub Order No',
              'sub_order_num',
              'SKU',
              'Status',
              'Reason for Credit Entry',
            ],
            'TCS Sales Return Report': [
              'Sub Order No',
              'sub_order_num',
              'cancel_return_date',
              'Status',
            ],
            'Return lifecycle reports': [
              'Order Number',
              'Sub Order No',
              'sub_order_num',
              'Type of Return',
              'Sub Type',
              'Qty',
              'Return Reason',
              'Detailed Return Reason',
            ],
            'Meesho-only stored fields': [
              'Return Invoice Date',
              'meeshoTcsReturnStatus',
              'meeshoOrderStatus',
              'Type of Return',
              'Sub Type',
              'Return Qty',
              'Return Reason',
              'Detailed Return Reason',
            ],
          },
        },
      };
    }
    if (name && !name.includes('flipkart')) {
      return {
        success: true,
        data: {
          marketplace,
          supported: false,
          message: 'Marketplace config not found',
        },
      };
    }
    return {
      success: true,
      data: {
        marketplace: 'flipkart',
        requiredSheets: ['Sales Report', 'Cash Back Report'],
        requiredColumns: {
          'Sales Report': [
            'GST NO',
            'Order ID',
            'Invoice No',
            'Invoice Date',
            'Invoice Amount',
            'Taxable Amount',
            'Document Type',
          ],
          'Cash Back Report': [
            'GST NO',
            'Order ID',
            'Invoice No',
            'Invoice Date',
            'Invoice Amount',
            'Taxable Amount',
            'Payment Mode',
          ],
        },
      },
    };
  }

  @Post('flipkart/upload')
  @ApiOperation({
    summary: 'Upload Flipkart reports',
    description:
      'Upload Flipkart sales workbook via `file` and optional settlement/payment report via `paymentReportFile`.',
  })
  @ReportUploadMultipart()
  uploadFlipkart(
    @UploadedFiles() files: UploadedReportFiles,
    @Body() dto: UploadReportDto,
    @Req() req: RequestWithUser,
  ) {
    return this.dispatchMarketplaceUpload('flipkart', files, dto, req);
  }

  @Post('amazon/upload')
  @ApiOperation({
    summary: 'Upload Amazon reports',
    description:
      'Upload Amazon MTR reports via `mtrB2cFile` / `mtrB2bFile`, a return report via `amazonReturnReportFile`, or a standalone Payment Report via `paymentReportFile`.',
  })
  @ReportUploadMultipart()
  uploadAmazon(
    @UploadedFiles() files: UploadedReportFiles,
    @Body() dto: UploadReportDto,
    @Req() req: RequestWithUser,
  ) {
    return this.dispatchMarketplaceUpload('amazon', files, dto, req);
  }

  @Post('meesho/upload')
  @ApiOperation({
    summary: 'Upload Meesho reports',
    description:
      'Upload Meesho files month-wise: tcsSalesFile, tcsSalesReturnFile, orderReportFile, returnInTransitReportFile, returnOutForDeliveryReportFile, returnDeliveryCompleteReportFile, paymentReportFile (at least one required).',
  })
  @ReportUploadMultipart()
  uploadMeesho(
    @UploadedFiles() files: UploadedReportFiles,
    @Body() dto: UploadReportDto,
    @Req() req: RequestWithUser,
  ) {
    return this.dispatchMarketplaceUpload('meesho', files, dto, req);
  }

  @Post('myntra/upload')
  @ApiOperation({
    summary: 'Upload Myntra reports',
    description:
      'Upload Myntra reports: gstrReportPackedFile, salesRevenuePackedB2cFile, gstrReportRtoFile, gstrReportRtFile (required). mDirectOrdersReportFile and mDirectReturnsReportFile are optional. PG Forward/Reverse Settled payment reports via pgForwardSettledFile and pgReverseSettledFile.',
  })
  @ReportUploadMultipart()
  uploadMyntra(
    @UploadedFiles() files: UploadedReportFiles,
    @Body() dto: UploadReportDto,
    @Req() req: RequestWithUser,
  ) {
    return this.dispatchMarketplaceUpload('myntra', files, dto, req);
  }

  private dispatchMarketplaceUpload(
    marketplace: MarketplaceUploadKey,
    files: UploadedReportFiles,
    dto: UploadReportDto,
    req?: RequestWithUser,
  ) {
    const singleFile = files?.file?.[0];
    const mtrB2bFile = files?.mtrB2bFile?.[0];
    const mtrB2cFile = files?.mtrB2cFile?.[0];
    const tcsSalesFile = files?.tcsSalesFile?.[0];
    const tcsSalesReturnFile = files?.tcsSalesReturnFile?.[0];
    const orderReportFile = files?.orderReportFile?.[0];
    const returnInTransitReportFile = files?.returnInTransitReportFile?.[0];
    const returnOutForDeliveryReportFile =
      files?.returnOutForDeliveryReportFile?.[0];
    const returnDeliveryCompleteReportFile =
      files?.returnDeliveryCompleteReportFile?.[0];
    const paymentReportFile = files?.paymentReportFile?.[0];
    const gstrReportPackedFile = files?.gstrReportPackedFile?.[0];
    const mDirectOrdersReportFile = files?.mDirectOrdersReportFile?.[0];
    const salesRevenuePackedB2cFile = files?.salesRevenuePackedB2cFile?.[0];
    const gstrReportRtoFile = files?.gstrReportRtoFile?.[0];
    const gstrReportRtFile = files?.gstrReportRtFile?.[0];
    const mDirectReturnsReportFile = files?.mDirectReturnsReportFile?.[0];
    const pgForwardSettledFile = files?.pgForwardSettledFile?.[0];
    const pgReverseSettledFile = files?.pgReverseSettledFile?.[0];
    const amazonReturnReportFile = files?.amazonReturnReportFile?.[0];
    if (
      !singleFile &&
      !mtrB2bFile &&
      !mtrB2cFile &&
      !amazonReturnReportFile &&
      !tcsSalesFile &&
      !tcsSalesReturnFile &&
      !orderReportFile &&
      !returnInTransitReportFile &&
      !returnOutForDeliveryReportFile &&
      !returnDeliveryCompleteReportFile &&
      !paymentReportFile &&
      !gstrReportPackedFile &&
      !mDirectOrdersReportFile &&
      !salesRevenuePackedB2cFile &&
      !gstrReportRtoFile &&
      !gstrReportRtFile &&
      !mDirectReturnsReportFile &&
      !pgForwardSettledFile &&
      !pgReverseSettledFile
    ) {
      throw new BadRequestException('At least one file is required');
    }
    return this.uploadService.uploadMarketplaceReport(
      marketplace,
      {
        file: singleFile,
        mtrB2bFile,
        mtrB2cFile,
        tcsSalesFile,
        tcsSalesReturnFile,
        orderReportFile,
        returnInTransitReportFile,
        returnOutForDeliveryReportFile,
        returnDeliveryCompleteReportFile,
        paymentReportFile,
        gstrReportPackedFile,
        mDirectOrdersReportFile,
        salesRevenuePackedB2cFile,
        gstrReportRtoFile,
        gstrReportRtFile,
        mDirectReturnsReportFile,
        pgForwardSettledFile,
        pgReverseSettledFile,
        amazonReturnReportFile,
      },
      dto,
      {
        createdBy: req?.user?.email ?? req?.user?.id,
        reportType: marketplace,
      },
    );
  }

  @Get('analytics/orders/export')
  @ApiOperation({
    summary: 'Export analytics orders Excel',
    description:
      'Order Report export matching the filtered table columns as .xlsx.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Roles('seller', 'super_admin', 'accounts_manager')
  async exportAnalyticsOrders(
    @Query() query: ListAnalyticsOrdersDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    const result =
      await this.reportImportService.exportAnalyticsOrdersCsv(query);
    res.setHeader('X-Export-Row-Count', String(result.rowCount));
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Row-Count');
    return new StreamableFile(result.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  @Get('analytics/payments/export')
  @ApiOperation({
    summary: 'Export analytics payments CSV',
    description: 'Payment and settlement export for rows with payment data.',
  })
  @ApiProduces('text/csv')
  @Roles('seller', 'super_admin', 'accounts_manager')
  async exportAnalyticsPayments(
    @Query() query: ListAnalyticsPaymentsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    const result =
      await this.reportImportService.exportAnalyticsPaymentsCsv(query);
    res.setHeader('X-Export-Row-Count', String(result.rowCount));
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Row-Count');
    return new StreamableFile(result.buffer, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  @Get('analytics/orders/summary')
  @ApiOperation({
    summary: 'Analytics orders summary',
    description: 'Document-type breakdown for order analytics view.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  analyticsOrdersSummary(@Query() query: ListAnalyticsOrdersDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.reportImportService.getAnalyticsOrdersSummary(query);
  }

  @Get('analytics/payments/summary')
  @ApiOperation({
    summary: 'Analytics payments summary',
    description: 'Settlement totals and payment-mode breakdown.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  analyticsPaymentsSummary(@Query() query: ListAnalyticsPaymentsDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.reportImportService.getAnalyticsPaymentsSummary(query);
  }

  @Get('analytics/orders')
  @ApiOperation({
    summary: 'List analytics orders',
    description: 'Paginated order records without payment-only filtering.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  listAnalyticsOrders(@Query() query: ListAnalyticsOrdersDto) {
    return this.reportImportService.listAnalyticsOrders(query);
  }

  @Get('analytics/payments')
  @ApiOperation({
    summary: 'List analytics payments',
    description:
      'Paginated payment/settlement records (rows with payment data).',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  listAnalyticsPayments(@Query() query: ListAnalyticsPaymentsDto) {
    return this.reportImportService.listAnalyticsPayments(query);
  }

  @Get('analytics/payouts')
  @ApiOperation({
    summary: 'List analytics payouts by NEFT',
    description:
      'Portal-wise and NEFT-wise settlement totals with optional seller bank receipt data.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  listAnalyticsPayouts(@Query() query: ListAnalyticsPayoutsDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.reportImportService.listAnalyticsPayouts(query);
  }

  @Get('analytics/payouts/details')
  @ApiOperation({
    summary: 'Load payout expand line items for one NEFT',
    description:
      'Returns sheet line items for a single marketplace NEFT. Used when a payout row is expanded.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  getAnalyticsPayoutDetails(@Query() query: GetAnalyticsPayoutDetailsDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    if (!query.marketplace?.trim() || !query.neftId?.trim()) {
      throw new BadRequestException('marketplace and neftId are required');
    }
    return this.reportImportService.getAnalyticsPayoutDetails(query);
  }

  @Put('analytics/payouts/receipt')
  @ApiOperation({
    summary: 'Save bank receipt for a NEFT payout',
    description:
      'Upsert seller-entered bank receive date and amount for a marketplace NEFT settlement.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  upsertPayoutReceipt(
    @Body() dto: UpsertPayoutReceiptDto,
    @Req() req: RequestWithUser,
  ) {
    if (!dto.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.reportImportService.upsertPayoutReceipt(
      dto,
      req.user?.id ?? req.user?.email,
    );
  }

  @Post('analytics/payouts/receipt/reset')
  @ApiOperation({
    summary: 'Reset bank receipt for a NEFT payout',
    description:
      'Clears seller-entered bank receive date and amount so variance resets.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  resetPayoutReceipt(
    @Body() dto: ResetPayoutReceiptDto,
    @Req() req: RequestWithUser,
  ) {
    if (!dto.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.reportImportService.resetPayoutReceipt(
      dto,
      req.user?.id ?? req.user?.email,
    );
  }

  @Get('rows/export')
  @ApiOperation({
    summary: 'Export imported rows CSV',
    description:
      'Downloads all imported rows matching the current filters (GST, marketplace, document type, date range, search).',
  })
  @ApiProduces('text/csv')
  @Roles('seller', 'super_admin', 'accounts_manager')
  async exportRows(
    @Query() query: ListImportedRowsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    const result = await this.reportImportService.exportImportedRowsCsv(query);
    res.setHeader('X-Export-Row-Count', String(result.rowCount));
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Row-Count');
    return new StreamableFile(result.buffer, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  @Get('rows')
  @ApiOperation({
    summary: 'List imported rows',
    description: 'Returns paginated list of imported report rows.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  listRows(@Query() query: ListImportedRowsDto) {
    return this.reportImportService.listImportedRows(query);
  }

  @Get('platform-analytics')
  @ApiOperation({
    summary: 'Platform analytics',
    description:
      'Aggregated GMV, marketplace mix, seller performance, and category metrics across imported report data.',
  })
  @Roles('super_admin')
  platformAnalytics(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.reportImportService.getPlatformAnalytics({ fromDate, toDate });
  }

  @Get('analytics-bundle')
  @ApiOperation({
    summary: 'Seller dashboard + P&L bundle',
    description:
      'Combined seller dashboard stats and profit-loss metrics in one request (fewer round trips).',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  analyticsBundle(@Query() query: ListImportedRowsDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.reportImportService.getSellerAnalyticsBundle({
      sellerId: query.sellerId.trim(),
      gstin: query.gstin,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Seller dashboard stats',
    description:
      'Aggregated imported-row metrics for the seller dashboard (counts, amounts, trends, recent uploads).',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  dashboard(@Query() query: ListImportedRowsDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.reportImportService.getSellerDashboardStats({
      sellerId: query.sellerId.trim(),
      gstin: query.gstin,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
  }

  @Get('profit-loss')
  @ApiOperation({
    summary: 'Seller profit & loss stats',
    description:
      'P&L metrics from imported rows: revenue (sales), return loss, fees/tax, net profit, by marketplace and month.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  profitLoss(@Query() query: ListImportedRowsDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.reportImportService.getSellerProfitLossStats({
      sellerId: query.sellerId.trim(),
      gstin: query.gstin,
      marketplace: query.marketplace,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get import summary',
    description: 'Returns document type summary for imported reports.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  summary(@Query() query: ListImportedRowsDto) {
    return this.reportImportService.getDocumentTypeSummary(query);
  }

  @Get('summary/marketplaces')
  @ApiOperation({
    summary: 'Get marketplace document summary',
    description: 'Returns document type counts grouped by marketplace.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  marketplaceSummary(@Query() query: ListImportedRowsDto) {
    return this.reportImportService.getMarketplaceDocumentSummary(query);
  }

  @Get('month-status')
  @ApiOperation({
    summary: 'Month-wise upload status',
    description:
      'Returns which report files have been uploaded per month for a GST + marketplace (used by import UI).',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  monthStatus(
    @Query('sellerId') sellerId: string,
    @Query('gstId') gstId: string,
    @Query('marketplaceId') marketplaceId: string,
    @Query('marketplace') marketplace: string,
    @Query('reportMonth') reportMonth?: string,
  ) {
    if (!sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    if (!gstId?.trim()) {
      throw new BadRequestException('gstId is required');
    }
    if (!marketplaceId?.trim()) {
      throw new BadRequestException('marketplaceId is required');
    }
    const allowed = ['flipkart', 'amazon', 'meesho', 'myntra'] as const;
    if (!allowed.includes(marketplace as (typeof allowed)[number])) {
      throw new BadRequestException(
        'marketplace must be flipkart, amazon, meesho, or myntra',
      );
    }
    return this.reportImportService.getMonthUploadStatus({
      sellerId: sellerId.trim(),
      gstId: gstId.trim(),
      marketplaceId: marketplaceId.trim(),
      marketplace: marketplace as (typeof allowed)[number],
      reportMonth,
    });
  }

  @Get('uploads')
  @ApiOperation({ summary: 'List all report uploads' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  uploads(@Query('sellerId') sellerId?: string) {
    return this.reportImportService.listUploads(sellerId);
  }

  @Get('uploads/:uploadId/status')
  @ApiOperation({
    summary: 'Get import upload status',
    description:
      'Poll after Myntra/Meesho/Amazon upload while status is processing.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  uploadStatus(
    @Param('uploadId') uploadId: string,
    @Query('sellerId') sellerId: string,
  ) {
    if (!sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.uploadService.getUploadStatus(uploadId, sellerId.trim());
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List import jobs for a seller' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  async listImportJobs(
    @Query('sellerId') sellerId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    if (!sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    const jobs =
      activeOnly === 'true'
        ? await this.importJobService.listActiveJobs(sellerId.trim())
        : await this.importJobService.listJobs(sellerId.trim());
    return { success: true, data: jobs };
  }

  @Get('jobs/history')
  @ApiOperation({ summary: 'Import job history with timings and status' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  async getImportJobHistory(
    @Query('sellerId') sellerId: string,
    @Query('limit') limit?: string,
  ) {
    if (!sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    const parsedLimit = limit ? Math.min(Number(limit) || 100, 200) : 100;
    const data = await this.importJobService.listImportHistory(
      sellerId.trim(),
      parsedLimit,
    );
    return { success: true, data };
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Get import job status' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  async getImportJob(
    @Param('jobId') jobId: string,
    @Query('sellerId') sellerId: string,
  ) {
    if (!sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    const job = await this.importJobService.getJob(jobId, sellerId.trim());
    return { success: true, data: job };
  }

  @Get('workflow/required-reports')
  @ApiOperation({ summary: 'Required reports for a marketplace' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  workflowRequiredReports(@Query('marketplace') marketplace: string) {
    return this.importWorkflowService.getRequiredReports(marketplace);
  }

  @Post('workflow/status')
  @ApiOperation({ summary: 'Month-wise import workflow status' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  workflowStatus(@Body() body: WorkflowStatusDto) {
    return this.importWorkflowService.getWorkflowStatus(body);
  }

  @Get('workflow/history')
  @ApiOperation({ summary: 'Per-report import history' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  workflowHistory(
    @Query('sellerId') sellerId: string,
    @Query('gstId') gstId?: string,
    @Query('reportMonth') reportMonth?: string,
    @Query('marketplaceId') marketplaceId?: string,
  ) {
    if (!sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.importWorkflowService.getImportHistory({
      sellerId,
      gstId: gstId?.trim() || undefined,
      reportMonth,
      marketplaceId,
    });
  }

  @Get('workflow/upload-overview')
  @ApiOperation({
    summary: 'Seller-wide upload status by GST, month, and marketplace',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  workflowUploadOverview(@Query('sellerId') sellerId: string) {
    if (!sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.importWorkflowService.getSellerUploadOverview(sellerId.trim());
  }

  @Get('workflow/month-summary')
  @ApiOperation({ summary: 'Combined month import summary with amounts' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  workflowMonthSummary(
    @Query('sellerId') sellerId: string,
    @Query('gstId') gstId: string,
    @Query('marketplaceId') marketplaceId: string,
    @Query('marketplace') marketplace: string,
    @Query('reportMonth') reportMonth: string,
  ) {
    if (
      !sellerId?.trim() ||
      !gstId?.trim() ||
      !marketplaceId?.trim() ||
      !reportMonth?.trim()
    ) {
      throw new BadRequestException(
        'sellerId, gstId, marketplaceId, and reportMonth are required',
      );
    }
    const mp =
      marketplace &&
      ['flipkart', 'amazon', 'meesho', 'myntra'].includes(marketplace)
        ? (marketplace as 'flipkart' | 'amazon' | 'meesho' | 'myntra')
        : undefined;
    if (!mp) {
      throw new BadRequestException(
        'marketplace must be flipkart, amazon, meesho, or myntra',
      );
    }
    return this.importWorkflowService.getWorkflowMonthSummary({
      sellerId: sellerId.trim(),
      gstId: gstId.trim(),
      marketplaceId: marketplaceId.trim(),
      marketplace: mp,
      reportMonth: reportMonth.trim(),
    });
  }

  @Get('workflow/report-summary')
  @ApiOperation({ summary: 'Uploaded report summary with row counts' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  workflowReportSummary(
    @Query('sellerId') sellerId: string,
    @Query('uploadId') uploadId: string,
    @Query('slot') slot?: string,
    @Query('marketplace') marketplace?: string,
  ) {
    if (!sellerId?.trim() || !uploadId?.trim()) {
      throw new BadRequestException('sellerId and uploadId are required');
    }
    const mp =
      marketplace &&
      ['flipkart', 'amazon', 'meesho', 'myntra'].includes(marketplace)
        ? (marketplace as 'flipkart' | 'amazon' | 'meesho' | 'myntra')
        : undefined;
    return this.importWorkflowService.getReportUploadSummary({
      sellerId: sellerId.trim(),
      uploadId: uploadId.trim(),
      slot,
      marketplace: mp,
    });
  }

  @Get('reconciliation/notifications')
  @ApiOperation({ summary: 'Historical reconciliation adjustments alerts' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  reconciliationNotifications(
    @Query('sellerId') sellerId: string,
    @Query('gstId') gstId: string,
    @Query('marketplace') marketplace: string,
    @Query('reportMonth') reportMonth?: string,
  ) {
    if (!sellerId?.trim() || !gstId?.trim() || !marketplace?.trim()) {
      throw new BadRequestException(
        'sellerId, gstId, and marketplace are required',
      );
    }
    return this.reconciliationService.getAdjustmentNotifications({
      sellerId: sellerId.trim(),
      gstId: gstId.trim(),
      marketplace: marketplace.trim(),
      reportMonth: reportMonth?.trim(),
    });
  }

  @Get('reconciliation/lifecycle')
  @ApiOperation({ summary: 'Get lifecycle timeline for one order' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  reconciliationLifecycle(
    @Query('sellerId') sellerId: string,
    @Query('marketplace') marketplace: string,
    @Query('orderId') orderId?: string,
    @Query('canonicalKey') canonicalKey?: string,
  ) {
    if (!sellerId?.trim() || !marketplace?.trim()) {
      throw new BadRequestException('sellerId and marketplace are required');
    }
    return this.reconciliationService.getTransactionLifecycle({
      sellerId: sellerId.trim(),
      marketplace: marketplace.trim(),
      orderId,
      canonicalKey,
    });
  }

  @Get('reconciliation/month-view')
  @ApiOperation({ summary: 'Dual-mode month summary: accounting or lifecycle' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  reconciliationMonthView(
    @Query('sellerId') sellerId: string,
    @Query('gstId') gstId: string,
    @Query('marketplace') marketplace: string,
    @Query('reportMonth') reportMonth: string,
    @Query('mode') mode?: string,
  ) {
    if (
      !sellerId?.trim() ||
      !gstId?.trim() ||
      !marketplace?.trim() ||
      !reportMonth?.trim()
    ) {
      throw new BadRequestException(
        'sellerId, gstId, marketplace, and reportMonth are required',
      );
    }
    const normalizedMode = mode === 'lifecycle' ? 'lifecycle' : 'accounting';
    return this.reconciliationService.getDualModeSummary({
      sellerId: sellerId.trim(),
      gstId: gstId.trim(),
      marketplace: marketplace.trim(),
      reportMonth: reportMonth.trim(),
      mode: normalizedMode,
    });
  }

  @Delete('workflow/slot')
  @ApiOperation({
    summary: 'Delete report-specific imported data before re-upload',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  deleteWorkflowSlot(@Body() body: DeleteSlotDto) {
    return this.importWorkflowService.deleteSlotData(body);
  }

  @Get('export/state-wise/preview')
  @ApiOperation({
    summary: 'Preview state-wise GST Excel export',
    description:
      'Returns sheet and row counts per marketplace for the state-wise GST report.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  previewStateWiseExport(@Query() query: StateWiseExportDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    if (!query.gstin?.trim()) {
      throw new BadRequestException('gstin is required');
    }
    return this.stateWiseReportService.getPreview(query);
  }

  @Get('export/state-wise')
  @ApiOperation({
    summary: 'Download state-wise GST Excel report',
    description:
      'Multi-sheet Excel grouped by state and GST rate — one sheet per marketplace.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Roles('seller', 'super_admin', 'accounts_manager')
  async downloadStateWiseExport(@Query() query: StateWiseExportDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    if (!query.gstin?.trim()) {
      throw new BadRequestException('gstin is required');
    }
    const result =
      query.format === 'csv'
        ? await this.stateWiseReportService.generateCsv(query)
        : await this.stateWiseReportService.generateWorkbook(query);
    return new StreamableFile(result.buffer, {
      type:
        query.format === 'csv'
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  @Get('export/state-sku-wise/preview')
  @ApiOperation({
    summary: 'Preview state + SKU + master SKU export',
    description:
      'Returns sheet and row counts per marketplace for the state/sku/master-sku report.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  previewStateSkuWiseExport(@Query() query: StateWiseExportDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    if (!query.gstin?.trim()) {
      throw new BadRequestException('gstin is required');
    }
    return this.stateSkuWiseReportService.getPreview(query);
  }

  @Get('analytics/sku-wise')
  @ApiOperation({
    summary: 'SKU-wise analytics by master SKU',
    description:
      'Aggregates imported sales metrics against master SKUs and marketplace SKU mappings. Omit gstin to include all GSTINs.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  getSkuWiseAnalytics(@Query() query: StateWiseExportDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.stateSkuWiseReportService.getSkuWiseAnalytics(query);
  }

  @Get('analytics/geography')
  @ApiOperation({
    summary: 'India state-wise sales map overview',
    description:
      'Aggregated seller sales by Indian state using invoice/sales date. Tenant-scoped to the authenticated seller.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  getGeographyAnalytics(
    @Query() query: GeographyAnalyticsDto,
    @Req() req: RequestWithUser,
  ) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.geographyAnalyticsService.getOverview(query, {
      id: req.user?.id,
      role: req.user?.role,
    });
  }

  @Get('analytics/geography/export')
  @ApiOperation({ summary: 'Export state-wise geographical sales' })
  @ApiProduces(
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Roles('seller', 'super_admin', 'accounts_manager')
  async exportGeographyAnalytics(
    @Query() query: GeographyAnalyticsDto,
    @Req() req: RequestWithUser,
  ) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    const actor = { id: req.user?.id, role: req.user?.role };
    const result =
      query.format === 'xlsx'
        ? await this.geographyAnalyticsService.exportXlsx(query, actor)
        : await this.geographyAnalyticsService.exportCsv(query, actor);
    return new StreamableFile(result.buffer, {
      type:
        query.format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  @Get('analytics/geography/states/:stateCode')
  @ApiOperation({ summary: 'State-level geographical analytics detail' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  getGeographyStateDetail(
    @Param('stateCode') stateCode: string,
    @Query() query: GeographyAnalyticsDto,
    @Req() req: RequestWithUser,
  ) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    return this.geographyAnalyticsService.getStateDetail(stateCode, query, {
      id: req.user?.id,
      role: req.user?.role,
    });
  }

  @Get('export/state-sku-wise')
  @ApiOperation({
    summary: 'Download state + SKU + master SKU report',
    description:
      'Multi-sheet export grouped by state, SKU, and master SKU with summary at bottom.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Roles('seller', 'super_admin', 'accounts_manager')
  async downloadStateSkuWiseExport(@Query() query: StateWiseExportDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    if (!query.gstin?.trim()) {
      throw new BadRequestException('gstin is required');
    }
    const result =
      query.format === 'csv'
        ? await this.stateSkuWiseReportService.generateCsv(query)
        : await this.stateSkuWiseReportService.generateWorkbook(query);
    return new StreamableFile(result.buffer, {
      type:
        query.format === 'csv'
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  @Get('export/gstr1-b2cs/preview')
  @ApiOperation({
    summary: 'Preview GSTR1 B2CS template export',
    description: 'Returns row count that will be written into B2CS sheet.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  previewGstr1B2csExport(@Query() query: Gstr1B2csExportDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    if (!query.gstin?.trim()) {
      throw new BadRequestException('gstin is required');
    }
    if (!query.reportMonth?.trim()) {
      throw new BadRequestException('reportMonth is required');
    }
    return this.gstr1B2csReportService.getPreview(query);
  }

  @Get('export/gstr1-b2cs')
  @ApiOperation({
    summary: 'Download GSTR1 B2CS template report',
    description:
      'Downloads filled GSTR1_Excel_Workbook_Template_V2.2.xlsx with B2CS data.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Roles('seller', 'super_admin', 'accounts_manager')
  async downloadGstr1B2csExport(@Query() query: Gstr1B2csExportDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
    if (!query.gstin?.trim()) {
      throw new BadRequestException('gstin is required');
    }
    if (!query.reportMonth?.trim()) {
      throw new BadRequestException('reportMonth is required');
    }
    const result = await this.gstr1B2csReportService.generateWorkbook(query);
    return new StreamableFile(result.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  @Get('errors-csv')
  @ApiOperation({
    summary: 'Download errors CSV',
    description: 'Returns CSV file of import errors for a given uploadId.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  @Header('Content-Type', 'text/csv')
  async errorsCsv(@Query('uploadId') uploadId: string) {
    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }
    return this.reportImportService.getUploadErrorsCsv(uploadId);
  }
}
