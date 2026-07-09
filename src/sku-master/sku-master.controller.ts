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
import { BulkUpdateSkuMasterItemDto } from './dto/bulk-update-sku-master.dto';
import { SkuMasterService } from './sku-master.service';
import { SkuMasterExcelService } from './sku-master-excel.service';

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
  constructor(
    private readonly skuMasterService: SkuMasterService,
    private readonly skuMasterExcelService: SkuMasterExcelService,
  ) {}

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
    if (!gstId?.trim()) {
      throw new BadRequestException('gstId is required');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('Excel file is required');
    }
    return this.skuMasterExcelService.importWorkbook(
      file.buffer,
      gstId.trim(),
      req?.user ?? {},
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List marketplace SKUs from uploaded reports',
    description:
      'Returns unique SKUs from import rows for the selected GST, merged with saved master SKU mappings.',
  })
  list(@Query() query: ListSkuMasterQueryDto, @Req() req: RequestWithUser) {
    return this.skuMasterService.list(query, req.user ?? {});
  }

  @Put('mapping')
  @ApiOperation({ summary: 'Save master SKU for a marketplace SKU' })
  upsertMapping(
    @Body() dto: UpsertSkuMasterDto,
    @Req() req: RequestWithUser,
  ) {
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
