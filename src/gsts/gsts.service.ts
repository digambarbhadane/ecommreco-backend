import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateGstDto } from './dto/create-gst.dto';
import { Gst, GstDocument } from './schemas/gst.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';

@Injectable()
export class GstsService {
  constructor(
    @InjectModel(Gst.name) private readonly gstModel: Model<GstDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
  ) {}

  async create(dto: CreateGstDto) {
    const seller = await this.sellerModel.findById(dto.sellerId);
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    const gstSlotsPurchased = seller.gstSlots || 0;
    const gstSlotsUsed = seller.gstSlotsUsed || 0;

    if (gstSlotsUsed >= gstSlotsPurchased) {
      throw new BadRequestException(
        'You have reached the maximum number of GST slots allowed in your subscription.',
      );
    }

    const gstNumber = dto.gstNumber.toUpperCase();

    // Check if GST already exists
    const existing = await this.gstModel.findOne({ gstNumber });
    if (existing) {
      throw new BadRequestException('GST number already registered');
    }

    const created = await this.gstModel.create({
      sellerId: dto.sellerId,
      gstNumber,
      businessName: dto.businessName,
      state: dto.state,
      status: dto.status ?? 'active',
    });

    // Update gstSlotsUsed
    await this.sellerModel.findByIdAndUpdate(dto.sellerId, {
      $inc: { gstSlotsUsed: 1 },
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
