import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { ImportLeadsDto } from './dto/import-leads.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadsService } from './leads.service';

import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

type AuthenticatedUser = {
  id?: string;
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
type BulkAssignLeadsBody = { leadIds: string[]; salesManagerId: string };

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  @HttpCode(HttpStatus.CREATED)
  createManualLead(
    @Body() dto: CreateManualLeadDto,
    @Req() req: RequestWithUser,
  ) {
    return this.leadsService.createManualLead(dto, req.user);
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

  @Post('import')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.CREATED)
  importLeads(@Body() dto: ImportLeadsDto, @Req() req: RequestWithUser) {
    return this.leadsService.importLeads(dto, req.user);
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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('search') search?: string,
    @Req() req?: RequestWithUser,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : undefined;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.leadsService.listLeads(
      {
        status,
        page: Number.isFinite(parsedPage) ? parsedPage : undefined,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
        skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
        search,
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
    @Query('search') search?: string,
    @Req() req?: RequestWithUser,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : 1;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : 10;
    return this.leadsService.listFollowUps({
      page: parsedPage,
      limit: parsedLimit,
      leadId,
      status,
      search,
      user: req?.user,
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
    @Query('search') search?: string,
    @Req() req?: RequestWithUser,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : 1;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : 10;
    return this.leadsService.listNotes({
      page: parsedPage,
      limit: parsedLimit,
      leadId,
      search,
      user: req?.user,
    });
  }

  // Dev/testing: public notes listing without auth, uses the same search filters
  // Do not expose in production environments
  @Get('notes-public')
  listNotesPublic(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('leadId') leadId?: string,
    @Query('search') search?: string,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : 1;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : 10;
    return this.leadsService.listNotes({
      page: parsedPage,
      limit: parsedLimit,
      leadId,
      search,
    });
  }

  // Dev/testing: public follow-ups listing without auth, uses the same search filters
  // Do not expose in production environments
  @Get('follow-ups-public')
  listFollowUpsPublic(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('leadId') leadId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : 1;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : 10;
    return this.leadsService.listFollowUps({
      page: parsedPage,
      limit: parsedLimit,
      leadId,
      status,
      search,
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

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async updateLeadDetails(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.updateLeadDetails(
      id,
      dto,
      req.user?.email || 'admin',
    );
  }

  @Patch('assign')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  bulkAssignLeads(
    @Body() body: BulkAssignLeadsBody,
    @Req() req: RequestWithUser,
  ) {
    return this.leadsService.bulkAssignLeadsToSalesManager({
      leadIds: body.leadIds,
      salesManagerId: body.salesManagerId,
      user: req.user,
    });
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
  async addNote(
    @Param('id') id: string,
    @Body() body: AddNoteBody,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.addNote(
      id,
      body.content,
      req.user?.email || 'admin',
    );
  }

  @Patch(':id/notes/:noteId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async updateNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body('content') content: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.updateNote(
      id,
      noteId,
      content,
      req.user?.email || 'admin',
    );
  }

  @Patch(':id/follow-ups/:followUpId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async updateFollowUp(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @Body() body: { scheduledAt?: string | Date; notes?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.updateFollowUp(
      id,
      followUpId,
      body,
      req.user?.email || 'admin',
    );
  }

  @Delete(':id/notes/:noteId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async deleteNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.deleteNote(id, noteId, req.user?.email || 'admin');
  }

  @Delete(':id/follow-ups/:followUpId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async deleteFollowUp(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.deleteFollowUp(
      id,
      followUpId,
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
    return this.leadsService
      .assertLeadAccess(id, req.user)
      .then(() =>
        this.leadsService.generatePaymentLink(id, req.user?.email || 'admin'),
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

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  deleteLead(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.leadsService.deleteLead(id, req.user);
  }

  @Post(':id/delete')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  deleteLeadCompat(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.leadsService.deleteLead(id, req.user);
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
