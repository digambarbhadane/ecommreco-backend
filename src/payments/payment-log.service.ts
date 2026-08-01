import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PaymentLog,
  PaymentLogDocument,
  PaymentLogEvent,
} from './schemas/payment-log.schema';

@Injectable()
export class PaymentLogService {
  constructor(
    @InjectModel(PaymentLog.name)
    private readonly logModel: Model<PaymentLogDocument>,
  ) {}

  async log(input: {
    eventType: PaymentLogEvent;
    orderId?: string;
    sellerId?: string;
    transactionId?: string;
    gateway?: string;
    message?: string;
    request?: Record<string, unknown>;
    response?: Record<string, unknown>;
    success?: boolean;
    errorCode?: string;
  }) {
    return this.logModel.create({
      eventType: input.eventType,
      orderId: input.orderId,
      sellerId: input.sellerId,
      transactionId: input.transactionId,
      gateway: input.gateway,
      message: input.message,
      request: input.request,
      response: input.response,
      success: input.success ?? true,
      errorCode: input.errorCode,
    });
  }

  async list(filters: {
    orderId?: string;
    sellerId?: string;
    eventType?: PaymentLogEvent;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const query: Record<string, unknown> = {};
    if (filters.orderId) query.orderId = filters.orderId;
    if (filters.sellerId) query.sellerId = filters.sellerId;
    if (filters.eventType) query.eventType = filters.eventType;

    const [items, total] = await Promise.all([
      this.logModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.logModel.countDocuments(query).exec(),
    ]);

    return { items, total, page, limit };
  }
}
