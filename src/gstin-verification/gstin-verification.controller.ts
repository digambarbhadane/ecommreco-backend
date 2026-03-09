import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GstinVerificationService } from './gstin-verification.service';
import { VerifyGstinDto } from './dto/verify-gstin.dto';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

type RequestUser = {
  id?: string;
  role?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};

@Controller('gstin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GstinVerificationController {
  constructor(private readonly gstinService: GstinVerificationService) {}

  @Post('verify')
  @Roles('seller', 'super_admin')
  verify(@Body() dto: VerifyGstinDto, @Req() req: RequestWithUser) {
    const userId = typeof req.user?.id === 'string' ? req.user.id : undefined;
    return this.gstinService.verify(dto, userId);
  }
}
