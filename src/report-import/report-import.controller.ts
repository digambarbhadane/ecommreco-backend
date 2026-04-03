import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  UploadedFile,
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

@Controller('report-imports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ReportImportController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly reportImportService: ReportImportService,
  ) {}

  @Get('config')
  @Roles('seller', 'super_admin', 'accounts_manager')
  getConfig(@Query('marketplace') marketplace?: string) {
    const name = (marketplace ?? '').trim().toLowerCase();
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
  @Roles('seller', 'super_admin', 'accounts_manager')
  @UseInterceptors(FileInterceptor('file'))
  uploadFlipkart(
    @UploadedFile() file: { buffer: Buffer; originalname: string },
    @Body() dto: UploadReportDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.uploadService.uploadFlipkart(file, dto);
  }

  @Get('rows')
  @Roles('seller', 'super_admin', 'accounts_manager')
  listRows(@Query() query: ListImportedRowsDto) {
    return this.reportImportService.listImportedRows(query);
  }

  @Get('summary')
  @Roles('seller', 'super_admin', 'accounts_manager')
  summary(@Query() query: ListImportedRowsDto) {
    return this.reportImportService.getDocumentTypeSummary(query);
  }

  @Get('uploads')
  @Roles('seller', 'super_admin', 'accounts_manager')
  uploads(@Query('sellerId') sellerId?: string) {
    return this.reportImportService.listUploads(sellerId);
  }

  @Get('errors-csv')
  @Roles('seller', 'super_admin', 'accounts_manager')
  @Header('Content-Type', 'text/csv')
  async errorsCsv(@Query('uploadId') uploadId: string) {
    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }
    return this.reportImportService.getUploadErrorsCsv(uploadId);
  }
}
