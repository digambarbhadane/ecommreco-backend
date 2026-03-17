import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { CreateManualLeadDto } from './dto/create-manual-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadsService } from './leads.service';

import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

type AuthenticatedUser = {
  fullName?: string;
  username?: string;
  email?: string;
  role?: string;
};

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

type AddNoteBody = { content: string };
type SubscriptionBody = { gstSlots: number; durationYears: number };
type PaymentStatusBody = { status: string };
type ScheduleFollowUpBody = {
  scheduledAt: string | number | Date;
  notes: string;
};

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  @HttpCode(HttpStatus.CREATED)
  createManualLead(
    @Body() dto: CreateManualLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const createdBy =
      req.user?.fullName || req.user?.username || req.user?.email || 'admin';
    const creatorRole = req.user?.role || 'admin';
    return this.leadsService.createManualLead(dto, createdBy, creatorRole);
  }

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.CREATED)
  createLead(
    @Body() dto: CreateLeadDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.leadsService.createLead(
      dto,
      dto.source || 'website',
      ip,
      userAgent,
    );
  }

  @Get('dashboard-stats')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  getDashboardStats(@Req() req: RequestWithUser) {
    return this.leadsService.getDashboardStats(req.user);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  listLeads(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Req() req?: RequestWithUser,
  ) {
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.leadsService.listLeads(
      {
        status,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
        skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
      },
      req?.user,
    );
  }

  @Get('follow-ups')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  listFollowUps(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('leadId') leadId?: string,
    @Query('status') status?: string,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : 1;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : 10;
    return this.leadsService.listFollowUps({
      page: parsedPage,
      limit: parsedLimit,
      leadId,
      status,
    });
  }

  @Patch(':id/follow-ups/:followUpId/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async updateFollowUpStatus(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @Body('status') status: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    const nextStatus =
      status === 'pending' || status === 'completed' || status === 'missed'
        ? status
        : undefined;
    if (!nextStatus) {
      throw new BadRequestException('Invalid follow-up status');
    }
    const updatedBy =
      req.user?.fullName || req.user?.username || req.user?.email || 'admin';
    return this.leadsService.updateFollowUpStatus(
      id,
      followUpId,
      nextStatus,
      updatedBy,
    );
  }

  @Get('notes')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  listNotes(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('leadId') leadId?: string,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : 1;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : 10;
    return this.leadsService.listNotes({
      page: parsedPage,
      limit: parsedLimit,
      leadId,
    });
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async updateLeadStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.updateLeadStatus(
      id,
      dto,
      req.user?.email || 'admin',
    );
  }

  @Post(':id/convert')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async convertLead(
    @Param('id') id: string,
    @Body() dto: ConvertLeadDto,
    @Req() req: RequestWithUser,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.convertLead(id, dto, req.user);
  }

  @Post(':id/notes')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  addNote(
    @Param('id') id: string,
    @Body() body: AddNoteBody,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.addNote(
      id,
      body.content,
      req.user?.email || 'admin',
    );
  }

  @Post(':id/subscription')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async updateSubscription(
    @Param('id') id: string,
    @Body() body: SubscriptionBody,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.updateSubscription(
      id,
      body,
      req.user?.email || 'admin',
    );
  }

  @Post(':id/payment-link')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  generatePaymentLink(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.generatePaymentLink(
      id,
      req.user?.email || 'admin',
    );
  }

  @Patch(':id/payment-status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async updatePaymentStatus(
    @Param('id') id: string,
    @Body() body: PaymentStatusBody,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.updatePaymentStatus(
      id,
      body.status,
      req.user?.email || 'admin',
    );
  }

  @Post(':id/follow-up')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async scheduleFollowUp(
    @Param('id') id: string,
    @Body() body: ScheduleFollowUpBody,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.scheduleFollowUp(
      id,
      new Date(body.scheduledAt),
      body.notes,
      req.user?.email || 'admin',
    );
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  getLead(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.leadsService.getLead(id, req.user);
  }
}

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  fullName?: string;
  username?: string;
  name?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};
