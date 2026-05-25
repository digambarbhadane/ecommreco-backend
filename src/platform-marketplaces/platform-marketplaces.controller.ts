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
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformMarketplacesService } from './platform-marketplaces.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@ApiTags('Platform-Marketplaces')
@ApiBearerAuth()
@Controller('platform-marketplaces')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PlatformMarketplacesController {
  constructor(
    private readonly platformMarketplacesService: PlatformMarketplacesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List platform marketplaces', description: 'Returns platform marketplace configurations.' })
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
  @ApiOperation({ summary: 'List all platform marketplaces', description: 'Returns all marketplace configs regardless of status.' })
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
  @ApiOperation({ summary: 'Get platform marketplace by ID' })
  @Roles('super_admin', 'sales_manager', 'accounts_manager')
  getById(@Param('id') id: string) {
    return this.platformMarketplacesService.getById(id);
  }

  @Post()
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
  @Roles('super_admin')
  remove(@Param('id') id: string) {
    return this.platformMarketplacesService.remove(id);
  }

  @Post(':id/delete')
  @ApiOperation({ summary: 'Delete platform marketplace (via POST)', description: 'Alternative POST method for deleting marketplace. Super admin only.' })
  @Roles('super_admin')
  removeViaPost(@Param('id') id: string) {
    return this.platformMarketplacesService.remove(id);
  }
}
