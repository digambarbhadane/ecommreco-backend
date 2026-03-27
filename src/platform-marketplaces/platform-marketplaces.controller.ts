import {
  Body,
  Controller,
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
import { CreatePlatformMarketplaceDto } from './dto/create-platform-marketplace.dto';
import { UpdatePlatformMarketplaceDto } from './dto/update-platform-marketplace.dto';

@Controller('platform-marketplaces')
export class PlatformMarketplacesController {
  constructor(
    private readonly platformMarketplacesService: PlatformMarketplacesService,
  ) {}

  @Get()
  list() {
    return this.platformMarketplacesService.list();
  }

  @Get('all')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  listAll() {
    return this.platformMarketplacesService.listAll();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.platformMarketplacesService.getById(id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  create(@Body() dto: CreatePlatformMarketplaceDto) {
    return this.platformMarketplacesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  update(@Param('id') id: string, @Body() dto: UpdatePlatformMarketplaceDto) {
    return this.platformMarketplacesService.update(id, dto);
  }

  @Post(':id/delete')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  remove(@Param('id') id: string) {
    return this.platformMarketplacesService.remove(id);
  }
}
