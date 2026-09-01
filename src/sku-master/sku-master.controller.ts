import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MULTER_UPLOAD_LIMITS } from '../config/upload-limits';
import { ListSkuMasterQueryDto } from './dto/list-sku-master.query.dto';
import { ExportSkuMasterQueryDto } from './dto/export-sku-master.query.dto';
import { UpsertSkuMasterDto } from './dto/upsert-sku-master.dto';
import {
  BulkUpdateSkuMasterDto,
  BulkUpdateSkuMasterItemDto,
} from './dto/bulk-update-sku-master.dto';
import { SkuMasterService } from './sku-master.service';
import { SkuMasterExcelService } from './sku-master-excel.service';
import { SkuMasterSyncService } from './sku-master-sync.service';

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};

@ApiTags('SKU Master')
@ApiBearerAuth()
@Controller('sku-master')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('seller')
export class SkuMasterController {
  private readonly logger = new Logger(SkuMasterController.name);

  constructor(
    private readonly skuMasterService: SkuMasterService,
    private readonly skuMasterExcelService: SkuMasterExcelService,
    private readonly skuMasterSyncService: SkuMasterSyncService,
  ) {}

  @Post('sync')
  @ApiOperation({
    summary:
      'Ensure SKU Master rows exist for all marketplace SKUs in uploaded reports',
  })
  sync(@Query('gstId') gstId: string | undefined, @Req() req: RequestWithUser) {
    return this.skuMasterSyncService.syncForScope(
      gstId?.trim() || undefined,
      req.user ?? {},
    );
  }

  @Get('export')
  @ApiOperation({ summary: 'Download SKU master mappings as Excel' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportExcel(
    @Query() query: ExportSkuMasterQueryDto,
    @Req() req: RequestWithUser,
  ) {
    const result = await this.skuMasterExcelService.exportWorkbook(
      query,
      req.user ?? {},
    );
    return new StreamableFile(result.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }

  @Post('import/prepare')
  @ApiOperation({ summary: 'Parse SKU master Excel and return rows to update' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: MULTER_UPLOAD_LIMITS,
    }),
  )
  async prepareImport(
    @Query('gstId') gstId: string,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
    @Req() req?: RequestWithUser,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Excel file is required');
    }
    const prepared = await this.skuMasterExcelService.prepareImport(
      file.buffer,
      gstId?.trim() || undefined,
      req?.user ?? {},
    );
    return {
      success: true,
      totalRows: prepared.totalRows,
      updateCount: prepared.updateCount,
      skippedCount: prepared.skippedCount,
      failedCount: prepared.failedCount,
      errors: prepared.errors,
      updates: prepared.updates,
    };
  }

  @Post('import/commit')
  @ApiOperation({ summary: 'Save a batch of SKU master Excel rows' })
  commitImport(
    @Body() body: BulkUpdateSkuMasterDto,
    @Req() req: RequestWithUser,
  ) {
    return this.skuMasterExcelService.commitUpdates(body.items, req.user ?? {});
  }

  @Post('import')
  @ApiOperation({ summary: 'Upload updated SKU master Excel file' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: MULTER_UPLOAD_LIMITS,
    }),
  )
  importExcel(
    @Query('gstId') gstId: string,
    @UploadedFile() file?: { buffer: Buffer; originalname: string },
    @Req() req?: RequestWithUser,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Excel file is required');
    }
    return this.skuMasterExcelService.importWorkbook(
      file.buffer,
      gstId?.trim() || undefined,
      req?.user ?? {},
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List marketplace SKUs from uploaded reports',
    description:
      'Returns unique SKUs from import rows for the selected GST, merged with saved master SKU mappings.',
  })
  async list(
    @Query() query: ListSkuMasterQueryDto,
    @Req() req: RequestWithUser,
  ) {
    // Ensure Flipkart/Myntra/Meesho/etc. SKUs from imports exist in
    // sku_master_mapping before listing (throttled inside sync service).
    try {
      await this.skuMasterSyncService.syncForScope(
        query.gstId?.trim() || undefined,
        req.user ?? {},
      );
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message)
          : String(err);
      // Still return whatever mappings exist; do not fail the page.
      this.logger.warn(`sync before list failed: ${message}`);
    }
    return this.skuMasterService.list(query, req.user ?? {});
  }

  @Put('mapping')
  @ApiOperation({ summary: 'Save master SKU for a marketplace SKU' })
  upsertMapping(@Body() dto: UpsertSkuMasterDto, @Req() req: RequestWithUser) {
    return this.skuMasterService.upsertMapping(dto, req.user ?? {});
  }

  @Post('bulk-update')
  @ApiOperation({ summary: 'Bulk update SKU mappings' })
  bulkUpdate(
    @Body() body: BulkUpdateSkuMasterItemDto[],
    @Req() req: RequestWithUser,
  ) {
    return this.skuMasterService.bulkUpdate(body, req.user ?? {});
  }
}
