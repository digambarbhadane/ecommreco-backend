import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { CreateLeadDto } from './dto/create-lead.dto';
import { CreateManualLeadDto } from './dto/create-manual-lead.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { Lead, LeadDocument } from './schemas/lead.schema';
import { Counter, CounterDocument } from './schemas/counter.schema';

const PRICE_PER_GST_PER_YEAR = 12000;

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(Counter.name)
    private readonly counterModel: Model<CounterDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getNextLeadId(): Promise<string> {
    const counter = await this.counterModel.findOneAndUpdate(
      { id: 'leadId' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return `LEAD-${counter.seq.toString().padStart(4, '0')}`;
  }

  async listFollowUps(params: {
    page: number;
    limit: number;
    leadId?: string;
    status?: string;
  }) {
    const skip = (params.page - 1) * params.limit;
    // Ensure followUps is a non-empty array
    const matchStage: Record<string, unknown> = {
      followUps: {
        $exists: true,
        $type: 'array',
        $ne: [],
      },
    };

    if (params.leadId) {
      matchStage.leadId = { $regex: params.leadId, $options: 'i' };
    }

    const followUpMatch: Record<string, unknown> = {};
    if (params.status && params.status !== 'all') {
      followUpMatch['followUps.status'] = params.status;
    } else if (!params.status) {
      // Default to showing only pending (which includes overdue)
      followUpMatch['followUps.status'] = 'pending';
    }

    const pipeline: PipelineStage[] = [
      { $match: matchStage as PipelineStage.Match['$match'] },
      { $unwind: '$followUps' },
      { $match: followUpMatch as PipelineStage.Match['$match'] },
      { $sort: { 'followUps.scheduledAt': 1 } }, // Ascending: Oldest (overdue) first
      { $skip: skip },
      { $limit: params.limit },
      {
        $project: {
          _id: 1,
          leadId: 1,
          fullName: 1,
          followUp: '$followUps',
        },
      },
    ];

    const data = await this.leadModel.aggregate<{
      _id: Types.ObjectId;
      leadId: string;
      fullName: string;
      followUp: unknown;
    }>(pipeline);

    const countPipeline: PipelineStage[] = [
      { $match: matchStage as PipelineStage.Match['$match'] },
      { $unwind: '$followUps' },
      { $match: followUpMatch as PipelineStage.Match['$match'] },
      { $count: 'total' },
    ];
    const countResult = await this.leadModel.aggregate<{ total: number }>(
      countPipeline,
    );
    const total = countResult[0]?.total || 0;

    return {
      success: true,
      data,
      total,
      page: params.page,
      limit: params.limit,
    };
  }

  async updateFollowUpStatus(
    leadId: string,
    followUpId: string,
    status: string,
    updatedBy: string,
  ) {
    const allowedStatuses = ['pending', 'completed', 'missed'] as const;
    if (!allowedStatuses.includes(status as (typeof allowedStatuses)[number])) {
      throw new BadRequestException('Invalid follow-up status');
    }

    if (
      !Types.ObjectId.isValid(leadId) ||
      !Types.ObjectId.isValid(followUpId)
    ) {
      throw new BadRequestException('Invalid Lead ID or Follow-up ID');
    }

    const lead = await this.leadModel.findById(leadId);
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    type FollowUpSubdoc = Lead['followUps'][number] & { _id: Types.ObjectId };
    const followUps = lead.followUps as unknown as FollowUpSubdoc[];
    const followUp = followUps.find((f) => f._id.toString() === followUpId);
    if (!followUp) {
      throw new NotFoundException('Follow-up not found in this lead');
    }

    // Update the follow-up status
    followUp.status = status as FollowUpSubdoc['status'];

    // Add to activity timeline
    lead.activityTimeline.push({
      action: 'follow_up_status_updated',
      description: `Follow-up status updated to ${status}`,
      performedBy: updatedBy,
      timestamp: new Date(),
    });

    const savedLead = await lead.save();
    return { success: true, data: savedLead };
  }

  async listNotes(params: { page: number; limit: number; leadId?: string }) {
    const skip = (params.page - 1) * params.limit;
    // Ensure notes is a non-empty array
    const matchStage: Record<string, unknown> = {
      notes: {
        $exists: true,
        $type: 'array',
        $ne: [],
      },
    };

    if (params.leadId) {
      matchStage.leadId = { $regex: params.leadId, $options: 'i' };
    }

    const pipeline: PipelineStage[] = [
      { $match: matchStage as PipelineStage.Match['$match'] },
      { $unwind: '$notes' },
      { $sort: { 'notes.createdAt': -1 } },
      { $skip: skip },
      { $limit: params.limit },
      {
        $project: {
          _id: 1,
          leadId: 1,
          fullName: 1,
          note: '$notes',
        },
      },
    ];

    const data = await this.leadModel.aggregate<{
      _id: Types.ObjectId;
      leadId: string;
      fullName: string;
      note: unknown;
    }>(pipeline);

    const countPipeline: PipelineStage[] = [
      { $match: matchStage as PipelineStage.Match['$match'] },
      { $unwind: '$notes' },
      { $count: 'total' },
    ];
    const countResult = await this.leadModel.aggregate<{ total: number }>(
      countPipeline,
    );
    const total = countResult[0]?.total || 0;

    return {
      success: true,
      data,
      total,
      page: params.page,
      limit: params.limit,
    };
  }

  async getDashboardStats() {
    const totalLeads = await this.leadModel.countDocuments();

    const leadsByStatus = await this.leadModel.aggregate<{
      _id: string;
      count: number;
    }>([
      {
        $group: {
          _id: '$leadStatus',
          count: { $sum: 1 },
        },
      },
    ]);

    const statusMap = leadsByStatus.reduce<Record<string, number>>(
      (acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      },
      {},
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newLeadsToday = await this.leadModel.countDocuments({
      createdAt: { $gte: today },
    });

    const pendingFollowUpsResult = await this.leadModel.aggregate<{
      count: number;
    }>([
      { $unwind: '$followUps' },
      { $match: { 'followUps.status': 'pending' } },
      { $count: 'count' },
    ]);
    const pendingFollowUps = pendingFollowUpsResult[0]?.count || 0;

    const convertedLeads = statusMap['converted'] || 0;
    const conversionRate =
      totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

    // Get recent leads (last 5)
    const recentLeads = await this.leadModel
      .find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('fullName email contactNumber leadStatus createdAt leadId')
      .lean();

    // Get today's follow-ups
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todaysFollowUps = await this.leadModel.aggregate<{
      leadId: string;
      fullName: string;
      contactNumber: string;
      followUp: unknown;
    }>([
      { $unwind: '$followUps' },
      {
        $match: {
          'followUps.scheduledAt': { $gte: startOfDay, $lte: endOfDay },
          'followUps.status': 'pending',
        },
      },
      {
        $project: {
          leadId: 1,
          fullName: 1,
          contactNumber: 1,
          followUp: '$followUps',
        },
      },
      { $limit: 5 },
    ]);

    return {
      success: true,
      data: {
        totalLeads,
        leadsByStatus: statusMap,
        newLeadsToday,
        pendingFollowUps,
        conversionRate: parseFloat(conversionRate.toFixed(1)),
        recentLeads,
        todaysFollowUps,
      },
    };
  }

  async createManualLead(
    dto: CreateManualLeadDto,
    createdBy: string,
    creatorRole: string,
  ) {
    // 1. Check for duplicates (Lead & Seller)
    await this.checkDuplicates(dto as CreateLeadDto);

    // 2. Calculate Lead Score
    const leadScore = this.calculateLeadScore(dto as CreateLeadDto);

    // 3. Generate Lead ID
    const leadId = await this.getNextLeadId();

    // 4. Create Lead
    const created = await this.leadModel.create({
      ...dto,
      leadId,
      source: dto.source || 'manual',
      leadStatus: 'new',
      leadScore,
      isMobileVerified: true, // Manual entry assumed verified
      verificationMethod: 'manual',
      createdBy,
      creatorRole,
      metadata: {
        createdBy,
        creatorRole,
        createdAt: new Date(),
      },
      lastRegistrationAttempt: new Date(),
      activityTimeline: [
        {
          action: 'lead_created_manually',
          description: `Lead created manually by ${creatorRole} - ${createdBy}`,
          performedBy: createdBy,
          timestamp: new Date(),
        },
      ],
      notes: [
        {
          content: `Lead created manually by ${createdBy} (${creatorRole}). Source: ${dto.source || 'manual'}`,
          addedBy: createdBy,
          createdAt: new Date(),
        },
      ],
    });

    await this.notificationsService.createNotification({
      event: 'lead_created',
      recipientRole: 'sales_admin',
      message: `New manual lead created for ${created.fullName} by ${createdBy}. Score: ${leadScore}`,
    });

    return {
      success: true,
      data: created,
    };
  }

  async createLead(
    dto: CreateLeadDto,
    source = 'website',
    ipAddress?: string,
    userAgent?: string,
  ) {
    // 1. Validate CAPTCHA
    this.validateCaptcha(dto.captchaToken);

    // 2. Check for duplicates (Lead & Seller)
    await this.checkDuplicates(dto);

    // 3. Check Cooldown (IP based)
    if (ipAddress) {
      await this.checkIpCooldown(ipAddress);
    }

    // 4. Calculate Lead Score
    const leadScore = this.calculateLeadScore(dto);

    // 5. Generate Lead ID
    const leadId = await this.getNextLeadId();

    // 6. Create Lead
    const created = await this.leadModel.create({
      ...dto,
      leadId,
      source,
      leadStatus: 'new',
      createdBy: dto.fullName,
      creatorRole: 'seller',
      ipAddress,
      userAgent,
      leadScore,
      isMobileVerified: false,
      verificationMethod: 'manual',
      metadata: {
        captchaToken: dto.captchaToken,
        ipAddress,
        userAgent,
      },
      lastRegistrationAttempt: new Date(),
      activityTimeline: [
        {
          action: 'lead_created_by_seller',
          description: `Lead created by seller ${dto.fullName}`,
          performedBy: dto.fullName,
          timestamp: new Date(),
        },
      ],
      notes: [
        {
          content: `Lead created by seller ${dto.fullName}. Source: ${source}`,
          addedBy: dto.fullName,
          createdAt: new Date(),
        },
      ],
    });

    await this.notificationsService.createNotification({
      event: 'lead_created',
      recipientRole: 'sales_admin',
      message: `New lead created for ${created.fullName}. Score: ${leadScore}`,
    });

    return {
      success: true,
      data: created,
    };
  }

  private validateCaptcha(token: string) {
    if (!token || token === 'invalid-token') {
      throw new BadRequestException('Invalid CAPTCHA');
    }
  }

  private async checkDuplicates(dto: CreateLeadDto) {
    const { email, contactNumber, gstNumber } = dto;
    const errors: Record<string, string> = {};

    // Check for duplicates in Sellers collection
    const existingSeller = await this.sellerModel
      .findOne({
        $or: [{ email }, { contactNumber }, { gstNumber }],
      })
      .exec();

    if (existingSeller) {
      if (existingSeller.email === email) {
        errors.email = 'An account with this email already exists.';
      }
      if (existingSeller.contactNumber === contactNumber) {
        errors.contactNumber =
          'An account with this mobile number already exists.';
      }
      if (existingSeller.gstNumber === gstNumber) {
        errors.gstNumber = 'An account with this GST number already exists.';
      }
    }

    // Check for duplicates in Leads collection
    // We only need to check if we haven't already found an error for a field,
    // but to be thorough and catch all conflicts, we check anyway.
    const existingLead = await this.leadModel
      .findOne({
        $or: [{ email }, { contactNumber }, { gstNumber }],
      })
      .exec();

    if (existingLead) {
      if (existingLead.email === email && !errors.email) {
        errors.email = 'A lead with this email already exists.';
      }
      if (
        existingLead.contactNumber === contactNumber &&
        !errors.contactNumber
      ) {
        errors.contactNumber = 'A lead with this mobile number already exists.';
      }
      if (existingLead.gstNumber === gstNumber && !errors.gstNumber) {
        errors.gstNumber = 'A lead with this GST number already exists.';
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new BadRequestException({
        success: false,
        message: 'Duplicate details found.',
        errors,
      });
    }
  }

  private async checkIpCooldown(ipAddress: string) {
    const ONE_HOUR = 60 * 60 * 1000;
    const MAX_ATTEMPTS_PER_HOUR = 5;

    const recentLeadsCount = await this.leadModel.countDocuments({
      ipAddress,
      createdAt: { $gte: new Date(Date.now() - ONE_HOUR) },
    });

    if (recentLeadsCount >= MAX_ATTEMPTS_PER_HOUR) {
      throw new BadRequestException({
        success: false,
        message:
          'Too many registration attempts from this IP. Please try again later.',
      });
    }
  }

  private calculateLeadScore(dto: CreateLeadDto): number {
    let score = 0;

    // Base score for completing form
    score += 10;

    // GST Presence (High Value)
    if (dto.gstNumber) score += 50;

    // Email Validation (Basic)
    if (dto.email && dto.email.includes('@')) {
      score += 10;
      // Bonus for corporate domains (simple heuristic)
      const domain = dto.email.split('@')[1];
      const publicDomains = [
        'gmail.com',
        'yahoo.com',
        'outlook.com',
        'hotmail.com',
      ];
      if (domain && !publicDomains.includes(domain)) {
        score += 20; // Corporate email bonus
      }
    }

    // Mobile Validation (Basic)
    if (dto.contactNumber) score += 10;

    return score;
  }

  async listLeads(params: { status?: string; limit?: number; skip?: number }) {
    const limit = Math.max(0, params.limit ?? 10);
    const skip = Math.max(0, params.skip ?? 0);
    const filter: Record<string, unknown> = {};
    if (params.status) {
      filter.leadStatus = params.status;
    }
    const data = await this.leadModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    const total = await this.leadModel.countDocuments(filter);
    return {
      success: true,
      data,
      total,
      limit,
      skip,
    };
  }

  async getLead(id: string) {
    const lead = await this.leadModel.findById(id).lean().exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return {
      success: true,
      data: lead,
    };
  }

  async addNote(id: string, content: string, addedBy: string) {
    // Check if notes is an array, if not (e.g. string or null), reset it to empty array
    const existing = await this.leadModel
      .findById(id)
      .select('notes')
      .lean<{ notes?: unknown }>()
      .exec();
    if (existing && !Array.isArray(existing.notes)) {
      await this.leadModel.findByIdAndUpdate(id, { $set: { notes: [] } });
    }

    const lead = await this.leadModel.findByIdAndUpdate(
      id,
      {
        $push: {
          notes: {
            content,
            addedBy,
            createdAt: new Date(),
          },
          activityTimeline: {
            action: 'note_added',
            description: 'Note added to lead',
            performedBy: addedBy,
            timestamp: new Date(),
          },
        },
      },
      { new: true },
    );
    return { success: true, data: lead };
  }

  async updateSubscription(
    id: string,
    config: { gstSlots: number; durationYears: number },
    updatedBy: string,
  ) {
    const amount =
      config.gstSlots * config.durationYears * PRICE_PER_GST_PER_YEAR;
    const lead = await this.leadModel.findByIdAndUpdate(
      id,
      {
        $set: {
          subscriptionConfig: {
            ...config,
            amount,
            updatedAt: new Date(),
            updatedBy,
          },
          pipelineStage: 'Interested',
        },
        $push: {
          activityTimeline: {
            action: 'subscription_updated',
            description: `Subscription updated: ${config.gstSlots} GSTs, ${config.durationYears} Years, Amount: ${amount}`,
            performedBy: updatedBy,
            timestamp: new Date(),
          },
        },
      },
      { new: true },
    );
    return { success: true, data: lead };
  }

  async generatePaymentLink(id: string, generatedBy: string) {
    const lead = await this.leadModel.findById(id);
    if (!lead) throw new NotFoundException('Lead not found');
    if (!lead.subscriptionConfig) {
      throw new BadRequestException('Subscription configuration missing');
    }

    const expiryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const paymentLink = this.buildPaymentLink({
      sellerEmail: lead.email,
      gstSlots: lead.subscriptionConfig.gstSlots,
      durationYears: lead.subscriptionConfig.durationYears,
      amount: lead.subscriptionConfig.amount,
      expiryDate,
    });

    const updated = await this.leadModel.findByIdAndUpdate(
      id,
      {
        $set: {
          paymentDetails: {
            link: paymentLink,
            status: 'sent',
            generatedBy,
            generatedAt: new Date(),
            expiryDate,
          },
          pipelineStage: 'Payment Link Generated',
        },
        $push: {
          activityTimeline: {
            action: 'payment_link_generated',
            description: `Payment link generated for amount ${lead.subscriptionConfig.amount}`,
            performedBy: generatedBy,
            timestamp: new Date(),
          },
        },
      },
      { new: true },
    );

    return { success: true, data: updated };
  }

  async updatePaymentStatus(id: string, status: string, updatedBy: string) {
    const lead = await this.leadModel.findByIdAndUpdate(
      id,
      {
        $set: {
          'paymentDetails.status': status,
          'paymentDetails.paymentDate':
            status === 'completed' ? new Date() : undefined,
          pipelineStage:
            status === 'completed' ? 'Payment Completed' : 'Payment Pending',
        },
        $push: {
          activityTimeline: {
            action: 'payment_status_updated',
            description: `Payment status updated to ${status}`,
            performedBy: updatedBy,
            timestamp: new Date(),
          },
        },
      },
      { new: true },
    );
    return { success: true, data: lead };
  }

  async scheduleFollowUp(
    id: string,
    scheduledAt: Date,
    notes: string,
    createdBy: string,
  ) {
    const lead = await this.leadModel.findByIdAndUpdate(
      id,
      {
        $push: {
          followUps: {
            scheduledAt,
            notes,
            createdBy,
            status: 'pending',
          },
          activityTimeline: {
            action: 'follow_up_scheduled',
            description: `Follow-up scheduled for ${new Date(scheduledAt).toLocaleString()}`,
            performedBy: createdBy,
            timestamp: new Date(),
          },
        },
      },
      { new: true },
    );
    return { success: true, data: lead };
  }

  async updateLeadStatus(
    leadId: string,
    dto: UpdateLeadStatusDto,
    updatedBy: string = 'system',
  ) {
    // Safety check for notes and activityTimeline fields
    const existing = await this.leadModel
      .findById(leadId)
      .select('notes activityTimeline')
      .lean<{ notes?: unknown; activityTimeline?: unknown }>()
      .exec();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (!Array.isArray(existing.notes)) {
        updates.notes = [];
      }
      if (!Array.isArray(existing.activityTimeline)) {
        updates.activityTimeline = [];
      }

      if (Object.keys(updates).length > 0) {
        await this.leadModel.findByIdAndUpdate(leadId, { $set: updates });
      }
    }

    // Map leadStatus to pipelineStage
    let pipelineStage = 'New Lead';
    switch (dto.leadStatus) {
      case 'new':
        pipelineStage = 'New Lead';
        break;
      case 'contacted':
        pipelineStage = 'Contacted';
        break;
      case 'interested':
        pipelineStage = 'Interested';
        break;
      case 'converted':
        pipelineStage = 'Converted to Seller';
        break;
      case 'rejected':
        // Keep current stage or move to a specific rejected stage if exists
        // For now, we'll keep it as is, or maybe 'Rejected' if the frontend supports it.
        // The frontend SalesPipeline doesn't have 'Rejected', so we might leave it or set to last known.
        // Let's not update pipelineStage for rejected to avoid breaking the UI flow visualization.
        break;
    }

    const activityTimelineEntry = {
      action: 'status_updated',
      description: `Status updated to ${dto.leadStatus}`,
      performedBy: updatedBy,
      timestamp: new Date(),
    };

    const updateOps: {
      $set: Record<string, unknown>;
      $push: Record<string, unknown>;
    } = {
      $set: { leadStatus: dto.leadStatus },
      $push: {
        activityTimeline: activityTimelineEntry,
      },
    };

    if (dto.leadStatus !== 'rejected') {
      updateOps.$set.pipelineStage = pipelineStage;
    }

    if (dto.notes) {
      updateOps.$push.notes = {
        content: dto.notes,
        addedBy: updatedBy,
        createdAt: new Date(),
      };
      activityTimelineEntry.description = `${activityTimelineEntry.description}. Note: ${dto.notes}`;
    }

    const updated = await this.leadModel
      .findByIdAndUpdate(leadId, updateOps, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException({
        success: false,
        message: 'Lead not found',
      });
    }
    return {
      success: true,
      data: updated,
    };
  }

  async convertLead(leadId: string, dto: ConvertLeadDto) {
    const lead = await this.leadModel.findById(leadId).exec();
    if (!lead) {
      throw new NotFoundException({
        success: false,
        message: 'Lead not found',
      });
    }
    if (lead.leadStatus === 'converted') {
      throw new BadRequestException({
        success: false,
        message: 'Lead already converted',
      });
    }
    if (lead.leadStatus === 'rejected') {
      throw new BadRequestException({
        success: false,
        message: 'Rejected leads cannot be converted',
      });
    }

    // Determine subscription details
    let gstSlots = dto.gstSlots;
    let durationYears = dto.durationYears;
    let amount = 0;

    if (!gstSlots || !durationYears) {
      if (lead.subscriptionConfig) {
        gstSlots = lead.subscriptionConfig.gstSlots;
        durationYears = lead.subscriptionConfig.durationYears;
        amount = lead.subscriptionConfig.amount;
      } else {
        // Default to 1 GST, 1 Year if nothing configured
        gstSlots = 1;
        durationYears = 1;
        amount = PRICE_PER_GST_PER_YEAR;
      }
    } else {
      amount = gstSlots * durationYears * PRICE_PER_GST_PER_YEAR;
    }

    // Force payment completion as per Sales Manager action
    const paymentCompletedAt = new Date();

    // Create Seller Record
    const seller = await this.sellerModel.create({
      fullName: lead.fullName,
      contactNumber: lead.contactNumber,
      email: lead.email,
      gstNumber: lead.gstNumber,
      leadId: lead._id.toString(),
      gstSlots,
      durationYears,
      amount,
      paymentCompletedAt,
      onboardingStatus: 'payment_completed',
    });

    // Update Lead Status
    lead.leadStatus = 'converted';
    lead.pipelineStage = 'Converted to Seller';

    // Mark Lead Payment as Completed
    const paymentDetails = lead.paymentDetails ?? {
      link: 'manual-conversion',
      status: 'completed',
      generatedBy: 'system',
      generatedAt: new Date(),
    };
    paymentDetails.status = 'completed';
    paymentDetails.paymentDate = paymentCompletedAt;
    lead.paymentDetails = paymentDetails;

    await lead.save();

    await this.notificationsService.createNotification({
      event: 'lead_converted',
      recipientRole: 'operations_admin', // Notify ops/accounts
      message: `Lead ${lead.fullName} converted to seller ${seller.id}. Payment marked as completed.`,
    });

    // Also notify accounts manager specifically if needed, or rely on 'operations_admin' role covering it.
    // Assuming 'accounts_manager' is a separate role, let's add notification for them too.
    await this.notificationsService.createNotification({
      event: 'lead_converted',
      recipientRole: 'accounts_manager',
      message: `New Seller ${lead.fullName} onboarded. Payment of ₹${amount} marked as completed.`,
    });

    return {
      success: true,
      data: {
        seller,
        amount,
        paymentCompletedAt,
      },
    };
  }

  private buildPaymentLink(params: {
    sellerEmail: string;
    gstSlots: number;
    durationYears: number;
    amount: number;
    expiryDate: Date;
  }) {
    const query = new URLSearchParams({
      sellerEmail: params.sellerEmail,
      gstSlots: params.gstSlots.toString(),
      durationYears: params.durationYears.toString(),
      amount: params.amount.toString(),
      expiryDate: params.expiryDate.toISOString(),
    });
    return `https://payments.sellerinsights.com/checkout?${query.toString()}`;
  }
}
