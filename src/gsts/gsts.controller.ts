import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateGstDto } from './dto/create-gst.dto';
import { GstsService } from './gsts.service';

@Controller('gsts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GstsController {
  constructor(private readonly gstsService: GstsService) {}

  @Post()
  @Roles('seller', 'super_admin')
  create(@Body() dto: CreateGstDto) {
    return this.gstsService.create(dto);
  }

  @Get()
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
}
