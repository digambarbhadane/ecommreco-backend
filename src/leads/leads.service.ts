import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types, UpdateQuery } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { generatePublicId } from '../common/public-id';
import { CreateLeadDto } from './dto/create-lead.dto';
import { CreateManualLeadDto } from './dto/create-manual-lead.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { Lead, LeadDocument } from './schemas/lead.schema';
import { Counter, CounterDocument } from './schemas/counter.schema';

const PRICE_PER_GST_PER_YEAR = 12000;

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  fullName?: string;
  username?: string;
  name?: string;
};

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

  private async getNextLeadId(date = new Date()): Promise<string> {
    const yyyy = date.getFullYear().toString();
    const mm = (date.getMonth() + 1).toString().padStart(2, '0');
    const yyyymm = `${yyyy}${mm}`;
    const prefix = 'LEAD';

    const counter = await this.counterModel.findOneAndUpdate(
      { id: `leadId:${prefix}:${yyyymm}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );

    const seq = counter.seq.toString().padStart(4, '0');
    return `${prefix}-${yyyymm}-${seq}`;
  }

  private toDate(value: unknown): Date {
    return value instanceof Date ? value : new Date();
  }

  private getSalesManagerIdentifiers(user?: RequestUser) {
    const identifiers = [
      typeof user?.email === 'string' ? user.email.toLowerCase() : undefined,
      typeof user?.fullName === 'string' ? user.fullName : undefined,
      typeof user?.username === 'string' ? user.username : undefined,
      typeof user?.name === 'string' ? user.name : undefined,
    ].filter((v): v is string => Boolean(v));
    return Array.from(new Set(identifiers));
  }

  private buildSalesManagerLeadAccessFilter(user?: RequestUser) {
    const role = typeof user?.role === 'string' ? user.role : undefined;
    if (role !== 'sales_manager') return undefined;
    const identifiers = this.getSalesManagerIdentifiers(user);
    if (!identifiers.length) return undefined;

    const unassignedFilter = {
      $or: [
        { assignedSalesManager: { $exists: false } },
        { assignedSalesManager: null },
        { assignedSalesManager: '' },
      ],
    };

    const visibleUnassignedCreatorRoleFilter = {
      $or: [
        { creatorRole: { $exists: false } },
        { creatorRole: { $ne: 'sales_manager' } },
      ],
    };

    return {
      $or: [
        { createdBy: { $in: identifiers } },
        { assignedSalesManager: { $in: identifiers } },
        { $and: [unassignedFilter, visibleUnassignedCreatorRoleFilter] },
      ],
    };
  }

  private buildLeadIdentityFilter(id: string) {
    const filters: Array<Record<string, unknown>> = [{ leadId: id }];
    if (
      typeof id === 'string' &&
      id.length === 24 &&
      Types.ObjectId.isValid(id)
    ) {
      filters.unshift({ _id: id });
    }
    return { $or: filters };
  }

  async assertLeadAccess(leadId: string, user?: RequestUser) {
    const role = typeof user?.role === 'string' ? user.role : undefined;
    if (role !== 'sales_manager') return;

    const filter = this.buildSalesManagerLeadAccessFilter(user);
    if (!filter) return;

    const identityFilter = this.buildLeadIdentityFilter(leadId);
    const exists = await this.leadModel
      .findOne({ $and: [identityFilter, filter] })
      .select('_id')
      .lean()
      .exec();
    if (!exists) {
      throw new NotFoundException('Lead not found');
    }
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
    status: 'pending' | 'completed' | 'missed',
    updatedBy: string,
  ) {
    const allowedStatuses = ['pending', 'completed', 'missed'] as const;
    if (!allowedStatuses.includes(status)) {
      throw new BadRequestException('Invalid follow-up status');
    }

    if (
      !Types.ObjectId.isValid(leadId) ||
      !Types.ObjectId.isValid(followUpId)
    ) {
      throw new BadRequestException('Invalid Lead ID or Follow-up ID');
    }

    const lead = await this.leadModel.findOne(
      this.buildLeadIdentityFilter(leadId),
    );
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    if (!lead.leadId) {
      lead.leadId = await this.getNextLeadId(
        this.toDate((lead as unknown as { createdAt?: unknown }).createdAt),
      );
    }
    if (!(lead as unknown as { publicId?: string }).publicId) {
      (lead as unknown as { publicId?: string }).publicId = generatePublicId(
        'lead',
        (lead as unknown as { email?: string }).email ?? '',
      );
    }

    type FollowUpSubdoc = Lead['followUps'][number] & { _id: Types.ObjectId };
    const followUps = lead.followUps as unknown as FollowUpSubdoc[];
    const followUp = followUps.find((f) => f._id.toString() === followUpId);
    if (!followUp) {
      throw new NotFoundException('Follow-up not found in this lead');
    }

    // Update the follow-up status
    followUp.status = status;

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

  async getDashboardStats(user?: RequestUser) {
    const salesFilter = this.buildSalesManagerLeadAccessFilter(user);
    const baseFilter: Record<string, unknown> = salesFilter ? salesFilter : {};

    const totalLeads = await this.leadModel.countDocuments(baseFilter);

    const leadsByStatus = await this.leadModel.aggregate<{
      _id: string;
      count: number;
    }>([
      { $match: baseFilter as PipelineStage.Match['$match'] },
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
      ...(salesFilter ? baseFilter : {}),
      createdAt: { $gte: today },
    });

    const pendingFollowUpsResult = await this.leadModel.aggregate<{
      count: number;
    }>([
      { $match: baseFilter as PipelineStage.Match['$match'] },
      { $unwind: '$followUps' },
      { $match: { 'followUps.status': 'pending' } },
      { $count: 'count' },
    ]);
    const pendingFollowUps = pendingFollowUpsResult[0]?.count ?? 0;

    const convertedLeads = statusMap['converted'] || 0;
    const conversionRate =
      totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

    // Get recent leads (last 5)
    const recentLeads = await this.leadModel
      .find(baseFilter)
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
      publicId: generatePublicId('lead', dto.email),
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
      publicId: generatePublicId('lead', dto.email),
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

  async listLeads(
    params: { status?: string; limit?: number; skip?: number },
    user?: RequestUser,
  ) {
    const limit = Math.max(0, params.limit ?? 10);
    const skip = Math.max(0, params.skip ?? 0);
    const filter: Record<string, unknown> = {};
    if (params.status) {
      filter.leadStatus = params.status;
    }
    const salesFilter = this.buildSalesManagerLeadAccessFilter(user);
    if (salesFilter) {
      Object.assign(filter, salesFilter);
    }
    const data = await this.leadModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<
        Array<Lead & { _id: Types.ObjectId; createdAt?: Date; leadId?: string }>
      >()
      .exec();

    const ops: Array<{
      updateOne: {
        filter: { _id: Types.ObjectId };
        update: { $set: { leadId?: string; publicId?: string } };
      };
    }> = [];
    for (const lead of data) {
      const setUpdate: { leadId?: string; publicId?: string } = {};
      const currentLeadId = (lead as unknown as { leadId?: string }).leadId;
      if (!currentLeadId) {
        const leadId = await this.getNextLeadId(this.toDate(lead.createdAt));
        (lead as unknown as { leadId?: string }).leadId = leadId;
        setUpdate.leadId = leadId;
      }
      const currentPublicId = (lead as unknown as { publicId?: string })
        .publicId;
      if (!currentPublicId) {
        const email = (lead as unknown as { email?: string }).email ?? '';
        const publicId = generatePublicId('lead', email);
        (lead as unknown as { publicId?: string }).publicId = publicId;
        setUpdate.publicId = publicId;
      }
      if (Object.keys(setUpdate).length) {
        ops.push({
          updateOne: {
            filter: { _id: lead._id },
            update: { $set: setUpdate },
          },
        });
      }
    }
    if (ops.length) {
      await this.leadModel.bulkWrite(ops);
    }

    const total = await this.leadModel.countDocuments(filter);
    return {
      success: true,
      data,
      total,
      limit,
      skip,
    };
  }

  async getLead(id: string, user?: RequestUser) {
    const salesFilter = this.buildSalesManagerLeadAccessFilter(user);
    const identityFilter = this.buildLeadIdentityFilter(id);
    const query = salesFilter
      ? { $and: [identityFilter, salesFilter] }
      : identityFilter;
    const lead = await this.leadModel.findOne(query).exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    if (!lead.leadId) {
      lead.leadId = await this.getNextLeadId(
        this.toDate((lead as unknown as { createdAt?: unknown }).createdAt),
      );
    }
    if (!(lead as unknown as { publicId?: string }).publicId) {
      (lead as unknown as { publicId?: string }).publicId = generatePublicId(
        'lead',
        (lead as unknown as { email?: string }).email ?? '',
      );
    }
    if (lead.isModified()) {
      await lead.save();
    }
    return {
      success: true,
      data: lead.toObject(),
    };
  }

  async addNote(id: string, content: string, addedBy: string) {
    const identityFilter = this.buildLeadIdentityFilter(id);
    // Check if notes is an array, if not (e.g. string or null), reset it to empty array
    const existing = await this.leadModel
      .findById(id)
      .select('notes')
      .lean<{ notes?: unknown }>()
      .exec();
    if (existing && !Array.isArray(existing.notes)) {
      await this.leadModel.updateOne(identityFilter, { $set: { notes: [] } });
    }

    const lead = await this.leadModel.findOneAndUpdate(
      identityFilter,
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
    const lead = await this.leadModel.findOneAndUpdate(
      this.buildLeadIdentityFilter(id),
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
    const identityFilter = this.buildLeadIdentityFilter(id);
    const lead = await this.leadModel.findOne(identityFilter);
    if (!lead) throw new NotFoundException('Lead not found');
    if (!lead.subscriptionConfig) {
      throw new BadRequestException('Subscription configuration missing');
    }
    if (!lead.leadId) {
      lead.leadId = await this.getNextLeadId(
        this.toDate((lead as unknown as { createdAt?: unknown }).createdAt),
      );
    }
    if (!(lead as unknown as { publicId?: string }).publicId) {
      (lead as unknown as { publicId?: string }).publicId = generatePublicId(
        'lead',
        (lead as unknown as { email?: string }).email ?? '',
      );
    }
    if (lead.isModified()) {
      await lead.save();
    }

    const expiryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const paymentLink = this.buildPaymentLink({
      sellerEmail: lead.email,
      gstSlots: lead.subscriptionConfig.gstSlots,
      durationYears: lead.subscriptionConfig.durationYears,
      amount: lead.subscriptionConfig.amount,
      expiryDate,
    });

    const updated = await this.leadModel.findOneAndUpdate(
      identityFilter,
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
    const lead = await this.leadModel.findOneAndUpdate(
      this.buildLeadIdentityFilter(id),
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

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (status === 'completed') {
      await this.notificationsService.createNotification({
        event: 'payment_completed',
        recipientRole: 'accounts_manager',
        message: `Payment completed for lead ${lead.fullName}. Please verify and proceed with onboarding.`,
      });
    }

    return { success: true, data: lead };
  }

  async scheduleFollowUp(
    id: string,
    scheduledAt: Date,
    notes: string,
    createdBy: string,
  ) {
    const lead = await this.leadModel.findOneAndUpdate(
      this.buildLeadIdentityFilter(id),
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
    const identityFilter = this.buildLeadIdentityFilter(leadId);
    // Safety check for notes and activityTimeline fields
    const existing = await this.leadModel
      .findOne(identityFilter)
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
        await this.leadModel.updateOne(identityFilter, { $set: updates });
      }
    }

    // Map leadStatus to pipelineStage
    let pipelineStage: Lead['pipelineStage'] = 'New Lead';
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

    const setUpdate: Partial<Pick<Lead, 'leadStatus' | 'pipelineStage'>> = {
      leadStatus: dto.leadStatus,
    };
    if (dto.leadStatus !== 'rejected') {
      setUpdate.pipelineStage = pipelineStage;
    }

    const pushUpdate: NonNullable<UpdateQuery<LeadDocument>['$push']> = {
      activityTimeline: activityTimelineEntry,
    };

    if (dto.notes) {
      pushUpdate.notes = {
        content: dto.notes,
        addedBy: updatedBy,
        createdAt: new Date(),
      };
      activityTimelineEntry.description = `${activityTimelineEntry.description}. Note: ${dto.notes}`;
    }

    const updateOps: UpdateQuery<LeadDocument> = {
      $set: setUpdate,
      $push: pushUpdate,
    };

    const updated = await this.leadModel
      .findOneAndUpdate(identityFilter, updateOps, {
        new: true,
      })
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

  async convertLead(leadId: string, dto: ConvertLeadDto, user?: RequestUser) {
    const identityFilter = this.buildLeadIdentityFilter(leadId);
    const lead = await this.leadModel.findOne(identityFilter).exec();
    if (!lead) {
      throw new NotFoundException({
        success: false,
        message: 'Lead not found',
      });
    }
    if (typeof lead.sellerId === 'string' && lead.sellerId.trim().length > 0) {
      throw new BadRequestException({
        success: false,
        message: 'Seller already created for this lead',
      });
    }
    if (!lead.leadId) {
      lead.leadId = await this.getNextLeadId(
        this.toDate((lead as unknown as { createdAt?: unknown }).createdAt),
      );
    }
    if (!(lead as unknown as { publicId?: string }).publicId) {
      (lead as unknown as { publicId?: string }).publicId = generatePublicId(
        'lead',
        (lead as unknown as { email?: string }).email ?? '',
      );
    }
    if (lead.isModified()) {
      await lead.save();
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
    const subscriptionId = this.generateSubscriptionId();
    const leadCreatedAt = (lead as unknown as { createdAt?: Date }).createdAt;
    const leadEmail = typeof lead.email === 'string' ? lead.email.trim() : '';
    const leadContactNumber =
      typeof lead.contactNumber === 'string' ? lead.contactNumber.trim() : '';
    const leadGstNumber =
      typeof lead.gstNumber === 'string' ? lead.gstNumber.trim() : '';

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

    lead.subscriptionConfig = {
      gstSlots,
      durationYears,
      amount,
      updatedAt: new Date(),
      updatedBy: user?.email || 'sales_manager',
    };

    (
      lead as unknown as { conversionRequestedAt?: Date }
    ).conversionRequestedAt = paymentCompletedAt;
    (
      lead as unknown as { conversionRequestedBy?: string }
    ).conversionRequestedBy = user?.email || 'system';
    (
      lead as unknown as { conversionSubscriptionId?: string }
    ).conversionSubscriptionId = subscriptionId;
    (lead as unknown as { conversionAmount?: number }).conversionAmount =
      amount;
    (
      lead as unknown as { conversionLeadCreatedAt?: Date }
    ).conversionLeadCreatedAt = leadCreatedAt;

    await lead.save();

    const salesManagerEmail =
      typeof user?.email === 'string' ? user.email.toLowerCase() : '';

    const seller = await this.sellerModel.create({
      publicId: generatePublicId('seller', leadEmail.toLowerCase()),
      fullName: lead.fullName,
      contactNumber: leadContactNumber,
      email: leadEmail.toLowerCase(),
      gstNumber: leadGstNumber,
      leadId: lead.leadId || lead._id.toString(),
      gstSlots,
      gstSlotsPurchased: gstSlots,
      gstSlotsUsed: 0,
      durationYears,
      subscriptionDuration: durationYears,
      amount,
      subscriptionId,
      onboardingStatus: 'payment_completed',
      paymentStatus: 'payment_completed',
      paymentDate: paymentCompletedAt,
      paymentCompletedAt,
      paymentCompletedBy: salesManagerEmail || 'sales_manager',
      paymentAmount: amount,
      paymentId: '',
      transactionId: '',
      username: '',
      trainingStatus: '',
      salesManager: salesManagerEmail,
      firmName: '',
      city: '',
      state: '',
      salesNotes: '',
      verificationNotes: '',
      credentialGeneratedBy: '',
      businessType: lead.businessType || '',
      leadSource: lead.source || '',
      leadCreatedAt: leadCreatedAt || new Date(),
      leadContactedAt: undefined,
      leadConvertedAt: paymentCompletedAt,
      leadConvertedBy: salesManagerEmail || 'sales_manager',
      leadCreatedBy: lead.createdBy || '',
      leadContactedBy: '',
      paymentLinkGeneratedBy: lead.paymentDetails?.generatedBy || '',
      accountCreatedBy: '',
      adminApprovalRequestedBy: '',
    });

    lead.sellerId = String((seller as unknown as { _id: unknown })._id);
    await lead.save();

    await this.notificationsService.createNotification({
      event: 'lead_converted',
      recipientRole: 'operations_admin', // Notify ops/accounts
      message: `Lead ${lead.fullName} converted to seller ${seller.id}. Payment marked as completed.`,
    });

    await this.notificationsService.createNotification({
      event: 'lead_conversion_requested',
      recipientRole: 'accounts_manager',
      message: `New conversion request: ${lead.fullName} (Lead ID: ${lead.leadId}). Payment marked completed.`,
    });

    return {
      success: true,
      data: {
        leadId: lead.leadId,
        sellerId: seller._id.toString(),
        amount,
        paymentCompletedAt,
      },
    };
  }

  private generateSubscriptionId() {
    const date = new Date();
    const y = date.getFullYear().toString();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `SUB-${y}${m}${d}-${rand}`;
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
