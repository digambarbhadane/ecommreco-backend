import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateGstDto } from './dto/create-gst.dto';
import { Gst, GstDocument } from './schemas/gst.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../marketplaces/schemas/marketplace.schema';

@Injectable()
export class GstsService {
  constructor(
    @InjectModel(Gst.name) private readonly gstModel: Model<GstDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
  ) {}

  async create(dto: CreateGstDto) {
    const seller = await this.sellerModel.findById(dto.sellerId);
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    const gstNumber = dto.gstNumber.toUpperCase();
    const extractedPan = this.extractPanFromGst(gstNumber);

    const existing = await this.gstModel.findOne({ gstNumber });
    if (existing) {
      const existingPan =
        typeof existing.panNumber === 'string'
          ? existing.panNumber.trim().toUpperCase()
          : '';
      if (existingPan && existingPan !== extractedPan) {
        throw new BadRequestException(
          'GST exists with a different PAN mapping',
        );
      }
      throw new BadRequestException('GST number already registered');
    }

    const sellerGsts = await this.gstModel
      .find({ sellerId: dto.sellerId })
      .select('panNumber gstNumber')
      .lean()
      .exec();
    const sellerPanSet = new Set<string>();
    sellerGsts.forEach((item) => {
      const pan =
        typeof item.panNumber === 'string' && item.panNumber.length > 0
          ? item.panNumber.trim().toUpperCase()
          : this.extractPanFromGst(item.gstNumber);
      if (pan) {
        sellerPanSet.add(pan);
      }
    });
    if (Array.isArray(seller.panProfiles)) {
      seller.panProfiles.forEach((item) => {
        const pan =
          typeof item.panNumber === 'string'
            ? item.panNumber.trim().toUpperCase()
            : '';
        if (pan) {
          sellerPanSet.add(pan);
        }
      });
    }

    const isExistingPanForSeller = sellerPanSet.has(extractedPan);
    const purchasedPanSlots = Math.max(
      0,
      Number(seller.gstSlotsPurchased ?? seller.gstSlots ?? 0),
    );
    const usedPanSlots = sellerPanSet.size;
    if (!isExistingPanForSeller && usedPanSlots >= purchasedPanSlots) {
      throw new BadRequestException(
        'You have reached your GST limit. Please upgrade your plan to add a new PAN.',
      );
    }

    const panProfiles = Array.isArray(seller.panProfiles)
      ? [...seller.panProfiles]
      : [];
    const panIndex = panProfiles.findIndex(
      (item) => item.panNumber === extractedPan,
    );
    const businessName = dto.businessName?.trim();
    if (panIndex === -1) {
      panProfiles.push({
        panNumber: extractedPan,
        businessName: businessName || undefined,
        createdAt: new Date(),
      });
    } else if (businessName && !panProfiles[panIndex].businessName) {
      panProfiles[panIndex] = {
        ...panProfiles[panIndex],
        businessName,
      };
    }

    const created = await this.gstModel.create({
      sellerId: dto.sellerId,
      gstNumber,
      panNumber: extractedPan,
      businessName: businessName,
      state: dto.state,
      status: dto.status ?? 'active',
    });

    seller.panProfiles = panProfiles;
    seller.gstSlotsUsed = isExistingPanForSeller
      ? usedPanSlots
      : usedPanSlots + 1;
    await seller.save();

    return {
      success: true,
      data: created,
    };
  }

  async importRows(payload: {
    sellerId: string;
    rows: {
      gstNumber: string;
      state?: string;
      status?: 'active' | 'inactive';
      businessName?: string;
    }[];
  }) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (rows.length === 0) {
      throw new BadRequestException('rows must contain at least one entry');
    }

    const seenInFile = new Set<string>();
    const created: Gst[] = [];
    const failed: { index: number; gstNumber: string; reason: string }[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const gstNumber = String(row.gstNumber ?? '')
        .trim()
        .toUpperCase();
      if (!gstNumber) {
        failed.push({ index, gstNumber: '', reason: 'GST number is required' });
        continue;
      }
      if (seenInFile.has(gstNumber)) {
        failed.push({
          index,
          gstNumber,
          reason: 'Duplicate GST in uploaded file',
        });
        continue;
      }
      seenInFile.add(gstNumber);

      try {
        const result = await this.create({
          sellerId: payload.sellerId,
          gstNumber,
          state: row.state,
          status: row.status,
          businessName: row.businessName,
        });
        created.push(result.data as Gst);
      } catch (error) {
        const reason =
          error instanceof BadRequestException ||
          error instanceof NotFoundException
            ? String(error.message)
            : 'Failed to import GST row';
        failed.push({ index, gstNumber, reason });
      }
    }

