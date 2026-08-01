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
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateGstDto } from './dto/create-gst.dto';
import { DeleteGstDto } from './dto/delete-gst.dto';
import { VerifyGstDto } from './dto/verify-gst.dto';
import { GstsService } from './gsts.service';

type RequestWithUser = Request & {
  user?: { id?: string; role?: string; name?: string; email?: string };
};

@ApiTags('GST')
@ApiBearerAuth()
@Controller('gsts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GstsController {
  constructor(private readonly gstsService: GstsService) {}

  @Post('verify')
  @ApiOperation({
    summary: 'Verify GST number',
    description:
      'Verifies a GSTIN via Perione before it can be added to a seller profile.',
  })
  @Roles('seller', 'super_admin')
  verify(@Body() dto: VerifyGstDto, @Req() req: RequestWithUser) {
    const sellerId =
      req.user?.role === 'seller' && typeof req.user.id === 'string'
        ? req.user.id
        : undefined;
    return this.gstsService.verifyGst(dto, sellerId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create GST entry',
    description: 'Add a verified GST entry for a seller.',
  })
  @Roles('seller', 'super_admin')
  create(@Body() dto: CreateGstDto, @Req() req: RequestWithUser) {
    const actorName = req.user?.name ?? req.user?.email;
    return this.gstsService.create(dto, {
      actorRole: req.user?.role,
      actorName: typeof actorName === 'string' ? actorName : undefined,
    });
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

  @Get('oversight')
  @ApiOperation({
    summary: 'GST oversight overview',
    description:
      'Super admin view with seller names, linked marketplaces, imported revenue, and risk signals.',
  })
  @Roles('super_admin')
  oversight() {
    return this.gstsService.getOversight();
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
  remove(
    @Param('id') id: string,
    @Body() body: DeleteGstDto,
    @Query('unlinkMarketplaces') unlinkMarketplaces?: string,
    @Req() req?: RequestWithUser,
  ) {
    const shouldUnlink =
      unlinkMarketplaces === 'true' ||
      unlinkMarketplaces === '1' ||
      unlinkMarketplaces === 'yes';
    return this.gstsService.remove(id, {
      unlinkMarketplaces: shouldUnlink,
      requesterId: req?.user?.id,
      requesterRole: req?.user?.role,
      confirmedGstNumber: body?.gstNumber,
      confirmationText: body?.confirmation,
      ipAddress: req?.ip,
      userAgent: Array.isArray(req?.headers?.['user-agent'])
        ? req?.headers?.['user-agent']?.[0]
        : req?.headers?.['user-agent'],
    });
  }
}
