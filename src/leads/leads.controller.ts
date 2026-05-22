import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
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
type ScheduleDemoBody = {
  scheduledAt: string | number | Date;
  notes?: string;
  recipientEmail?: string;
  sendEmail?: boolean;
  meetLink?: string;
};
type UpdateDemoStatusBody = { status: 'scheduled' | 'done' };
type BulkAssignLeadsBody = { leadIds: string[]; salesManagerId: string };

@ApiTags('Leads')
@ApiBearerAuth('bearer')
@Controller(['leads', 'lead'])
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @ApiOperation({ summary: 'Create manual lead', description: 'Create a new lead manually. Requires super_admin or sales_manager role.' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  @HttpCode(HttpStatus.CREATED)
  createManualLead(
    @Body() body: Record<string, unknown>,
    @Req() req: RequestWithUser,
  ) {
    const contactNumber =
      typeof body.contactNumber === 'string' ? body.contactNumber.trim() : '';
    if (!/^\d{10}$/.test(contactNumber)) {
      throw new BadRequestException('contactNumber must be exactly 10 digits');
    }

    const fullName =
      typeof body.fullName === 'string' && body.fullName.trim()
        ? body.fullName.trim()
        : undefined;
    const email =
      typeof body.email === 'string' && body.email.trim()
        ? body.email.trim().toLowerCase()
        : undefined;
    const gstNumber =
      typeof body.gstNumber === 'string' && body.gstNumber.trim()
        ? body.gstNumber.trim().toUpperCase()
        : undefined;
    const source =
      typeof body.source === 'string' && body.source.trim()
        ? body.source.trim()
        : undefined;
    const assignedSalesManagerId =
      typeof body.assignedSalesManagerId === 'string' &&
      body.assignedSalesManagerId.trim()
        ? body.assignedSalesManagerId.trim()
        : undefined;
    const assignedSalesManagerEmail =
      typeof body.assignedSalesManagerEmail === 'string' &&
      body.assignedSalesManagerEmail.trim()
        ? body.assignedSalesManagerEmail.trim().toLowerCase()
        : undefined;
    const metadata =
      body.metadata && typeof body.metadata === 'object'
        ? (body.metadata as Record<string, any>)
        : undefined;

    const dto: CreateManualLeadDto = {
      contactNumber,
      ...(fullName ? { fullName } : {}),
      ...(email ? { email } : {}),
      ...(gstNumber ? { gstNumber } : {}),
      ...(source ? { source } : {}),
      ...(assignedSalesManagerId ? { assignedSalesManagerId } : {}),
      ...(assignedSalesManagerEmail ? { assignedSalesManagerEmail } : {}),
      ...(metadata ? { metadata } : {}),
    };
    return this.leadsService.createManualLead(dto, req.user);
  }

  @Post('register')
  @ApiOperation({
    summary: 'Public lead registration',
    description:
      'Public endpoint. Register a new lead from website. Rate limited by ThrottlerGuard.',
    security: [],
  })
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
  @ApiOperation({ summary: 'Import leads in bulk', description: 'Import multiple leads at once. Super admin only.' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.CREATED)
  importLeads(@Body() dto: ImportLeadsDto, @Req() req: RequestWithUser) {
    return this.leadsService.importLeads(dto, req.user);
  }

  @Get('dashboard-stats')
  @ApiOperation({ summary: 'Get dashboard statistics', description: 'Returns lead statistics for dashboard. Supports date range filtering.' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  getDashboardStats(
    @Req() req: RequestWithUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.leadsService.getDashboardStats(req.user, { from, to });
  }

  @Get()
  @ApiOperation({ summary: 'List leads', description: 'Returns paginated list of leads with filtering support.' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  listLeads(
    @Query('status') status?: string,
    @Query('today') today?: string,
    @Query('activity')
    activity?: 'generated' | 'contacted' | 'connected' | 'converted' | 'lost',
    @Query('from') from?: string,
    @Query('to') to?: string,
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
        today:
          typeof today === 'string' &&
          (today.toLowerCase() === 'true' ||
            today === '1' ||
            today.toLowerCase() === 'yes'),
        activity,
        from,
        to,
        page: Number.isFinite(parsedPage) ? parsedPage : undefined,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
        skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
        search,
      },
      req?.user,
    );
  }

  @Get('follow-ups')
  @ApiOperation({ summary: 'List follow-ups', description: 'Returns paginated list of lead follow-ups.' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  listFollowUps(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('leadId') leadId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
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
      from,
      to,
      user: req?.user,
    });
  }

  @Patch(':id/follow-ups/:followUpId/status')
  @ApiOperation({ summary: 'Update follow-up status' })
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
  @ApiOperation({ summary: 'List lead notes' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  listNotes(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('leadId') leadId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: RequestWithUser,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : 1;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : 10;
    return this.leadsService.listNotes({
      page: parsedPage,
      limit: parsedLimit,
      leadId,
      search,
      from,
      to,
      user: req?.user,
    });
  }

  // Dev/testing: public notes listing without auth, uses the same search filters
  // Do not expose in production environments
  @Get('notes-public')
  @ApiOperation({ summary: 'List notes (public, dev only)', description: 'Development-only public endpoint without authentication. Do not expose in production.' })
  listNotesPublic(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('leadId') leadId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : 1;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : 10;
    return this.leadsService.listNotes({
      page: parsedPage,
      limit: parsedLimit,
      leadId,
      search,
      from,
      to,
    });
  }

  // Dev/testing: public follow-ups listing without auth, uses the same search filters
  // Do not expose in production environments
  @Get('follow-ups-public')
  @ApiOperation({
    summary: 'List follow-ups (public, dev only)',
    description:
      'Development-only public endpoint without authentication. Do not expose in production.',
    security: [],
  })
  listFollowUpsPublic(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('leadId') leadId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const parsedPage = typeof page === 'string' ? Number(page) : 1;
    const parsedLimit = typeof limit === 'string' ? Number(limit) : 10;
    return this.leadsService.listFollowUps({
      page: parsedPage,
      limit: parsedLimit,
      leadId,
      status,
      search,
      from,
      to,
    });
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update lead status' })
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
  @ApiOperation({ summary: 'Update lead details' })
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
  @ApiOperation({ summary: 'Bulk assign leads', description: 'Assign multiple leads to a sales manager. Super admin only.' })
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
  @ApiOperation({ summary: 'Convert lead to seller', description: 'Convert a lead into a seller account with subscription details.' })
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
  @ApiOperation({ summary: 'Add note to lead' })
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
  @ApiOperation({ summary: 'Update lead note' })
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
  @ApiOperation({ summary: 'Update follow-up details', description: 'Update scheduled time and notes for a follow-up.' })
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
  @ApiOperation({ summary: 'Delete lead note' })
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
  @ApiOperation({ summary: 'Delete follow-up' })
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
  @ApiOperation({ summary: 'Update lead subscription', description: 'Assign GST slots and duration for lead subscription.' })
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
  @ApiOperation({ summary: 'Generate payment link for lead', description: 'Generate Cashfree payment link for lead subscription.' })
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
  @ApiOperation({ summary: 'Update lead payment status' })
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
  @ApiOperation({ summary: 'Schedule follow-up', description: 'Schedule a follow-up call/meeting for a lead.' })
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

  @Post([':id/demo', ':id/demos', ':id/schedule-demo'])
  @ApiOperation({ summary: 'Schedule demo', description: 'Schedule a product demo for a lead. Supports optional email notification and meeting link.' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async scheduleDemo(
    @Param('id') id: string,
    @Body() body: ScheduleDemoBody,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.scheduleDemo(
      id,
      {
        scheduledAt: new Date(body.scheduledAt),
        notes: body.notes,
        recipientEmail: body.recipientEmail,
        sendEmail: Boolean(body.sendEmail),
        meetLink: body.meetLink,
      },
      req.user?.email || 'admin',
    );
  }

  @Patch(':id/demos/:demoId/status')
  @ApiOperation({ summary: 'Update demo status', description: 'Mark demo as scheduled or done.' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async updateDemoStatus(
    @Param('id') id: string,
    @Param('demoId') demoId: string,
    @Body() body: UpdateDemoStatusBody,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.leadsService.assertLeadAccess(id, req.user);
    if (body.status !== 'scheduled' && body.status !== 'done') {
      throw new BadRequestException('Invalid demo status');
    }
    return this.leadsService.updateDemoStatus(
      id,
      demoId,
      body.status,
      req.user?.email || 'admin',
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete lead' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  async deleteLead(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.leadsService.assertLeadAccess(id, req.user);
    return this.leadsService.deleteLead(id, req.user?.email || 'admin');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead by ID' })
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
