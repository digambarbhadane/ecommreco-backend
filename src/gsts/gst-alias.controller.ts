import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { VerifyGstDto } from './dto/verify-gst.dto';
import { GstsService } from './gsts.service';

type RequestWithUser = Request & {
  user?: { id?: string; role?: string };
};

/** Alias for clients expecting POST /api/v1/gst/verify */
@ApiTags('GST')
@ApiBearerAuth()
@Controller('gst')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GstAliasController {
  constructor(private readonly gstsService: GstsService) {}

  @Post('verify')
  @ApiOperation({ summary: 'Verify GST number (alias route)' })
  @Roles('seller', 'super_admin')
  verify(@Body() dto: VerifyGstDto, @Req() req: RequestWithUser) {
    const sellerId =
      req.user?.role === 'seller' && typeof req.user.id === 'string'
        ? req.user.id
        : undefined;
    return this.gstsService.verifyGst(dto, sellerId);
  }
}
