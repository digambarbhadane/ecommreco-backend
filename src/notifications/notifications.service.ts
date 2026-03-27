import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async createNotification(params: {
    event: string;
    recipientRole: string;
    message: string;
  }) {
    return this.notificationModel.create({
      event: params.event,
      recipientRole: params.recipientRole,
      message: params.message,
      isRead: false,
    });
  }

  async listNotifications(params: {
    recipientRole?: string;
    limit?: number;
    skip?: number;
    search?: string;
  }) {
    const limit = Math.max(0, params.limit ?? 20);
    const skip = Math.max(0, params.skip ?? 0);

    const filter: Record<string, unknown> = {};
    if (params.recipientRole) {
      filter.recipientRole = params.recipientRole;
    }
    if (params.search) {
      const pattern = new RegExp(params.search, 'i');
      filter.$or = [{ event: pattern }, { message: pattern }];
    }

    const data = await this.notificationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    const total = await this.notificationModel.countDocuments(filter);

    return {
      success: true,
      data,
      total,
      limit,
      skip,
    };
  }

  private escapeRegex(input: string) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private extractSellerId(message: string | undefined) {
    if (typeof message !== 'string' || message.length === 0) {
      return undefined;
    }
    const match = message.match(/seller(?:Id)?[^a-f0-9]*([a-f0-9]{24})/i);
    const id = match?.[1];
    return typeof id === 'string' ? id : undefined;
  }

  private extractActorEmail(message: string | undefined) {
    if (typeof message !== 'string' || message.length === 0) {
      return undefined;
    }
    const match = message.match(
      /\bby\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i,
    );
    const email = match?.[1];
    return typeof email === 'string' ? email.toLowerCase() : undefined;
  }

  private deriveActionType(
    event: string | undefined,
    message: string | undefined,
  ) {
    const haystack = `${event ?? ''} ${message ?? ''}`.toLowerCase();
    if (haystack.includes('login') || haystack.includes('auth')) return 'LOGIN';
    if (haystack.includes('error') || haystack.includes('failed'))
      return 'ERROR';
    if (haystack.includes('update') || haystack.includes('updated'))
      return 'UPDATE';
    if (
      haystack.includes('delete') ||
      haystack.includes('deleted') ||
      haystack.includes('remove') ||
      haystack.includes('removed')
    )
      return 'DELETE';
    return 'OTHER';
  }

  private deriveModule(event: string | undefined) {
    const e = (event ?? '').toLowerCase();
    if (
      e.includes('seller') ||
      e.includes('lead') ||
      e.includes('training') ||
      e.includes('payment')
    ) {
      return 'Sellers';
    }
    if (e.includes('gst')) return 'GST';
    if (e.includes('subscription') || e.includes('billing')) return 'Billing';
    if (e.includes('marketplace') || e.includes('settings')) return 'Settings';
    if (e.includes('auth') || e.includes('login')) return 'Auth';
    return 'System';
  }

  async listActivityLogs(params: {
    role?: string;
    userId?: string;
    sellerId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const page = Math.max(1, params.page ?? 1);
    const skip = (page - 1) * limit;

    const andFilters: Array<Record<string, unknown>> = [];
    if (typeof params.role === 'string' && params.role.trim().length > 0) {
      const role = params.role.trim();
      andFilters.push({ $or: [{ userRole: role }, { recipientRole: role }] });
    }

    if (typeof params.userId === 'string' && params.userId.trim().length > 0) {
      const userId = params.userId.trim();
      andFilters.push({
        $or: [
          { userId },
          { message: new RegExp(this.escapeRegex(userId), 'i') },
        ],
      });
    }

    if (
      typeof params.sellerId === 'string' &&
      params.sellerId.trim().length > 0
    ) {
      const sellerId = params.sellerId.trim();
      andFilters.push({
        $or: [
          { sellerId },
          { message: new RegExp(this.escapeRegex(sellerId), 'i') },
        ],
      });
    }

    if (typeof params.action === 'string' && params.action.trim().length > 0) {
      const action = params.action.trim();
      const normalized = action.toLowerCase();
      if (['login', 'error', 'update', 'delete'].includes(normalized)) {
        const pattern = new RegExp(normalized, 'i');
        andFilters.push({ $or: [{ event: pattern }, { message: pattern }] });
      } else {
        andFilters.push({ event: action });
      }
    }

    const startDate =
      typeof params.startDate === 'string'
        ? new Date(params.startDate)
        : undefined;
    const endDate =
      typeof params.endDate === 'string' ? new Date(params.endDate) : undefined;
    const createdAtFilter: Record<string, Date> = {};
    if (startDate && Number.isFinite(startDate.getTime())) {
      createdAtFilter.$gte = startDate;
    }
    if (endDate && Number.isFinite(endDate.getTime())) {
      createdAtFilter.$lte = endDate;
    }
    if (Object.keys(createdAtFilter).length > 0) {
      andFilters.push({ createdAt: createdAtFilter });
    }

    const search =
      typeof params.search === 'string' ? params.search.trim() : '';
    if (search.length > 0) {
      const pattern = new RegExp(this.escapeRegex(search), 'i');
      andFilters.push({
        $or: [
          { userName: pattern },
          { userEmail: pattern },
          { sellerName: pattern },
          { message: pattern },
          { event: pattern },
          { recipientRole: pattern },
        ],
      });
    }

    const filter: Record<string, unknown> = andFilters.length
      ? { $and: andFilters }
      : {};

    const [data, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(filter),
    ]);

    const sellerIds = new Set<string>();
    const userIds = new Set<string>();
    const userEmails = new Set<string>();
    for (const entry of data) {
      const sellerId = entry.sellerId ?? this.extractSellerId(entry.message);
      if (typeof sellerId === 'string' && Types.ObjectId.isValid(sellerId)) {
        sellerIds.add(sellerId);
        entry.sellerId = sellerId;
      }
      const userId = entry.userId;
      if (typeof userId === 'string' && Types.ObjectId.isValid(userId)) {
        userIds.add(userId);
      }

      const actorEmail =
        entry.userEmail ??
        (typeof entry.userId === 'string' ? undefined : this.extractActorEmail(entry.message));
      if (typeof actorEmail === 'string' && actorEmail.length > 0) {
        entry.userEmail = actorEmail;
        userEmails.add(actorEmail);
      }
    }

    const [sellers, users, usersByEmail] = await Promise.all([
      sellerIds.size
        ? this.sellerModel
            .find({
              _id: {
                $in: Array.from(sellerIds).map((id) => new Types.ObjectId(id)),
              },
            })
            .select({ _id: 1, fullName: 1 })
            .lean()
            .exec()
        : Promise.resolve([]),
      userIds.size
        ? this.userModel
            .find({
              _id: {
                $in: Array.from(userIds).map((id) => new Types.ObjectId(id)),
              },
            })
            .select({ _id: 1, fullName: 1, email: 1, role: 1 })
            .lean()
            .exec()
        : Promise.resolve([]),
      userEmails.size
        ? this.userModel
            .find({ email: { $in: Array.from(userEmails) } })
            .select({ _id: 1, fullName: 1, email: 1, role: 1 })
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);

    const sellerNameById = new Map<string, string>();
    for (const s of sellers as Array<{ _id: unknown; fullName?: string }>) {
      const id = String(s._id);
      if (typeof s.fullName === 'string' && s.fullName.length > 0) {
        sellerNameById.set(id, s.fullName);
      }
    }

    const userById = new Map<
      string,
      { fullName?: string; email?: string; role?: string }
    >();
    for (const u of users as Array<{
      _id: unknown;
      fullName?: string;
      email?: string;
      role?: string;
    }>) {
      userById.set(String(u._id), {
        fullName: u.fullName,
        email: u.email,
        role: u.role,
      });
    }

    const userByEmail = new Map<
      string,
      { fullName?: string; email?: string; role?: string }
    >();
    for (const u of usersByEmail as Array<{
      _id: unknown;
      fullName?: string;
      email?: string;
      role?: string;
    }>) {
      if (typeof u.email === 'string' && u.email.length > 0) {
        userByEmail.set(u.email.toLowerCase(), {
          fullName: u.fullName,
          email: u.email,
          role: u.role,
        });
      }
    }

    type ActivityLogView = {
      _id: unknown;
      event?: string;
      recipientRole?: string;
      message?: string;
      createdAt?: Date;
      updatedAt?: Date;
      userId?: string;
      userName?: string;
      userRole?: string;
      userEmail?: string;
      sellerId?: string;
      sellerName?: string;
      module?: string;
      ipAddress?: string;
      actionType?: 'LOGIN' | 'ERROR' | 'UPDATE' | 'DELETE' | 'OTHER';
      description?: string;
      action?: string;
      timestamp?: Date;
    };

    const enriched: ActivityLogView[] = data.map((raw) => {
      const entry = raw as unknown as ActivityLogView;
      const sellerName =
        entry.sellerName ??
        (typeof entry.sellerId === 'string'
          ? sellerNameById.get(entry.sellerId)
          : undefined);
      const userInfo =
        typeof entry.userId === 'string'
          ? userById.get(entry.userId)
          : typeof entry.userEmail === 'string'
            ? userByEmail.get(entry.userEmail.toLowerCase())
            : undefined;
      const module = entry.module ?? this.deriveModule(entry.event);
      const actionType = this.deriveActionType(entry.event, entry.message);

      const userNameResolved =
        typeof userInfo?.fullName === 'string' && userInfo.fullName.length > 0
          ? userInfo.fullName
          : (entry.userName ?? entry.userEmail ?? 'Unknown');
      const userRoleResolved =
        typeof userInfo?.role === 'string' && userInfo.role.length > 0
          ? userInfo.role
          : (entry.userRole ?? entry.recipientRole);
      const userEmailResolved =
        typeof userInfo?.email === 'string' && userInfo.email.length > 0
          ? userInfo.email
          : entry.userEmail;

      return {
        ...entry,
        module,
        actionType,
        description: entry.message,
        action: entry.event,
        userName: userNameResolved,
        userRole: userRoleResolved,
        userEmail: userEmailResolved,
        sellerName,
        timestamp: entry.createdAt ?? entry.updatedAt ?? undefined,
      };
    });

    return {
      success: true,
      data: enriched,
      meta: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
