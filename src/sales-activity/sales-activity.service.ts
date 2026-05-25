import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import {
  SalesTarget,
  SalesTargetDocument,
} from './schemas/sales-target.schema';

const toISTDateKey = (date: Date) => {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 60 * 60000);
  const yyyy = ist.getFullYear();
  const mm = String(ist.getMonth() + 1).padStart(2, '0');
  const dd = String(ist.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getTodayBoundsIST = () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const istNow = new Date(utcMs + 5.5 * 60 * 60000);
  const istY = istNow.getFullYear();
  const istM = istNow.getMonth();
  const istD = istNow.getDate();
  const istMidnightUtcMs = Date.UTC(istY, istM, istD) - 5.5 * 60 * 60000;
  const start = new Date(istMidnightUtcMs);
  const end = new Date(istMidnightUtcMs + 24 * 60 * 60 * 1000 - 1);
  return { start, end, key: toISTDateKey(now) };
};

@Injectable()
export class SalesActivityService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(SalesTarget.name)
    private readonly targetModel: Model<SalesTargetDocument>,
  ) {}

  async getTodayStats(params: {
    salesManagerId: string;
    actorIdentifiers?: string[];
  }): Promise<{
    leadsGenerated: number;
    leadsContacted: number;
    leadsConnected: number;
    leadsConverted: number;
    leadsLost: number;
    followUpsScheduled: number;
    targetLeadsToContact: number;
    targetConversions: number;
    progressPercentage: number;
    activities: Array<{
      leadId: string;
      fullName?: string;
      action: string;
      description: string;
      timestamp: Date;
      status?: Lead['status'];
      leadStatus?: Lead['leadStatus'];
    }>;
  }> {
    const { salesManagerId } = params;
    if (!salesManagerId) {
      throw new BadRequestException('salesManagerId is required');
    }
    const actorIdentifiers = Array.from(
      new Set(
        (params.actorIdentifiers ?? [])
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter((v) => Boolean(v)),
      ),
    );
    const hasActorFilter = actorIdentifiers.length > 0;
    const { start, end, key } = getTodayBoundsIST();
    const timeRange = { $gte: start, $lte: end };
    const filterAssigned = {
      $or: [
        { assignedTo: salesManagerId },
        { assignedSalesManagerId: salesManagerId },
        { createdByUserId: salesManagerId },
      ],
    };

    const statusUpdatedByActor = (target: {
      status?: Lead['status'];
      leadStatus?: Lead['leadStatus'];
    }) => ({
      activityTimeline: {
        $elemMatch: {
          timestamp: timeRange,
          action: 'status_updated',
          performedBy: { $in: actorIdentifiers },
          $or: [
            ...(target.status
              ? [{ 'metadata.newStatus': target.status } as const]
              : []),
            ...(target.leadStatus
              ? [{ 'metadata.newLeadStatus': target.leadStatus } as const]
              : []),
          ],
        },
      },
    });
    const [
      leadsGenerated,
      leadsContacted,
      leadsConnected,
      leadsConverted,
      leadsLost,
      followUpsScheduled,
    ] = await Promise.all([
      this.leadModel.countDocuments({
        ...filterAssigned,
        createdAt: timeRange,
      }),
      hasActorFilter
        ? this.leadModel.countDocuments(
            statusUpdatedByActor({
              status: 'CONTACTED',
              leadStatus: 'contacted',
            }),
          )
        : this.leadModel.countDocuments({
            ...filterAssigned,
            $or: [
              { lastContactedAt: timeRange },
              {
                activityTimeline: {
                  $elemMatch: {
                    timestamp: timeRange,
                    'metadata.newStatus': 'CONTACTED',
                  },
                },
              },
              {
                activityTimeline: {
                  $elemMatch: {
                    timestamp: timeRange,
                    'metadata.newLeadStatus': 'contacted',
                  },
                },
              },
            ],
          }),
      hasActorFilter
        ? this.leadModel.countDocuments(
            statusUpdatedByActor({
              status: 'CONNECTED',
              leadStatus: 'interested',
            }),
          )
        : this.leadModel.countDocuments({
            ...filterAssigned,
            $or: [
              { lastConnectedAt: timeRange },
              {
                activityTimeline: {
                  $elemMatch: {
                    timestamp: timeRange,
                    'metadata.newStatus': 'CONNECTED',
                  },
                },
              },
              {
                activityTimeline: {
                  $elemMatch: {
                    timestamp: timeRange,
                    'metadata.newLeadStatus': 'interested',
                  },
                },
              },
            ],
          }),
      hasActorFilter
        ? this.leadModel.countDocuments({
            $or: [
              statusUpdatedByActor({
                status: 'CONVERTED',
                leadStatus: 'converted',
              }),
              {
                conversionRequestedAt: timeRange,
                conversionRequestedBy: { $in: actorIdentifiers },
              },
              {
                conversionRequestedAt: timeRange,
                'subscriptionConfig.updatedBy': { $in: actorIdentifiers },
              },
            ],
          })
        : this.leadModel.countDocuments({
            ...filterAssigned,
            $or: [
              { convertedAt: timeRange },
              {
                conversionRequestedAt: timeRange,
              },
              {
                activityTimeline: {
                  $elemMatch: {
                    timestamp: timeRange,
                    'metadata.newStatus': 'CONVERTED',
                  },
                },
              },
              {
                activityTimeline: {
                  $elemMatch: {
                    timestamp: timeRange,
                    'metadata.newLeadStatus': 'converted',
                  },
                },
              },
            ],
          }),
      hasActorFilter
        ? this.leadModel.countDocuments(
            statusUpdatedByActor({ status: 'LOST', leadStatus: 'rejected' }),
          )
        : this.leadModel.countDocuments({
            ...filterAssigned,
            $or: [
              {
                activityTimeline: {
                  $elemMatch: {
                    timestamp: timeRange,
                    'metadata.newStatus': 'LOST',
                  },
                },
              },
              {
                activityTimeline: {
                  $elemMatch: {
                    timestamp: timeRange,
                    'metadata.newLeadStatus': 'rejected',
                  },
                },
              },
            ],
          }),
      hasActorFilter
        ? this.leadModel.countDocuments({
            activityTimeline: {
              $elemMatch: {
                timestamp: timeRange,
                action: 'follow_up_scheduled',
                performedBy: { $in: actorIdentifiers },
              },
            },
          })
        : this.leadModel.countDocuments({
            ...filterAssigned,
            activityTimeline: {
              $elemMatch: {
                timestamp: timeRange,
                action: 'follow_up_scheduled',
              },
            },
          }),
    ]);

    const target =
      (await this.targetModel
        .findOne({ salesManagerId, date: key })
        .lean()
        .exec()) || {};
    const targetLeadsToContact =
      (target as { targetLeadsToContact?: number }).targetLeadsToContact ?? 0;
    const targetConversions =
      (target as { targetConversions?: number }).targetConversions ?? 0;
    const progressPercentage =
      targetLeadsToContact > 0
        ? Math.min(
            100,
            Math.round((leadsContacted / targetLeadsToContact) * 100),
          )
        : 0;

    const activities = await this.leadModel
      .aggregate<{
        leadId: string;
        fullName?: string;
        action: string;
        description: string;
        timestamp: Date;
        status?: Lead['status'];
        leadStatus?: Lead['leadStatus'];
      }>([
        ...(hasActorFilter ? [] : [{ $match: filterAssigned }]),
        { $unwind: '$activityTimeline' },
        {
          $match: {
            'activityTimeline.timestamp': { $gte: start, $lte: end },
            ...(hasActorFilter
              ? { 'activityTimeline.performedBy': { $in: actorIdentifiers } }
              : {}),
          },
        },
        { $sort: { 'activityTimeline.timestamp': -1 } },
        { $limit: 50 },
        {
          $project: {
            _id: 0,
            leadId: { $ifNull: ['$publicId', '$leadId'] },
            fullName: 1,
            status: {
              $switch: {
                branches: [
                  {
                    case: {
                      $eq: ['$activityTimeline.action', 'follow_up_scheduled'],
                    },
                    then: 'FOLLOW_UP',
                  },
                  {
                    case: {
                      $eq: [
                        '$activityTimeline.action',
                        'lead_created_manually',
                      ],
                    },
                    then: 'GENERATED',
                  },
                  {
                    case: {
                      $eq: [
                        '$activityTimeline.action',
                        'lead_created_by_seller',
                      ],
                    },
                    then: 'GENERATED',
                  },
                  {
                    case: {
                      $eq: ['$activityTimeline.action', 'lead_imported'],
                    },
                    then: 'GENERATED',
                  },
                  {
                    case: {
                      $eq: ['$activityTimeline.action', 'status_updated'],
                    },
                    then: {
                      $ifNull: [
                        '$activityTimeline.metadata.newStatus',
                        '$status',
                      ],
                    },
                  },
                ],
                default: '$status',
              },
            },
            leadStatus: 1,
            action: '$activityTimeline.action',
            description: '$activityTimeline.description',
            timestamp: '$activityTimeline.timestamp',
          },
        },
      ])
      .exec();

    return {
      leadsGenerated,
      leadsContacted,
      leadsConnected,
      leadsConverted,
      leadsLost,
      followUpsScheduled,
      targetLeadsToContact,
      targetConversions,
      progressPercentage,
      activities,
    };
  }

  async assignTarget(params: {
    salesManagerId: string;
    targetLeadsToContact: number;
    targetConversions: number;
    createdBy?: string;
  }) {
    const { salesManagerId, targetLeadsToContact, targetConversions } = params;
    if (!salesManagerId) {
      throw new BadRequestException('salesManagerId is required');
    }
    const dateKey = toISTDateKey(new Date());
    const saved = await this.targetModel.findOneAndUpdate(
      { salesManagerId, date: dateKey },
      {
        $set: {
          salesManagerId,
          date: dateKey,
          targetLeadsToContact: Math.max(0, Number(targetLeadsToContact || 0)),
          targetConversions: Math.max(0, Number(targetConversions || 0)),
          createdBy: params.createdBy,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return { success: true, data: saved };
  }

  async getTodayTarget(params: { salesManagerId: string }) {
    const { salesManagerId } = params;
    if (!salesManagerId) {
      throw new BadRequestException('salesManagerId is required');
    }
    const dateKey = toISTDateKey(new Date());
    const data =
      (await this.targetModel
        .findOne({ salesManagerId, date: dateKey })
        .lean()
        .exec()) || null;
    return { success: true, data };
  }
}
