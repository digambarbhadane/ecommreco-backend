import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SalesActivityService } from './sales-activity.service';
import type { Request } from 'express';

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  username?: string;
  fullName?: string;
  name?: string;
};
type RequestWithUser = Request & { user?: RequestUser };

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SalesActivityController {
  constructor(private readonly svc: SalesActivityService) {}

  @Get('sales-activity/today')
  @Roles('sales_manager', 'super_admin')
  async getToday(
    @Req() req: RequestWithUser,
    @Query('salesManagerId') salesManagerId?: string,
  ) {
    const role = req.user?.role;
    const id = req.user?.id;
    const effectiveId =
      role === 'super_admin' && salesManagerId ? salesManagerId : id || '';
    const actorIdentifiers =
      role === 'sales_manager'
        ? [
            req.user?.email,
            req.user?.username,
            req.user?.fullName,
            req.user?.name,
          ]
            .map((v) => (typeof v === 'string' ? v.trim() : ''))
            .filter((v) => Boolean(v))
        : undefined;
    const stats = await this.svc.getTodayStats({
      salesManagerId: effectiveId,
      actorIdentifiers,
    });
    return { success: true, data: stats };
  }

  @Post('sales-target')
  @Roles('sales_manager', 'super_admin')
  async assignTarget(
    @Body()
    body: {
      salesManagerId?: string;
      targetLeadsToContact: number;
      targetConversions: number;
    },
    @Req() req: RequestWithUser,
  ) {
    const role = req.user?.role;
    const id = req.user?.id || '';
    const effectiveId = role === 'super_admin' ? body.salesManagerId || id : id;
    return this.svc.assignTarget({
      salesManagerId: effectiveId,
      targetLeadsToContact: body.targetLeadsToContact,
      targetConversions: body.targetConversions,
      createdBy: req.user?.email,
    });
  }

  @Get('sales-target/:salesManagerId')
  @Roles('sales_manager', 'super_admin')
  async getTarget(
    @Param('salesManagerId') salesManagerId: string,
    @Req() req: RequestWithUser,
  ) {
    const role = req.user?.role;
    const id = req.user?.id;
    const effectiveId =
      role === 'super_admin' && salesManagerId ? salesManagerId : id || '';
    return this.svc.getTodayTarget({ salesManagerId: effectiveId });
  }
}
