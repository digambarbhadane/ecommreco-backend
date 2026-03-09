import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateGstDto } from './dto/create-gst.dto';
import { Gst, GstDocument } from './schemas/gst.schema';

@Injectable()
export class GstsService {
  constructor(
    @InjectModel(Gst.name) private readonly gstModel: Model<GstDocument>,
  ) {}

  async create(dto: CreateGstDto) {
    const gstNumber = dto.gstNumber.toUpperCase();
    const created = await this.gstModel.create({
      sellerId: dto.sellerId,
      gstNumber,
      state: dto.state,
      status: dto.status ?? 'active',
    });

    return {
      success: true,
      data: created,
    };
  }

  async list(params: { sellerId?: string; limit?: number; skip?: number }) {
    const { sellerId } = params;
    const limit = Math.max(0, params.limit ?? 10);
    const skip = Math.max(0, params.skip ?? 0);
    const filter: Record<string, unknown> = {};
    if (sellerId) {
      filter.sellerId = sellerId;
    }
    const data = await this.gstModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    const total = await this.gstModel.countDocuments(filter);
    return {
      success: true,
      data,
      total,
      limit,
      skip,
    };
  }
}
