import { Controller, Get, UseGuards } from '@nestjs/common';
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
    return this.platformMarketplacesService.list();
  }
}
