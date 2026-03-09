import {
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

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  @HttpCode(HttpStatus.CREATED)
  createManualLead(@Body() dto: CreateManualLeadDto, @Req() req: any) {
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
  getDashboardStats() {
    return this.leadsService.getDashboardStats();
  }

  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  listLeads(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.leadsService.listLeads({
      status,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
    });
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
  updateFollowUpStatus(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @Body('status') status: string,
    @Req() req: any,
  ) {
    const updatedBy =
      req.user?.fullName || req.user?.username || req.user?.email || 'admin';
    return this.leadsService.updateFollowUpStatus(
      id,
      followUpId,
      status,
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
  updateLeadStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
    @Req() req: any,
  ) {
    return this.leadsService.updateLeadStatus(
      id,
      dto,
      req.user?.email || 'admin',
    );
  }

  @Post(':id/convert')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  convertLead(@Param('id') id: string, @Body() dto: ConvertLeadDto) {
    return this.leadsService.convertLead(id, dto);
  }

  @Post(':id/notes')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  addNote(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.leadsService.addNote(
      id,
      body.content,
      req.user?.email || 'admin',
    );
  }

  @Post(':id/subscription')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  updateSubscription(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.leadsService.updateSubscription(
      id,
      body,
      req.user?.email || 'admin',
    );
  }

  @Post(':id/payment-link')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  generatePaymentLink(@Param('id') id: string, @Req() req: any) {
    return this.leadsService.generatePaymentLink(
      id,
      req.user?.email || 'admin',
    );
  }

  @Patch(':id/payment-status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  updatePaymentStatus(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.leadsService.updatePaymentStatus(
      id,
      body.status,
      req.user?.email || 'admin',
    );
  }

  @Post(':id/follow-up')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  scheduleFollowUp(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
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
  getLead(@Param('id') id: string) {
    return this.leadsService.getLead(id);
  }
}
