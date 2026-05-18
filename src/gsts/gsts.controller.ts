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
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateGstDto } from './dto/create-gst.dto';
import { GstsService } from './gsts.service';

@ApiTags('GST')
@ApiBearerAuth()
@Controller('gsts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GstsController {
  constructor(private readonly gstsService: GstsService) {}

  @Post()
  @ApiOperation({ summary: 'Create GST entry', description: 'Add a single GST entry for a seller.' })
  @Roles('seller', 'super_admin')
  create(@Body() dto: CreateGstDto) {
    return this.gstsService.create(dto);
  }

  @Post('import')
  @ApiOperation({ summary: 'Import GST entries in bulk' })
  @Roles('seller', 'super_admin')
  importRows(
    @Body()
    body: {
      sellerId: string;
      rows: {
        gstNumber: string;
        state?: string;
        status?: 'active' | 'inactive';
        businessName?: string;
      }[];
    },
  ) {
    return this.gstsService.importRows(body);
  }

  @Get()
  @ApiOperation({ summary: 'List GST entries', description: 'Returns paginated list of GST entries for a seller.' })
  @Roles('seller', 'super_admin')
  list(
    @Query('sellerId') sellerId?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.gstsService.list({
      sellerId,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update GST entry' })
  @Roles('seller', 'super_admin')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      businessName?: string;
      state?: string;
      status?: 'active' | 'inactive';
    },
  ) {
    return this.gstsService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete GST entry' })
  @Roles('seller', 'super_admin')
  remove(@Param('id') id: string) {
    return this.gstsService.remove(id);
  }
}
