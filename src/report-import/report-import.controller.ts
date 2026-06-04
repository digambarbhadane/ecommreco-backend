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
  Get,
  Header,
  Param,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListImportedRowsDto } from './dto/list-imported-rows.dto';
import { UploadReportDto } from './dto/upload-report.dto';
import { ReportImportService } from './report-import.service';
import { UploadService } from './services/upload.service';
import { ImportSessionService } from './services/import-session.service';
import {
  MarketplaceUploadKey,
  ReportUploadMultipart,
} from './marketplace-upload.routes';
import type { UploadedReportFiles } from './marketplace-upload.routes';

@ApiTags('Report-Import')
@ApiBearerAuth()
@Controller('report-imports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ReportImportController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly reportImportService: ReportImportService,
    private readonly importSessionService: ImportSessionService,
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
    const key = (marketplace ?? '').trim().toLowerCase() as MarketplaceUploadKey;
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
      limits: { fileSize: 100 * 1024 * 1024 },
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
    return this.importSessionService.addFile(sessionId, sellerId.trim(), slot.trim(), {
      buffer: file.buffer,
      originalname: file.originalname,
    });
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
  @ApiOperation({ summary: 'Get import config', description: 'Returns required sheets and columns for a marketplace import.' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  getConfig(@Query('marketplace') marketplace?: string) {
    const name = (marketplace ?? '').trim().toLowerCase();
    if (name && name.includes('amazon')) {
      return {
        success: true,
        data: {
          marketplace: 'amazon',
          requiredSheets: ['MTR B2B Report (single sheet)', 'MTR B2C Report (single sheet)'],
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
            'MDirect Orders Report (optional)': ['order_release_id', 'seller_sku_code'],
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
            'Return Report',
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
            'Order Report': ['Sub Order No', 'sub_order_num', 'SKU', 'Reason for Credit Entry'],
            'TCS Sales Return Report': ['Sub Order No', 'sub_order_num', 'cancel_return_date'],
            'Return Report': [
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
    summary: 'Upload Flipkart Sales Report',
    description:
      'Upload Flipkart workbook (Sales Report + Cash Back Report sheets) via the `file` field.',
  })
  @ReportUploadMultipart()
  uploadFlipkart(
    @UploadedFiles() files: UploadedReportFiles,
    @Body() dto: UploadReportDto,
  ) {
    return this.dispatchMarketplaceUpload('flipkart', files, dto);
  }

  @Post('amazon/upload')
  @ApiOperation({
    summary: 'Upload Amazon MTR reports',
    description:
      'Upload Amazon MTR B2C (required) and optional B2B via `mtrB2cFile` / `mtrB2bFile`.',
  })
  @ReportUploadMultipart()
  uploadAmazon(
    @UploadedFiles() files: UploadedReportFiles,
    @Body() dto: UploadReportDto,
  ) {
    return this.dispatchMarketplaceUpload('amazon', files, dto);
  }

  @Post('meesho/upload')
  @ApiOperation({
    summary: 'Upload Meesho reports',
    description:
      'Upload all four Meesho files: tcsSalesFile, tcsSalesReturnFile, orderReportFile, returnReportFile.',
  })
  @ReportUploadMultipart()
  uploadMeesho(
    @UploadedFiles() files: UploadedReportFiles,
    @Body() dto: UploadReportDto,
  ) {
    return this.dispatchMarketplaceUpload('meesho', files, dto);
  }

  @Post('myntra/upload')
  @ApiOperation({
    summary: 'Upload Myntra reports',
    description:
      'Upload Myntra reports: gstrReportPackedFile, salesRevenuePackedB2cFile, gstrReportRtoFile, gstrReportRtFile (required). mDirectOrdersReportFile and mDirectReturnsReportFile are optional.',
  })
  @ReportUploadMultipart()
  uploadMyntra(
    @UploadedFiles() files: UploadedReportFiles,
    @Body() dto: UploadReportDto,
  ) {
    return this.dispatchMarketplaceUpload('myntra', files, dto);
  }

  private dispatchMarketplaceUpload(
    marketplace: MarketplaceUploadKey,
    files: UploadedReportFiles,
    dto: UploadReportDto,
  ) {
    const singleFile = files?.file?.[0];
    const mtrB2bFile = files?.mtrB2bFile?.[0];
    const mtrB2cFile = files?.mtrB2cFile?.[0];
    const tcsSalesFile = files?.tcsSalesFile?.[0];
    const tcsSalesReturnFile = files?.tcsSalesReturnFile?.[0];
    const orderReportFile = files?.orderReportFile?.[0];
    const returnReportFile = files?.returnReportFile?.[0];
    const gstrReportPackedFile = files?.gstrReportPackedFile?.[0];
    const mDirectOrdersReportFile = files?.mDirectOrdersReportFile?.[0];
    const salesRevenuePackedB2cFile = files?.salesRevenuePackedB2cFile?.[0];
    const gstrReportRtoFile = files?.gstrReportRtoFile?.[0];
    const gstrReportRtFile = files?.gstrReportRtFile?.[0];
    const mDirectReturnsReportFile = files?.mDirectReturnsReportFile?.[0];
    if (
      !singleFile &&
      !mtrB2bFile &&
      !mtrB2cFile &&
      !tcsSalesFile &&
      !tcsSalesReturnFile &&
      !orderReportFile &&
      !returnReportFile &&
      !gstrReportPackedFile &&
      !mDirectOrdersReportFile &&
      !salesRevenuePackedB2cFile &&
      !gstrReportRtoFile &&
      !gstrReportRtFile &&
      !mDirectReturnsReportFile
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
        returnReportFile,
        gstrReportPackedFile,
        mDirectOrdersReportFile,
        salesRevenuePackedB2cFile,
        gstrReportRtoFile,
        gstrReportRtFile,
        mDirectReturnsReportFile,
      },
      dto,
    );
  }

  @Get('rows')
  @ApiOperation({ summary: 'List imported rows', description: 'Returns paginated list of imported report rows.' })
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
  @ApiOperation({ summary: 'Get import summary', description: 'Returns document type summary for imported reports.' })
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

  @Get('uploads')
  @ApiOperation({ summary: 'List all report uploads' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  uploads(@Query('sellerId') sellerId?: string) {
    return this.reportImportService.listUploads(sellerId);
  }

  @Get('uploads/:uploadId/status')
  @ApiOperation({
    summary: 'Get import upload status',
    description: 'Poll after Myntra/Meesho/Amazon upload while status is processing.',
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

  @Get('errors-csv')
  @ApiOperation({ summary: 'Download errors CSV', description: 'Returns CSV file of import errors for a given uploadId.' })
  @Roles('seller', 'super_admin', 'accounts_manager')
  @Header('Content-Type', 'text/csv')
  async errorsCsv(@Query('uploadId') uploadId: string) {
    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }
    return this.reportImportService.getUploadErrorsCsv(uploadId);
  }
}
