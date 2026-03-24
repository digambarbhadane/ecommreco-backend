import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types, UpdateQuery } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { generatePublicId } from '../common/public-id';
import { CreateLeadDto } from './dto/create-lead.dto';
import { CreateManualLeadDto } from './dto/create-manual-lead.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { ImportLeadsDto } from './dto/import-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
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
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
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

  private normalizeEmail(value: unknown) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  private async resolveSalesManager(params: {
    id?: string;
    email?: string;
  }): Promise<{ id: string; email: string; fullName?: string } | undefined> {
    const byId =
      typeof params.id === 'string' && params.id.trim() ? params.id.trim() : '';
    const byEmail = this.normalizeEmail(params.email);
    if (!byId && !byEmail) return undefined;

    const filter: Record<string, unknown> = { role: 'sales_manager' };
    if (byId && Types.ObjectId.isValid(byId)) {
      filter._id = new Types.ObjectId(byId);
    } else if (byEmail) {
      filter.email = byEmail;
    } else {
      return undefined;
    }

    const found = await this.userModel
      .findOne(filter)
      .select('_id email fullName status role')
      .lean<{
        _id: Types.ObjectId;
        email: string;
        fullName?: string;
        status?: string;
      }>()
      .exec();
    if (!found) return undefined;
    if (found.status && found.status !== 'approved') return undefined;

    return {
      id: found._id.toString(),
      email: this.normalizeEmail(found.email),
      fullName: found.fullName,
    };
  }

  private async pickNextSalesManager() {
    const salesManagers = await this.userModel
      .find({ role: 'sales_manager', status: 'approved' })
      .select('email fullName createdAt')
      .sort({ createdAt: 1, _id: 1 })
      .lean<
        Array<{
          _id: Types.ObjectId;
          email?: string;
          fullName?: string;
        }>
      >()
      .exec();

    const candidates = salesManagers
      .map((u) => {
        const email = this.normalizeEmail(u.email);
        if (!email) return undefined;
        return { id: u._id.toString(), email };
      })
      .filter((v): v is { id: string; email: string } => Boolean(v));

    if (candidates.length === 0) {
      return undefined;
    }

    const counter = await this.counterModel.findOneAndUpdate(
      { id: 'leadAssign:sales_manager' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    const seq = typeof counter.seq === 'number' ? counter.seq : 1;
    const index = (seq - 1) % candidates.length;
    return candidates[index];
  }

  private buildSalesManagerLeadAccessFilter(user?: RequestUser) {
    const role = typeof user?.role === 'string' ? user.role : undefined;
    if (role !== 'sales_manager') return undefined;
    const identifiers = this.getSalesManagerIdentifiers(user);
    const userId =
      typeof user?.id === 'string' && user.id.trim() ? user.id.trim() : '';
    const hasUserId = userId && Types.ObjectId.isValid(userId);
    if (!identifiers.length && !hasUserId) return undefined;

    return {
      $or: [
        ...(hasUserId ? [{ assignedSalesManagerId: userId }] : []),
        ...(identifiers.length
          ? [{ assignedSalesManager: { $in: identifiers } }]
          : []),
        {
          $and: [
            { creatorRole: 'sales_manager' },
            ...(hasUserId ? [{ createdByUserId: userId }] : []),
            ...(identifiers.length
              ? [{ createdBy: { $in: identifiers } }]
              : []),
          ],
        },
      ],
    };
  }

  private buildLeadIdentityFilter(id: string) {
    const filters: Array<Record<string, unknown>> = [
      { leadId: id },
      { publicId: id },
    ];
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

  async bulkAssignLeadsToSalesManager(params: {
    leadIds: string[];
    salesManagerId: string;
    user?: RequestUser;
  }) {
    const leadIds = Array.from(
      new Set(
        (Array.isArray(params.leadIds) ? params.leadIds : [])
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter(Boolean),
      ),
    );

    if (!leadIds.length) {
      throw new BadRequestException('leadIds is required');
    }

    const salesManagerId =
      typeof params.salesManagerId === 'string'
        ? params.salesManagerId.trim()
        : '';
    if (!salesManagerId) {
      throw new BadRequestException('salesManagerId is required');
    }

    const salesManager = await this.resolveSalesManager({ id: salesManagerId });
    if (!salesManager) {
      throw new BadRequestException('Sales manager not found');
    }

    const actorEmail = this.normalizeEmail(params.user?.email);
    const actorName =
      typeof params.user?.fullName === 'string' && params.user.fullName.trim()
        ? params.user.fullName.trim()
        : typeof params.user?.username === 'string' &&
            params.user.username.trim()
          ? params.user.username.trim()
          : typeof params.user?.name === 'string' && params.user.name.trim()
            ? params.user.name.trim()
            : '';
    const performedBy = actorEmail || actorName || 'super_admin';

    const now = new Date();
    const orFilters: Array<Record<string, unknown>> = [];
    for (const id of leadIds) {
      orFilters.push({ leadId: id });
      if (id.length === 24 && Types.ObjectId.isValid(id)) {
        orFilters.push({ _id: new Types.ObjectId(id) });
      }
    }

    const result = await this.leadModel.updateMany(
      { $or: orFilters },
      {
        $set: {
          assignedSalesManager: salesManager.email,
          assignedSalesManagerId: salesManager.id,
          assignedBy: performedBy,
          assignedAt: now,
        },
        $push: {
          activityTimeline: {
            action: 'lead_assigned',
            description: `Lead assigned to ${salesManager.email}`,
            performedBy,
            timestamp: now,
            metadata: {
              assignedSalesManager: salesManager.email,
              assignedSalesManagerId: salesManager.id,
            },
          },
        },
      },
    );

    return {
      success: true,
      data: {
        matchedCount: result.matchedCount ?? 0,
        modifiedCount: result.modifiedCount ?? 0,
      },
    };
  }

  async listFollowUps(params: {
    page: number;
    limit: number;
    leadId?: string;
    status?: string;
    search?: string;
    user?: RequestUser;
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

    const salesFilter = this.buildSalesManagerLeadAccessFilter(params.user);
    const leadMatch = salesFilter
      ? ({ $and: [matchStage, salesFilter] } as Record<string, unknown>)
      : matchStage;

    const followUpMatch: Record<string, unknown> = {};
    if (params.status && params.status !== 'all') {
      followUpMatch['followUps.status'] = params.status;
    } else if (!params.status) {
      // Default to showing only pending (which includes overdue)
      followUpMatch['followUps.status'] = 'pending';
    }

    const search =
      typeof params.search === 'string' ? params.search.trim() : '';
    const hasSearch = search.length > 0;

    const pipeline: PipelineStage[] = [
      { $match: leadMatch as PipelineStage.Match['$match'] },
      { $unwind: '$followUps' },
      { $match: followUpMatch as PipelineStage.Match['$match'] },
      {
        $addFields: {
          scheduledAtText: {
            $dateToString: {
              format: '%Y-%m-%d %H:%M',
              date: '$followUps.scheduledAt',
              timezone: 'UTC',
            },
          },
        },
      },
      ...(hasSearch
        ? [
            {
              $match: {
                $or: [
                  { leadId: { $regex: search, $options: 'i' } },
                  { fullName: { $regex: search, $options: 'i' } },
                  { 'followUps.notes': { $regex: search, $options: 'i' } },
                  { 'followUps.status': { $regex: search, $options: 'i' } },
                  { scheduledAtText: { $regex: search, $options: 'i' } },
                  ...(Types.ObjectId.isValid(search)
                    ? [{ _id: new Types.ObjectId(search) }]
                    : []),
                ],
              } as PipelineStage.Match['$match'],
            },
          ]
        : []),
      { $sort: { 'followUps.scheduledAt': -1 } },
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
      { $match: leadMatch as PipelineStage.Match['$match'] },
      { $unwind: '$followUps' },
      { $match: followUpMatch as PipelineStage.Match['$match'] },
      {
        $addFields: {
          scheduledAtText: {
            $dateToString: {
              format: '%Y-%m-%d %H:%M',
              date: '$followUps.scheduledAt',
              timezone: 'UTC',
            },
          },
        },
      },
      ...(hasSearch
        ? [
            {
              $match: {
                $or: [
                  { leadId: { $regex: search, $options: 'i' } },
                  { fullName: { $regex: search, $options: 'i' } },
                  { 'followUps.notes': { $regex: search, $options: 'i' } },
                  { 'followUps.status': { $regex: search, $options: 'i' } },
                  { scheduledAtText: { $regex: search, $options: 'i' } },
                  ...(Types.ObjectId.isValid(search)
                    ? [{ _id: new Types.ObjectId(search) }]
                    : []),
                ],
              } as PipelineStage.Match['$match'],
            },
          ]
        : []),
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

    if (!Types.ObjectId.isValid(followUpId)) {
      throw new BadRequestException('Invalid Follow-up ID');
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

  async listNotes(params: {
    page: number;
    limit: number;
    leadId?: string;
    search?: string;
    user?: RequestUser;
  }) {
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

    const salesFilter = this.buildSalesManagerLeadAccessFilter(params.user);
    const leadMatch = salesFilter
      ? ({ $and: [matchStage, salesFilter] } as Record<string, unknown>)
      : matchStage;

    const search =
      typeof params.search === 'string' ? params.search.trim() : '';
    const hasSearch = search.length > 0;

    const pipeline: PipelineStage[] = [
      { $match: leadMatch as PipelineStage.Match['$match'] },
      { $unwind: '$notes' },
      {
        $addFields: {
          createdAtText: {
            $dateToString: {
              format: '%Y-%m-%d %H:%M',
              date: '$notes.createdAt',
              timezone: 'UTC',
            },
          },
        },
      },
      ...(hasSearch
        ? [
            {
              $match: {
                $or: [
                  { leadId: { $regex: search, $options: 'i' } },
                  { fullName: { $regex: search, $options: 'i' } },
                  { 'notes.addedBy': { $regex: search, $options: 'i' } },
                  { 'notes.content': { $regex: search, $options: 'i' } },
                  { createdAtText: { $regex: search, $options: 'i' } },
                  ...(Types.ObjectId.isValid(search)
                    ? [{ _id: new Types.ObjectId(search) }]
                    : []),
                ],
              } as PipelineStage.Match['$match'],
            },
          ]
        : []),
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
      { $match: leadMatch as PipelineStage.Match['$match'] },
      { $unwind: '$notes' },
      {
        $addFields: {
          createdAtText: {
            $dateToString: {
              format: '%Y-%m-%d %H:%M',
              date: '$notes.createdAt',
              timezone: 'UTC',
            },
          },
        },
      },
      ...(hasSearch
        ? [
            {
              $match: {
                $or: [
                  { leadId: { $regex: search, $options: 'i' } },
                  { fullName: { $regex: search, $options: 'i' } },
                  { 'notes.addedBy': { $regex: search, $options: 'i' } },
                  { 'notes.content': { $regex: search, $options: 'i' } },
                  { createdAtText: { $regex: search, $options: 'i' } },
                  ...(Types.ObjectId.isValid(search)
                    ? [{ _id: new Types.ObjectId(search) }]
                    : []),
                ],
              } as PipelineStage.Match['$match'],
            },
          ]
        : []),
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

  async createManualLead(dto: CreateManualLeadDto, user?: RequestUser) {
    const creatorRole = typeof user?.role === 'string' ? user.role : 'admin';
    const requesterEmail = this.normalizeEmail(user?.email);
    const requesterId =
      typeof user?.id === 'string' && user.id.trim() ? user.id.trim() : '';
    const createdBy =
      creatorRole === 'sales_manager' || creatorRole === 'super_admin'
        ? requesterEmail || user?.username || user?.fullName || 'admin'
        : user?.fullName || user?.username || requesterEmail || 'admin';

    // 1. Check for duplicates (Lead & Seller)
    await this.checkDuplicates(dto as CreateLeadDto);

    // 2. Calculate Lead Score
    const leadScore = this.calculateLeadScore(dto as CreateLeadDto);

    // 3. Generate Lead ID
    const leadId = await this.getNextLeadId();

    // 4. Create Lead
    const explicitAssignee = await this.resolveSalesManager({
      id: (dto as unknown as { assignedSalesManagerId?: string })
        .assignedSalesManagerId,
      email: (dto as unknown as { assignedSalesManagerEmail?: string })
        .assignedSalesManagerEmail,
    });

    const autoAssignee = await this.pickNextSalesManager();

    const assigned =
      creatorRole === 'sales_manager' && requesterEmail
        ? { id: requesterId, email: requesterEmail }
        : (explicitAssignee ?? autoAssignee);

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
      createdByUserId: requesterId || undefined,
      assignedSalesManager: assigned?.email,
      assignedSalesManagerId: assigned?.id,
      assignedBy: requesterEmail || createdBy,
      assignedAt: assigned ? new Date() : undefined,
      metadata: {
        createdBy,
        creatorRole,
        createdAt: new Date(),
        ...(dto.metadata ?? {}),
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
    // 1. Check for duplicates (Lead & Seller)
    await this.checkDuplicates(dto);

    // 2. Check Cooldown (IP based)
    if (ipAddress) {
      await this.checkIpCooldown(ipAddress);
    }

    // 3. Calculate Lead Score
    const leadScore = this.calculateLeadScore(dto);

    // 4. Generate Lead ID
    const leadId = await this.getNextLeadId();

    // 5. Create Lead
    const assigned = await this.pickNextSalesManager();

    const created = await this.leadModel.create({
      ...dto,
      publicId: generatePublicId('lead', dto.email),
      leadId,
      source,
      leadStatus: 'new',
      createdBy: dto.fullName,
      creatorRole: 'seller',
      assignedSalesManager: assigned?.email,
      assignedSalesManagerId: assigned?.id,
      assignedBy: assigned ? 'system' : undefined,
      assignedAt: assigned ? new Date() : undefined,
      ipAddress,
      userAgent,
      leadScore,
      isMobileVerified: false,
      verificationMethod: 'manual',
      metadata: {
        termsAccepted: dto.termsAccepted,
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

  async importLeads(dto: ImportLeadsDto, user?: RequestUser) {
    const requesterEmail = this.normalizeEmail(user?.email);
    const requesterId =
      typeof user?.id === 'string' && user.id.trim() ? user.id.trim() : '';

    const leads = Array.isArray(dto.leads) ? dto.leads : [];
    if (!leads.length) {
      throw new BadRequestException('No leads provided');
    }
    if (leads.length > 20000) {
      throw new BadRequestException(
        'Maximum 20000 leads are allowed per request',
      );
    }

    const mode = dto.assignmentMode ?? 'auto';
    const selectedIds = Array.isArray(dto.salesManagerIds)
      ? dto.salesManagerIds.filter((id) => typeof id === 'string' && id.trim())
      : [];

    let resolvedSelected: Array<{ id: string; email: string }> = [];
    if (mode === 'round_robin_selected' || mode === 'random_selected') {
      const unique = Array.from(new Set(selectedIds));
      const found = await this.userModel
        .find({
          _id: { $in: unique.filter((id) => Types.ObjectId.isValid(id)) },
          role: 'sales_manager',
          status: 'approved',
        })
        .select('_id email')
        .lean<Array<{ _id: Types.ObjectId; email: string }>>()
        .exec();
      resolvedSelected = found
        .map((u) => ({
          id: u._id.toString(),
          email: this.normalizeEmail(u.email),
        }))
        .filter((u) => u.email.length > 0);
      if (!resolvedSelected.length) {
        throw new BadRequestException('No valid sales managers selected');
      }
    }

    let rrStart = 0;
    if (mode === 'round_robin_selected') {
      const counter = await this.counterModel.findOneAndUpdate(
        { id: 'leadAssign:sales_manager:selected' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
      );
      const seq = typeof counter.seq === 'number' ? counter.seq : 1;
      rrStart = (seq - 1) % resolvedSelected.length;
    }

    const created: Array<Lead> = [];
    const skipped: Array<{ index: number; reason: string }> = [];
    const failed: Array<{ index: number; reason: string }> = [];

    const normalizeContactNumber = (value: unknown) => {
      const raw =
        typeof value === 'string'
          ? value
          : typeof value === 'number'
            ? String(value)
            : typeof value === 'bigint'
              ? value.toString()
              : '';
      const digits = raw.trim().replace(/\D/g, '');
      if (digits.length === 12 && digits.startsWith('91'))
        return digits.slice(2);
      if (digits.length === 11 && digits.startsWith('0'))
        return digits.slice(1);
      return digits;
    };

    const toOptionalTrimmedString = (value: unknown) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number') return String(value).trim();
      return '';
    };

    const normalizePipelineStage = (value: unknown) => {
      const next = toOptionalTrimmedString(value);
      if (!next) return '';
      const allowed = new Set([
        'New Lead',
        'Contacted',
        'Interested',
        'Payment Link Generated',
        'Payment Pending',
        'Payment Completed',
        'Converted to Seller',
      ]);
      if (allowed.has(next)) return next;
      return '';
    };

    const assigneeIds = new Set<string>();
    const assigneeEmails = new Set<string>();
    for (let i = 0; i < leads.length; i += 1) {
      const row = leads[i] as unknown as {
        assignedSalesManagerId?: unknown;
        assignedSalesManagerEmail?: unknown;
      };
      const id =
        typeof row.assignedSalesManagerId === 'string'
          ? row.assignedSalesManagerId.trim()
          : '';
      const email = this.normalizeEmail(row.assignedSalesManagerEmail);
      if (id) assigneeIds.add(id);
      if (email) assigneeEmails.add(email);
    }

    const validAssigneeIds = Array.from(assigneeIds).filter((id) =>
      Types.ObjectId.isValid(id),
    );
    const validAssigneeEmails = Array.from(assigneeEmails);

    const assignees =
      validAssigneeIds.length || validAssigneeEmails.length
        ? await this.userModel
            .find({
              role: 'sales_manager',
              status: 'approved',
              $or: [
                ...(validAssigneeIds.length
                  ? [
                      {
                        _id: {
                          $in: validAssigneeIds.map(
                            (id) => new Types.ObjectId(id),
                          ),
                        },
                      },
                    ]
                  : []),
                ...(validAssigneeEmails.length
                  ? [{ email: { $in: validAssigneeEmails } }]
                  : []),
              ],
            })
            .select('_id email')
            .lean<Array<{ _id: Types.ObjectId; email: string }>>()
            .exec()
        : [];

    const assigneeById = new Map<string, { id: string; email: string }>();
    const assigneeByEmail = new Map<string, { id: string; email: string }>();
    for (const a of assignees) {
      const email = this.normalizeEmail(a.email);
      if (!email) continue;
      const id = a._id.toString();
      assigneeById.set(id, { id, email });
      assigneeByEmail.set(email, { id, email });
    }

    const autoCandidates =
      mode === 'auto'
        ? await this.userModel
            .find({ role: 'sales_manager', status: 'approved' })
            .select('email createdAt')
            .sort({ createdAt: 1, _id: 1 })
            .lean<Array<{ _id: Types.ObjectId; email?: string }>>()
            .exec()
        : [];

    const normalizedAutoCandidates =
      mode === 'auto'
        ? autoCandidates
            .map((u) => {
              const email = this.normalizeEmail(u.email);
              if (!email) return undefined;
              return { id: u._id.toString(), email };
            })
            .filter((v): v is { id: string; email: string } => Boolean(v))
        : [];

    const selectedSingle =
      mode === 'specific' && selectedIds.length === 1
        ? await this.resolveSalesManager({ id: selectedIds[0] })
        : undefined;

    type PreparedLead = {
      index: number;
      fullName: string;
      email: string;
      contactNumber: string;
      gstNumber: string;
      source: string;
      firmName?: string;
      city?: string;
      state?: string;
      businessType?: string;
      pipelineStage: string;
      metadata?: Record<string, unknown>;
      explicitAssignee?: { id: string; email: string };
    };

    const prepared: PreparedLead[] = [];
    for (let i = 0; i < leads.length; i += 1) {
      const row = leads[i];
      try {
        const rawContact = (row as unknown as { contactNumber?: unknown })
          .contactNumber;
        const contactNumber = normalizeContactNumber(rawContact);
        if (!/^\d{10}$/.test(contactNumber)) {
          throw new BadRequestException(
            'contactNumber must be exactly 10 digits',
          );
        }

        const fullName = (() => {
          const raw = (row as unknown as { fullName?: unknown }).fullName;
          const next =
            typeof raw === 'string'
              ? raw.trim()
              : typeof raw === 'number'
                ? String(raw).trim()
                : '';
          return next.length ? next : '';
        })();

        const email = (() => {
          const next = this.normalizeEmail(
            (row as unknown as { email?: unknown }).email,
          );
          return next.length ? next : '';
        })();

        const gstNumber = (() => {
          const raw = (row as unknown as { gstNumber?: unknown }).gstNumber;
          const next =
            typeof raw === 'string'
              ? raw.trim().toUpperCase()
              : typeof raw === 'number'
                ? String(raw).trim().toUpperCase()
                : '';
          return next.length ? next : '';
        })();

        const source = (() => {
          const raw = (row as unknown as { source?: unknown }).source;
          const next = toOptionalTrimmedString(raw);
          return next.length ? next : '';
        })();

        const firmName = (() => {
          const raw = (row as unknown as { firmName?: unknown }).firmName;
          const next = toOptionalTrimmedString(raw);
          return next.length ? next : '';
        })();

        const city = (() => {
          const raw = (row as unknown as { city?: unknown }).city;
          const next = toOptionalTrimmedString(raw);
          return next.length ? next : '';
        })();

        const state = (() => {
          const raw = (row as unknown as { state?: unknown }).state;
          const next = toOptionalTrimmedString(raw);
          return next.length ? next : '';
        })();

        const businessType = (() => {
          const raw = (row as unknown as { businessType?: unknown })
            .businessType;
          const next = toOptionalTrimmedString(raw);
          return next.length ? next : '';
        })();

        const pipelineStage = (() => {
          const raw = (row as unknown as { pipelineStage?: unknown })
            .pipelineStage;
          const next = normalizePipelineStage(raw);
          return next.length ? next : 'New Lead';
        })();

        const assignee = (() => {
          const rawId = (row as unknown as { assignedSalesManagerId?: unknown })
            .assignedSalesManagerId;
          const rawEmail = (
            row as unknown as { assignedSalesManagerEmail?: unknown }
          ).assignedSalesManagerEmail;
          const id = typeof rawId === 'string' ? rawId.trim() : '';
          const email = this.normalizeEmail(rawEmail);
          if (id && assigneeById.has(id)) return assigneeById.get(id);
          if (email && assigneeByEmail.has(email))
            return assigneeByEmail.get(email);
          return undefined;
        })();

        prepared.push({
          index: i,
          fullName,
          email,
          contactNumber,
          gstNumber,
          source,
          firmName: firmName || undefined,
          city: city || undefined,
          state: state || undefined,
          businessType: businessType || undefined,
          pipelineStage,
          metadata:
            row && typeof row === 'object'
              ? ((row as { metadata?: unknown }).metadata as
                  | Record<string, unknown>
                  | undefined)
              : undefined,
          explicitAssignee: assignee,
        });
      } catch (err: unknown) {
        let message = 'Failed to import';
        if (err instanceof BadRequestException) {
          const response = err.getResponse();
          if (typeof response === 'string') {
            message = response;
          } else if (response && typeof response === 'object') {
            const maybeMessage = (response as { message?: unknown }).message;
            if (typeof maybeMessage === 'string') {
              message = maybeMessage;
            } else if (Array.isArray(maybeMessage)) {
              const joined = maybeMessage
                .filter((m) => typeof m === 'string')
                .join(', ');
              message = joined || 'Bad Request';
            } else {
              message = 'Bad Request';
            }
          } else {
            message = 'Bad Request';
          }
        } else if (err instanceof Error) {
          message = err.message;
        }
        failed.push({ index: i, reason: message });
      }
    }

    const seenContact = new Map<string, number>();
    const seenEmail = new Map<string, number>();
    const seenGst = new Map<string, number>();
    const uniquePrepared: PreparedLead[] = [];
    for (const p of prepared) {
      const dupReason = (() => {
        if (seenContact.has(p.contactNumber)) {
          return 'Duplicate mobile number in file';
        }
        if (p.email && seenEmail.has(p.email)) {
          return 'Duplicate email in file';
        }
        if (p.gstNumber && seenGst.has(p.gstNumber)) {
          return 'Duplicate GST number in file';
        }
        return '';
      })();
      if (dupReason) {
        skipped.push({ index: p.index, reason: dupReason });
        continue;
      }
      seenContact.set(p.contactNumber, p.index);
      if (p.email) seenEmail.set(p.email, p.index);
      if (p.gstNumber) seenGst.set(p.gstNumber, p.index);
      uniquePrepared.push(p);
    }

    const emailsToCheck = Array.from(
      new Set(uniquePrepared.map((p) => p.email).filter((e) => e && e.length)),
    );
    const contactsToCheck = Array.from(
      new Set(uniquePrepared.map((p) => p.contactNumber)),
    );
    const gstsToCheck = Array.from(
      new Set(
        uniquePrepared.map((p) => p.gstNumber).filter((g) => g && g.length),
      ),
    );

    const [existingSellers, existingLeads] =
      emailsToCheck.length || contactsToCheck.length || gstsToCheck.length
        ? await Promise.all([
            this.sellerModel
              .find({
                $or: [
                  ...(emailsToCheck.length
                    ? [{ email: { $in: emailsToCheck } }]
                    : []),
                  ...(contactsToCheck.length
                    ? [{ contactNumber: { $in: contactsToCheck } }]
                    : []),
                  ...(gstsToCheck.length
                    ? [{ gstNumber: { $in: gstsToCheck } }]
                    : []),
                ],
              })
              .select('email contactNumber gstNumber')
              .lean<
                Array<{
                  email?: string;
                  contactNumber?: string;
                  gstNumber?: string;
                }>
              >()
              .exec(),
            this.leadModel
              .find({
                $or: [
                  ...(emailsToCheck.length
                    ? [{ email: { $in: emailsToCheck } }]
                    : []),
                  ...(contactsToCheck.length
                    ? [{ contactNumber: { $in: contactsToCheck } }]
                    : []),
                  ...(gstsToCheck.length
                    ? [{ gstNumber: { $in: gstsToCheck } }]
                    : []),
                ],
              })
              .select('email contactNumber gstNumber')
              .lean<
                Array<{
                  email?: string;
                  contactNumber?: string;
                  gstNumber?: string;
                }>
              >()
              .exec(),
          ])
        : [[], []];

    const existingSellerEmails = new Set<string>();
    const existingSellerContacts = new Set<string>();
    const existingSellerGsts = new Set<string>();
    for (const s of existingSellers) {
      const email = this.normalizeEmail(s.email);
      if (email) existingSellerEmails.add(email);
      const contact =
        typeof s.contactNumber === 'string' ? s.contactNumber : '';
      if (contact) existingSellerContacts.add(contact);
      const gst =
        typeof s.gstNumber === 'string' ? s.gstNumber.trim().toUpperCase() : '';
      if (gst) existingSellerGsts.add(gst);
    }

    const existingLeadEmails = new Set<string>();
    const existingLeadContacts = new Set<string>();
    const existingLeadGsts = new Set<string>();
    for (const l of existingLeads) {
      const email = this.normalizeEmail(l.email);
      if (email) existingLeadEmails.add(email);
      const contact =
        typeof l.contactNumber === 'string' ? l.contactNumber : '';
      if (contact) existingLeadContacts.add(contact);
      const gst =
        typeof l.gstNumber === 'string' ? l.gstNumber.trim().toUpperCase() : '';
      if (gst) existingLeadGsts.add(gst);
    }

    const insertable: PreparedLead[] = [];
    for (const p of uniquePrepared) {
      const sellerConflict = (() => {
        if (p.email && existingSellerEmails.has(p.email))
          return 'An account with this email already exists.';
        if (existingSellerContacts.has(p.contactNumber))
          return 'An account with this mobile number already exists.';
        if (p.gstNumber && existingSellerGsts.has(p.gstNumber))
          return 'An account with this GST number already exists.';
        return '';
      })();
      if (sellerConflict) {
        skipped.push({ index: p.index, reason: sellerConflict });
        continue;
      }

      const leadConflict = (() => {
        if (p.email && existingLeadEmails.has(p.email))
          return 'A lead with this email already exists.';
        if (existingLeadContacts.has(p.contactNumber))
          return 'A lead with this mobile number already exists.';
        if (p.gstNumber && existingLeadGsts.has(p.gstNumber))
          return 'A lead with this GST number already exists.';
        return '';
      })();
      if (leadConflict) {
        skipped.push({ index: p.index, reason: leadConflict });
        continue;
      }

      insertable.push(p);
    }

    const computeLeadIdRange = async (count: number, date = new Date()) => {
      if (count <= 0) {
        return { prefix: 'LEAD', yyyymm: '', startSeq: 0 };
      }
      const yyyy = date.getFullYear().toString();
      const mm = (date.getMonth() + 1).toString().padStart(2, '0');
      const yyyymm = `${yyyy}${mm}`;
      const prefix = 'LEAD';

      const counter = await this.counterModel.findOneAndUpdate(
        { id: `leadId:${prefix}:${yyyymm}` },
        { $inc: { seq: count } },
        { new: true, upsert: true },
      );
      const seqEndRaw = (counter as unknown as { seq?: unknown }).seq;
      const seqEnd =
        typeof seqEndRaw === 'number'
          ? seqEndRaw
          : Number.isFinite(Number(seqEndRaw))
            ? Number(seqEndRaw)
            : count;
      const startSeq = seqEnd - count + 1;
      return { prefix, yyyymm, startSeq };
    };

    const now = new Date();

    const docs: Array<Record<string, unknown>> = [];
    const docInputIndexes: number[] = [];
    const needsAutoAssignmentIndexes: number[] = [];

    for (const p of insertable) {
      let assigned: { id: string; email: string } | undefined = undefined;

      if (mode === 'specific') {
        if (p.explicitAssignee) {
          assigned = p.explicitAssignee;
        } else if (selectedSingle) {
          assigned = { id: selectedSingle.id, email: selectedSingle.email };
        } else if (resolvedSelected.length === 1) {
          assigned = resolvedSelected[0];
        }

        if (!assigned) {
          failed.push({
            index: p.index,
            reason: 'Missing assigned sales manager for this row',
          });
          continue;
        }
      } else if (mode === 'random_selected') {
        const idx = Math.floor(Math.random() * resolvedSelected.length);
        assigned = resolvedSelected[idx];
      } else if (mode === 'round_robin_selected') {
        assigned =
          resolvedSelected[(rrStart + p.index) % resolvedSelected.length];
      } else if (p.explicitAssignee) {
        assigned = p.explicitAssignee;
      }

      const leadScore = this.calculateLeadScore({
        email: p.email,
        contactNumber: p.contactNumber,
        gstNumber: p.gstNumber,
      });

      const doc: Record<string, unknown> = {
        contactNumber: p.contactNumber,
        publicId: generatePublicId('lead', p.email || ''),
        pipelineStage: p.pipelineStage,
        leadStatus: 'new',
        leadScore,
        isMobileVerified: true,
        verificationMethod: 'manual',
        createdBy: requesterEmail || 'super_admin',
        createdByUserId: requesterId || undefined,
        creatorRole: user?.role || 'super_admin',
        assignedSalesManager: assigned?.email,
        assignedSalesManagerId: assigned?.id,
        assignedBy: requesterEmail || 'super_admin',
        assignedAt: assigned ? now : undefined,
        metadata: {
          createdBy: requesterEmail || 'super_admin',
          creatorRole: user?.role || 'super_admin',
          createdAt: now,
          import: true,
          ...(p.source ? { source: p.source } : {}),
          ...(p.metadata ?? {}),
        },
        lastRegistrationAttempt: now,
        activityTimeline: [
          {
            action: 'lead_imported',
            description: `Lead imported by ${requesterEmail || 'super_admin'}`,
            performedBy: requesterEmail || 'super_admin',
            timestamp: now,
            metadata: {
              assignmentMode: mode,
              assignedSalesManager: assigned?.email,
            },
          },
        ],
        notes: [
          {
            content: `Lead imported by ${requesterEmail || 'super_admin'}.`,
            addedBy: requesterEmail || 'super_admin',
            createdAt: now,
          },
        ],
      };
      if (p.fullName) doc.fullName = p.fullName;
      if (p.email) doc.email = p.email;
      if (p.gstNumber) doc.gstNumber = p.gstNumber;
      if (p.source) doc.source = p.source;
      if (p.firmName) doc.firmName = p.firmName;
      if (p.city) doc.city = p.city;
      if (p.state) doc.state = p.state;
      if (p.businessType) doc.businessType = p.businessType;

      docs.push(doc);
      docInputIndexes.push(p.index);
      if (mode === 'auto' && !assigned) {
        needsAutoAssignmentIndexes.push(docs.length - 1);
      }
    }

    if (mode === 'auto' && needsAutoAssignmentIndexes.length) {
      if (!normalizedAutoCandidates.length) {
        for (const docIdx of needsAutoAssignmentIndexes) {
          docs[docIdx].assignedSalesManager = undefined;
          docs[docIdx].assignedSalesManagerId = undefined;
        }
      } else {
        const counter = await this.counterModel.findOneAndUpdate(
          { id: 'leadAssign:sales_manager' },
          { $inc: { seq: needsAutoAssignmentIndexes.length } },
          { new: true, upsert: true },
        );
        const seqRaw = (counter as unknown as { seq?: unknown }).seq;
        const seqEnd =
          typeof seqRaw === 'number'
            ? seqRaw
            : Number.isFinite(Number(seqRaw))
              ? Number(seqRaw)
              : needsAutoAssignmentIndexes.length;
        const start = seqEnd - needsAutoAssignmentIndexes.length + 1;

        for (let j = 0; j < needsAutoAssignmentIndexes.length; j += 1) {
          const docIdx = needsAutoAssignmentIndexes[j];
          const candidateIndex =
            (start - 1 + j) % normalizedAutoCandidates.length;
          const candidate = normalizedAutoCandidates[candidateIndex];
          docs[docIdx].assignedSalesManager = candidate.email;
          docs[docIdx].assignedSalesManagerId = candidate.id;
          docs[docIdx].assignedAt = now;
        }
      }
    }

    const leadIdRange = await computeLeadIdRange(docs.length, now);
    if (docs.length) {
      for (let i = 0; i < docs.length; i += 1) {
        const seq = leadIdRange.startSeq + i;
        const padded = String(seq).padStart(4, '0');
        docs[i].leadId =
          `${leadIdRange.prefix}-${leadIdRange.yyyymm}-${padded}`;
      }
    }

    let insertedDocs: Array<unknown> = [];
    try {
      insertedDocs = await this.leadModel.insertMany(docs, { ordered: false });
    } catch (err: unknown) {
      const maybe = err as {
        insertedDocs?: unknown[];
        writeErrors?: Array<{ index?: number; code?: number; errmsg?: string }>;
        message?: string;
      };
      if (Array.isArray(maybe.insertedDocs)) {
        insertedDocs = maybe.insertedDocs;
      }

      const writeErrors = Array.isArray(maybe.writeErrors)
        ? maybe.writeErrors
        : [];
      for (const we of writeErrors) {
        const docIdx = typeof we.index === 'number' ? we.index : -1;
        const inputIndex =
          docIdx >= 0 && docIdx < docInputIndexes.length
            ? docInputIndexes[docIdx]
            : undefined;
        if (inputIndex === undefined) continue;

        if (we.code === 11000) {
          skipped.push({
            index: inputIndex,
            reason: 'Duplicate details found.',
          });
        } else {
          failed.push({
            index: inputIndex,
            reason:
              typeof we.errmsg === 'string' && we.errmsg.trim().length
                ? we.errmsg
                : 'Failed to import',
          });
        }
      }

      if (!writeErrors.length) {
        for (const docIdx of docInputIndexes) {
          failed.push({
            index: docIdx,
            reason:
              typeof maybe.message === 'string' && maybe.message.trim().length
                ? maybe.message
                : 'Failed to import',
          });
        }
      }
    }

    const maxCreatedToReturn = 200;
    const limitedInserted = Array.isArray(insertedDocs)
      ? insertedDocs.slice(0, maxCreatedToReturn)
      : [];
    for (const doc of limitedInserted) {
      const obj =
        doc && typeof doc === 'object' && 'toObject' in doc
          ? (doc as { toObject: () => unknown }).toObject()
          : doc;
      created.push(obj as Lead);
    }

    return {
      success: true,
      data: {
        createdCount: Array.isArray(insertedDocs)
          ? insertedDocs.length
          : created.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
        created,
        skipped,
        failed,
      },
    };
  }

  private async checkDuplicates(
    dto: Pick<CreateLeadDto, 'email' | 'contactNumber' | 'gstNumber'>,
  ) {
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

  private calculateLeadScore(
    dto: Pick<CreateLeadDto, 'email' | 'contactNumber' | 'gstNumber'>,
  ): number {
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
    params: {
      status?: string;
      limit?: number;
      skip?: number;
      page?: number;
      search?: string;
    },
    user?: RequestUser,
  ) {
    const limit = Math.max(1, params.limit ?? 10);
    const skip =
      typeof params.page === 'number' && params.page > 0
        ? (params.page - 1) * limit
        : Math.max(0, params.skip ?? 0);
    const filter: Record<string, unknown> = {};
    if (params.status) {
      filter.leadStatus = params.status;
    }
    const salesFilter = this.buildSalesManagerLeadAccessFilter(user);
    if (salesFilter) {
      Object.assign(filter, salesFilter);
    }
    const search =
      typeof params.search === 'string' ? params.search.trim() : '';
    const hasSearch = search.length > 0;
    const searchOrFilters: Array<Record<string, unknown>> = [];
    if (hasSearch) {
      searchOrFilters.push(
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { contactNumber: { $regex: search, $options: 'i' } },
        { gstNumber: { $regex: search, $options: 'i' } },
        { leadId: { $regex: search, $options: 'i' } },
        { publicId: { $regex: search, $options: 'i' } },
      );
      if (Types.ObjectId.isValid(search)) {
        searchOrFilters.unshift({ _id: new Types.ObjectId(search) });
      }
    }
    const searchFilter: Record<string, unknown> =
      hasSearch && searchOrFilters.length ? { $or: searchOrFilters } : {};
    const data = await this.leadModel
      .find(hasSearch ? { $and: [filter, searchFilter] } : filter)
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

    const total = await this.leadModel.countDocuments(
      hasSearch ? { $and: [filter, searchFilter] } : filter,
    );
    return {
      success: true,
      data,
      total,
      limit,
      skip,
    };
  }

  async updateLeadDetails(id: string, dto: UpdateLeadDto, updatedBy: string) {
    const identityFilter = this.buildLeadIdentityFilter(id);
    const setUpdate: UpdateQuery<Lead>['$set'] = {};
    const allowedKeys: Array<keyof UpdateLeadDto> = [
      'fullName',
      'email',
      'contactNumber',
      'gstNumber',
      'gstNumbers',
      'gstCount',
      'marketplaces',
      'firmName',
      'city',
      'state',
      'businessType',
      'source',
    ];
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(dto, key)) {
        // Allow clearing to empty string; set undefined removes key
        const value = (dto as Record<string, unknown>)[key];
        (setUpdate as Record<string, unknown>)[key] = value;
      }
    }
    if (Object.keys(setUpdate).length === 0) {
      return this.getLead(id);
    }
    const updated = await this.leadModel.findOneAndUpdate(
      identityFilter,
      {
        $set: setUpdate,
        $push: {
          activityTimeline: {
            action: 'lead_updated',
            description: 'Lead details updated',
            performedBy: updatedBy,
            timestamp: new Date(),
            metadata: Object.keys(setUpdate),
          },
        },
      },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException('Lead not found');
    }
    return { success: true, data: updated };
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

  async deleteLead(id: string, user?: RequestUser) {
    const role = typeof user?.role === 'string' ? user.role : undefined;
    if (role !== 'super_admin') {
      throw new ForbiddenException({
        success: false,
        message: 'Access denied',
      });
    }

    const identityFilter = this.buildLeadIdentityFilter(id);
    const lead = await this.leadModel
      .findOne(identityFilter)
      .select('_id sellerId leadId publicId')
      .lean()
      .exec();

    if (!lead) {
      throw new NotFoundException({
        success: false,
        message: 'Lead not found',
      });
    }

    const sellerId =
      typeof (lead as unknown as { sellerId?: unknown }).sellerId === 'string'
        ? String((lead as unknown as { sellerId?: string }).sellerId).trim()
        : '';

    if (sellerId) {
      throw new BadRequestException({
        success: false,
        message: 'Cannot delete a lead that already has a seller',
      });
    }

    await this.leadModel.deleteOne({ _id: (lead as unknown as { _id: unknown })._id }).exec();

    return { success: true, data: { deleted: true } };
  }

  async addNote(id: string, content: string, addedBy: string) {
    const identityFilter = this.buildLeadIdentityFilter(id);
    // Check if notes is an array, if not (e.g. string or null), reset it to empty array
    const existing = await this.leadModel
      .findOne(identityFilter)
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

  async updateNote(
    id: string,
    noteId: string,
    content: string,
    updatedBy: string,
  ) {
    const identityFilter = this.buildLeadIdentityFilter(id);
    const updated = await this.leadModel.findOneAndUpdate(
      identityFilter,
      {
        $set: { 'notes.$[n].content': content },
        $push: {
          activityTimeline: {
            action: 'note_updated',
            description: 'Note updated',
            performedBy: updatedBy,
            timestamp: new Date(),
          },
        },
      },
      {
        arrayFilters: [{ 'n._id': new Types.ObjectId(noteId) }],
        new: true,
      },
    );
    return { success: true, data: updated };
  }

  async deleteNote(id: string, noteId: string, deletedBy: string) {
    const identityFilter = this.buildLeadIdentityFilter(id);
    const updated = await this.leadModel.findOneAndUpdate(
      identityFilter,
      {
        $pull: { notes: { _id: new Types.ObjectId(noteId) } },
        $push: {
          activityTimeline: {
            action: 'note_deleted',
            description: 'Note deleted',
            performedBy: deletedBy,
            timestamp: new Date(),
          },
        },
      },
      { new: true },
    );
    return { success: true, data: updated };
  }

  async updateFollowUp(
    id: string,
    followUpId: string,
    body: { scheduledAt?: string | Date; notes?: string },
    updatedBy: string,
  ) {
    const identityFilter = this.buildLeadIdentityFilter(id);
    const setOps: Record<string, unknown> = {};
    if (body.scheduledAt) {
      const d = new Date(body.scheduledAt);
      setOps['followUps.$[f].scheduledAt'] = d;
    }
    if (typeof body.notes === 'string') {
      setOps['followUps.$[f].notes'] = body.notes;
    }
    const updated = await this.leadModel.findOneAndUpdate(
      identityFilter,
      {
        $set: setOps,
        $push: {
          activityTimeline: {
            action: 'follow_up_updated',
            description: 'Follow-up updated',
            performedBy: updatedBy,
            timestamp: new Date(),
          },
        },
      },
      {
        arrayFilters: [{ 'f._id': new Types.ObjectId(followUpId) }],
        new: true,
      },
    );
    return { success: true, data: updated };
  }

  async deleteFollowUp(id: string, followUpId: string, deletedBy: string) {
    const identityFilter = this.buildLeadIdentityFilter(id);
    const updated = await this.leadModel.findOneAndUpdate(
      identityFilter,
      {
        $pull: { followUps: { _id: new Types.ObjectId(followUpId) } },
        $push: {
          activityTimeline: {
            action: 'follow_up_deleted',
            description: 'Follow-up deleted',
            performedBy: deletedBy,
            timestamp: new Date(),
          },
        },
      },
      { new: true },
    );
    return { success: true, data: updated };
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
      sellerEmail: typeof lead.email === 'string' ? lead.email : '',
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
      underReview: true,
      accountStatus: 'paused',
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
      message: `New conversion request: ${lead.fullName} (Seller ID: ${seller.id}). Status: under review. Payment marked completed.`,
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
