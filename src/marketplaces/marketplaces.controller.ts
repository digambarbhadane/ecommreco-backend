import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { CreateMarketplaceDto } from './dto/create-marketplace.dto';
import { DeleteMarketplaceDto } from './dto/delete-marketplace.dto';
import { MarketplacesService } from './marketplaces.service';
import { PlatformMarketplacesService } from '../platform-marketplaces/platform-marketplaces.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

type RequestWithUser = Request & {
  user?: { id?: string; role?: string };
};

@ApiTags('Marketplaces')
@ApiBearerAuth()
@Controller('marketplaces')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class MarketplacesController {
  constructor(
    private readonly marketplacesService: MarketplacesService,
    private readonly platformMarketplacesService: PlatformMarketplacesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List marketplaces', description: 'List platform or seller-specific marketplaces.' })
  @Roles(
    'super_admin',
    'sales_manager',
    'accounts_manager',
    'training_and_support_manager',
    'seller',
  )
  list(
    @Query('sellerId') sellerId?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    if (!sellerId) {
      return this.platformMarketplacesService.list();
    }
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.marketplacesService.listSeller({
      sellerId,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get seller marketplace link by ID' })
  @Roles('super_admin', 'accounts_manager', 'seller')
  getById(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.marketplacesService.getById(id, {
      requesterId: req.user?.id,
      requesterRole: req.user?.role,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create marketplace integration' })
  @Roles('super_admin', 'accounts_manager', 'seller')
  create(@Body() dto: CreateMarketplaceDto) {
    return this.marketplacesService.create(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove marketplace integration' })
  @Roles('super_admin', 'accounts_manager', 'seller')
  remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.marketplacesService.remove(id, {
      requesterId: req.user?.id,
      requesterRole: req.user?.role,
      ipAddress: req.ip,
      userAgent: Array.isArray(req.headers?.['user-agent'])
        ? req.headers?.['user-agent']?.[0]
        : req.headers?.['user-agent'],
    });
  }

  @Delete(':id/permanent')
  @ApiOperation({ summary: 'Permanently disconnect marketplace with cascade delete' })
  @Roles('super_admin', 'accounts_manager', 'seller')
  removePermanently(
    @Param('id') id: string,
    @Body() body: DeleteMarketplaceDto,
    @Req() req: RequestWithUser,
  ) {
    return this.marketplacesService.remove(id, {
      requesterId: req.user?.id,
      requesterRole: req.user?.role,
      permanentDelete: true,
      confirmedGstNumber: body?.gstNumber,
      confirmationText: body?.confirmation,
      ipAddress: req.ip,
      userAgent: Array.isArray(req.headers?.['user-agent'])
        ? req.headers?.['user-agent']?.[0]
        : req.headers?.['user-agent'],
    });
  }
}
