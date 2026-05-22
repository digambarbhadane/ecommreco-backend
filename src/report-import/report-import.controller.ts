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
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListImportedRowsDto } from './dto/list-imported-rows.dto';
import { UploadReportDto } from './dto/upload-report.dto';
import { ReportImportService } from './report-import.service';
import { UploadService } from './services/upload.service';

@ApiTags('Report-Import')
@ApiBearerAuth()
@Controller('report-imports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ReportImportController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly reportImportService: ReportImportService,
  ) {}

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
    summary: 'Upload marketplace report',
    description: 'Upload Excel/CSV reports for Flipkart, Amazon, or Meesho. Supports multiple file fields (file, mtrB2bFile, mtrB2cFile, tcsSalesFile, tcsSalesReturnFile, orderReportFile, returnReportFile). At least one file is required.',
  })
  @Roles('seller', 'super_admin', 'accounts_manager')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'mtrB2bFile', maxCount: 1 },
        { name: 'mtrB2cFile', maxCount: 1 },
        { name: 'tcsSalesFile', maxCount: 1 },
        { name: 'tcsSalesReturnFile', maxCount: 1 },
        { name: 'orderReportFile', maxCount: 1 },
        { name: 'returnReportFile', maxCount: 1 },
      ],
      {
        limits: { fileSize: 50 * 1024 * 1024 },
      },
    ),
  )
  uploadFlipkart(
    @UploadedFiles()
    files: {
      file?: Array<{ buffer: Buffer; originalname: string }>;
      mtrB2bFile?: Array<{ buffer: Buffer; originalname: string }>;
      mtrB2cFile?: Array<{ buffer: Buffer; originalname: string }>;
      tcsSalesFile?: Array<{ buffer: Buffer; originalname: string }>;
      tcsSalesReturnFile?: Array<{ buffer: Buffer; originalname: string }>;
      orderReportFile?: Array<{ buffer: Buffer; originalname: string }>;
      returnReportFile?: Array<{ buffer: Buffer; originalname: string }>;
    },
    @Body() dto: UploadReportDto,
  ) {
    const singleFile = files?.file?.[0];
    const mtrB2bFile = files?.mtrB2bFile?.[0];
    const mtrB2cFile = files?.mtrB2cFile?.[0];
    const tcsSalesFile = files?.tcsSalesFile?.[0];
    const tcsSalesReturnFile = files?.tcsSalesReturnFile?.[0];
    const orderReportFile = files?.orderReportFile?.[0];
    const returnReportFile = files?.returnReportFile?.[0];
    if (
      !singleFile &&
      !mtrB2bFile &&
      !mtrB2cFile &&
      !tcsSalesFile &&
      !tcsSalesReturnFile &&
      !orderReportFile &&
      !returnReportFile
    ) {
      throw new BadRequestException('At least one file is required');
    }
    return this.uploadService.uploadFlipkart(
      {
        file: singleFile,
        mtrB2bFile,
        mtrB2cFile,
        tcsSalesFile,
        tcsSalesReturnFile,
        orderReportFile,
        returnReportFile,
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
