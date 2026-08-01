import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreatePaymentLinkDto,
  ListOnboardingLeadsQueryDto,
} from './dto/onboarding.dto';
import { OnboardingService } from './services/onboarding.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';

type RequestUser = { id?: string; sub?: string; email?: string };

@ApiTags('Onboarding Admin')
@Controller('onboarding/admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class OnboardingAdminController {
  constructor(
    private readonly onboardingService: OnboardingService,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
  ) {}

  @Get('leads')
  @Roles('super_admin', 'sales_manager')
  @ApiOperation({ summary: 'List onboarding leads with filters' })
  async listLeads(@Query() query: ListOnboardingLeadsQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const match: Record<string, unknown> = {
      onboardingStatus: { $exists: true },
    };
    if (query.status) match.onboardingStatus = query.status;
    if (query.assignedTo) match.assignedTo = query.assignedTo;
    if (query.source) match.source = query.source;
    if (query.search?.trim()) {
      const regex = {
        $regex: query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
      match.$or = [
        { fullName: regex },
        { email: regex },
        { firmName: regex },
        { contactNumber: regex },
        { leadNumber: regex },
      ];
    }
    const [data, total] = await Promise.all([
      this.leadModel
        .find(match)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.leadModel.countDocuments(match).exec(),
    ]);
    return { data, total, page, limit };
  }

  @Get('leads/:leadId/timeline')
  @Roles('super_admin', 'sales_manager')
  timeline(@Param('leadId') leadId: string) {
    return this.onboardingService.getLeadTimeline(leadId);
  }

  @Get('leads/:leadId/payments')
  @Roles('super_admin', 'sales_manager')
  payments(@Param('leadId') leadId: string) {
    return this.onboardingService.getLeadPayments(leadId);
  }

  @Post('payment-links')
  @Roles('super_admin', 'sales_manager')
  @ApiOperation({ summary: 'Generate signed payment link for a lead' })
  async createPaymentLink(
    @Body() dto: CreatePaymentLinkDto,
    @Req() req: { user?: RequestUser },
  ) {
    const lead = await this.leadModel.findById(dto.leadId).lean().exec();
    if (!lead?.userId) {
      throw new NotFoundException('Lead has no linked user');
    }
    return this.onboardingService.createPaymentLink({
      leadId: dto.leadId,
      userId: String(lead.userId),
      planId: dto.planId,
      linkType: dto.linkType,
      customAmount: dto.customAmount,
      expiryHours: dto.expiryHours,
      createdBy: req.user?.id ?? req.user?.sub,
    });
  }

  @Get('analytics/funnel')
  @Roles('super_admin', 'sales_manager')
  funnel() {
    return this.onboardingService.getFunnelAnalytics();
  }
}
