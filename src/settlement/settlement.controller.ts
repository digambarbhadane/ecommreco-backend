import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListSettlementsDto } from './dto/list-settlements.dto';
import { SettlementService } from './settlement.service';

type RequestWithUser = Request & {
  user?: { id?: string; role?: string };
};

@ApiTags('Settlement')
@ApiBearerAuth()
@Controller('settlements')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('seller', 'super_admin', 'accounts_manager')
export class SettlementController {
  constructor(private readonly service: SettlementService) {}

  private assertSeller(query: ListSettlementsDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
  }

  private scopedQuery(
    query: ListSettlementsDto,
    request: RequestWithUser,
  ): ListSettlementsDto {
    const scoped = Object.assign(new ListSettlementsDto(), query);
    if (request.user?.role === 'seller' && request.user.id) {
      scoped.sellerId = request.user.id;
    }
    this.assertSeller(scoped);
    return scoped;
  }

  @Get()
  @ApiOperation({ summary: 'List dynamically calculated order settlements' })
  list(@Query() query: ListSettlementsDto, @Req() request: RequestWithUser) {
    return this.service.list(this.scopedQuery(query, request));
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get settlement dashboard summary' })
  summary(@Query() query: ListSettlementsDto, @Req() request: RequestWithUser) {
    return this.service.summary(this.scopedQuery(query, request));
  }

  @Get('export')
  @ApiOperation({ summary: 'Export settlements to Excel' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async export(
    @Query() query: ListSettlementsDto,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const scoped = this.scopedQuery(query, request);
    const filename = `settlements-${new Date().toISOString().slice(0, 10)}.xlsx`;
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    return new StreamableFile(await this.service.createExport(scoped));
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Get complete settlement calculation details' })
  detail(
    @Param('orderId') orderId: string,
    @Query() query: ListSettlementsDto,
    @Req() request: RequestWithUser,
  ) {
    return this.service.detail(this.scopedQuery(query, request), orderId);
  }
}
