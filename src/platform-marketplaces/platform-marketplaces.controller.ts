import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformMarketplacesService } from './platform-marketplaces.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@Controller('platform-marketplaces')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PlatformMarketplacesController {
  constructor(
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
  list() {
    return this.platformMarketplacesService.list();
  }

  @Get('all')
  @Roles(
    'super_admin',
    'sales_manager',
    'accounts_manager',
    'training_and_support_manager',
    'seller',
  )
  listAll() {
    return this.platformMarketplacesService.listAll();
  }

  @Get(':id')
  @Roles('super_admin', 'sales_manager', 'accounts_manager')
  getById(@Param('id') id: string) {
    return this.platformMarketplacesService.getById(id);
  }

  @Post()
  @Roles('super_admin')
  create(
    @Body()
    payload: {
      name: string;
      slug?: string;
      logoUrl?: string;
      description?: string;
      status?: 'active' | 'inactive';
    },
  ) {
    return this.platformMarketplacesService.create(payload);
  }

  @Patch(':id')
  @Roles('super_admin')
  update(
    @Param('id') id: string,
    @Body()
    payload: Partial<{
      name: string;
      slug: string;
      logoUrl: string;
      description: string;
      status: 'active' | 'inactive';
    }>,
  ) {
    return this.platformMarketplacesService.update(id, payload);
  }

  @Delete(':id')
  @Roles('super_admin')
  remove(@Param('id') id: string) {
    return this.platformMarketplacesService.remove(id);
  }

  @Post(':id/delete')
  @Roles('super_admin')
  removeViaPost(@Param('id') id: string) {
    return this.platformMarketplacesService.remove(id);
  }
}
