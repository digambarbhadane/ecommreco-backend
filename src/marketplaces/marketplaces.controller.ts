import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateMarketplaceDto } from './dto/create-marketplace.dto';
import { MarketplacesService } from './marketplaces.service';
import { PlatformMarketplacesService } from '../platform-marketplaces/platform-marketplaces.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@Controller('marketplaces')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class MarketplacesController {
  constructor(
    private readonly marketplacesService: MarketplacesService,
    private readonly platformMarketplacesService: PlatformMarketplacesService,
  ) {}

  @Get()
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

  @Post()
  @Roles('super_admin', 'accounts_manager', 'seller')
  create(@Body() dto: CreateMarketplaceDto) {
    return this.marketplacesService.create(dto);
  }

  @Delete(':id')
  @Roles('super_admin', 'accounts_manager', 'seller')
  remove(@Param('id') id: string) {
    return this.marketplacesService.remove(id);
  }
}