    return {
      success: true,
      data: created,
      totalRows: rows.length,
      createdCount: created.length,
      failedCount: failed.length,
      failed,
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
    let slotSummary:
      | {
          purchased: number;
          used: number;
          remaining: number;
        }
      | undefined;
    if (sellerId) {
      const sellerGsts = await this.gstModel
        .find({ sellerId })
        .select('panNumber gstNumber')
        .lean()
        .exec();
      const sellerPanSet = new Set<string>();
      sellerGsts.forEach((item) => {
        const pan =
          typeof item.panNumber === 'string' && item.panNumber.length > 0
            ? item.panNumber.trim().toUpperCase()
            : this.extractPanFromGst(item.gstNumber);
        if (pan) {
          sellerPanSet.add(pan);
        }
      });
      const seller = await this.sellerModel
        .findById(sellerId)
        .select('gstSlots gstSlotsPurchased panProfiles')
        .lean()
        .exec();
      if (seller) {
        if (Array.isArray(seller.panProfiles)) {
          seller.panProfiles.forEach((item) => {
            const pan =
              typeof item.panNumber === 'string'
                ? item.panNumber.trim().toUpperCase()
                : '';
            if (pan) {
              sellerPanSet.add(pan);
            }
          });
        }
        const purchased = Math.max(
          0,
          Number(seller.gstSlotsPurchased ?? seller.gstSlots ?? 0),
        );
        const used = sellerPanSet.size;
        slotSummary = {
          purchased,
          used,
          remaining: Math.max(0, purchased - used),
        };
      }
    }
    const groupedByPan: Record<string, typeof data> = {};
    data.forEach((item) => {
      const panKey =
        typeof item.panNumber === 'string' && item.panNumber.length > 0
          ? item.panNumber
          : this.extractPanFromGst(item.gstNumber);
      if (!groupedByPan[panKey]) {
        groupedByPan[panKey] = [];
      }
      groupedByPan[panKey].push(item);
    });
    return {
      success: true,
      data,
      panGroups: Object.entries(groupedByPan).map(([panNumber, gsts]) => ({
        panNumber,
        gsts,
      })),
      total,
      limit,
      skip,
      slotSummary,
    };
  }

  async update(
    id: string,
    payload: {
      businessName?: string;
      state?: string;
      status?: 'active' | 'inactive';
    },
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid GST id');
    }
    const gst = await this.gstModel.findById(id).exec();
    if (!gst) {
      throw new NotFoundException('GST not found');
    }

    const updates: Partial<{
      businessName: string | undefined;
      state: string | undefined;
      status: 'active' | 'inactive';
    }> = {};
    if (typeof payload.businessName === 'string') {
      updates.businessName = payload.businessName.trim() || undefined;
    }
    if (typeof payload.state === 'string') {
      updates.state = payload.state.trim() || undefined;
    }
    if (payload.status === 'active' || payload.status === 'inactive') {
      updates.status = payload.status;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No valid fields provided for update');
    }

    const updated = await this.gstModel
      .findByIdAndUpdate(id, { $set: updates }, { new: true })
      .lean()
      .exec();

    if (updates.businessName !== undefined) {
      const seller = await this.sellerModel.findById(gst.sellerId).exec();
      if (seller) {
        const panProfiles = Array.isArray(seller.panProfiles)
          ? [...seller.panProfiles]
          : [];
        const panIndex = panProfiles.findIndex(
          (item) => item.panNumber === gst.panNumber,
        );
        if (panIndex >= 0) {
          panProfiles[panIndex] = {
            ...panProfiles[panIndex],
            businessName: updates.businessName,
          };
          seller.panProfiles = panProfiles;
          await seller.save();
        }
      }
    }

    return {
      success: true,
      data: updated,
    };
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid GST id');
    }
    const gst = await this.gstModel.findById(id).lean().exec();
    if (!gst) {
      throw new NotFoundException('GST not found');
    }

    const linkedMarketplaces = await this.marketplaceModel.countDocuments({
      gstId: id,
    });
    if (linkedMarketplaces > 0) {
      throw new BadRequestException(
        'Cannot delete GST with linked marketplaces',
      );
    }

    await this.gstModel.findByIdAndDelete(id).exec();

    const remainingGsts = await this.gstModel
      .find({ sellerId: gst.sellerId })
      .select('panNumber gstNumber')
      .lean()
      .exec();
    const panSet = new Set<string>();
    remainingGsts.forEach((item) => {
      const pan =
        typeof item.panNumber === 'string' && item.panNumber.length > 0
          ? item.panNumber.trim().toUpperCase()
          : this.extractPanFromGst(item.gstNumber);
      if (pan) {
        panSet.add(pan);
      }
    });

    const seller = await this.sellerModel.findById(gst.sellerId).exec();
    if (seller) {
      const nextProfiles = Array.isArray(seller.panProfiles)
        ? seller.panProfiles.filter((item) => panSet.has(item.panNumber))
        : [];
      seller.panProfiles = nextProfiles;
      seller.gstSlotsUsed = panSet.size;
      await seller.save();
    }

    return {
      success: true,
      data: gst,
    };
  }

  private extractPanFromGst(gstNumber: string) {
    const normalized = gstNumber.trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[0-9A-Z]$/.test(normalized)) {
      throw new BadRequestException('GSTIN must match valid format');
    }
    return normalized.slice(2, 12);
  }
}
