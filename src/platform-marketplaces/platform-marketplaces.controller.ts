import {
<<<<<<< HEAD
  Body,
  Controller,
=======
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
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

@ApiTags('Platform-Marketplaces')
@ApiBearerAuth()
@Controller('platform-marketplaces')
export class PlatformMarketplacesController {
  constructor(
    private readonly platformMarketplacesService: PlatformMarketplacesService,
  ) {}

  @Get()
<<<<<<< HEAD
=======
  @ApiOperation({ summary: 'List platform marketplaces', description: 'Returns platform marketplace configurations.' })
  @Roles(
    'super_admin',
    'sales_manager',
    'accounts_manager',
    'training_and_support_manager',
    'seller',
  )
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
  list() {
    return this.platformMarketplacesService.list();
  }

  @Get('all')
<<<<<<< HEAD
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
=======
  @ApiOperation({ summary: 'List all platform marketplaces', description: 'Returns all marketplace configs regardless of status.' })
  @Roles(
    'super_admin',
    'sales_manager',
    'accounts_manager',
    'training_and_support_manager',
    'seller',
  )
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
  listAll() {
    return this.platformMarketplacesService.listAll();
  }

  @Get(':id')
<<<<<<< HEAD
=======
  @ApiOperation({ summary: 'Get platform marketplace by ID' })
  @Roles('super_admin', 'sales_manager', 'accounts_manager')
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
  getById(@Param('id') id: string) {
    return this.platformMarketplacesService.getById(id);
  }

  @Post()
<<<<<<< HEAD
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
=======
  @ApiOperation({ summary: 'Create platform marketplace', description: 'Create a new platform marketplace configuration. Super admin only.' })
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
  @ApiOperation({ summary: 'Update platform marketplace' })
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
  @ApiOperation({ summary: 'Delete platform marketplace' })
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
  @Roles('super_admin')
  remove(@Param('id') id: string) {
    return this.platformMarketplacesService.remove(id);
  }
<<<<<<< HEAD
=======

  @Post(':id/delete')
  @ApiOperation({ summary: 'Delete platform marketplace (via POST)', description: 'Alternative POST method for deleting marketplace. Super admin only.' })
  @Roles('super_admin')
  removeViaPost(@Param('id') id: string) {
    return this.platformMarketplacesService.remove(id);
  }
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
}
