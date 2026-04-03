import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { Gst, GstDocument } from '../../gsts/schemas/gst.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../../marketplaces/schemas/marketplace.schema';
import {
  ImportUpload,
  ImportUploadDocument,
} from '../schemas/import-upload.schema';
import { normalizeHeader, ParsedSheetRow } from './mapping.service';

@Injectable()
export class ValidationService {
  constructor(
    @InjectModel(Gst.name) private readonly gstModel: Model<GstDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUploadDocument>,
  ) {}

  async validateOwnership(payload: {
    sellerId: string;
    gstId: string;
    marketplaceId: string;
  }) {
    const gst = await this.gstModel.findById(payload.gstId).lean().exec();
    if (!gst || gst.sellerId !== payload.sellerId) {
      throw new NotFoundException('Selected GST profile not found');
    }
    const marketplace = await this.marketplaceModel
      .findById(payload.marketplaceId)
      .lean()
      .exec();
    if (!marketplace || marketplace.sellerId !== payload.sellerId) {
      throw new NotFoundException('Selected marketplace not found');
    }
    if (marketplace.gstId !== payload.gstId) {
      throw new BadRequestException(
        'Selected marketplace is not linked to selected GST',
      );
    }
    return { gst, marketplace };
  }

  validateRequiredHeaderGroups(
    headers: string[],
    requiredHeaderGroups: string[][],
    sheetName: string,
  ) {
    const normalized = new Set(headers.map((item) => normalizeHeader(item)));
    const missing = requiredHeaderGroups.filter((aliases) => {
      const hit = aliases.some((alias) =>
        normalized.has(normalizeHeader(alias)),
      );
      return !hit;
    });
    if (missing.length > 0) {
      const missingMsg = missing
        .map((aliases) => aliases.join(' / '))
        .join(', ');
      throw new BadRequestException(
        `Missing required columns in ${sheetName}: ${missingMsg}`,
      );
    }
  }

  validateGstinMatch(rows: ParsedSheetRow[], expectedGstin: string) {
    const distinct = new Set<string>();
    const aliasSet = new Set(
      ['GST NO', 'Seller GSTIN', 'seller_gstin'].map((item) =>
        normalizeHeader(item),
      ),
    );
    rows.forEach((row) => {
      const match = Object.entries(row).find(([key]) =>
        aliasSet.has(normalizeHeader(key)),
      );
      const raw = match?.[1];
      const value =
        typeof raw === 'string' || typeof raw === 'number'
          ? String(raw).trim().toUpperCase()
          : '';
      if (value) distinct.add(value);
    });
    if (!distinct.size) {
      throw new BadRequestException('GSTIN column is missing or empty in file');
    }
    if (
      distinct.size > 1 ||
      !distinct.has(expectedGstin.trim().toUpperCase())
    ) {
      throw new BadRequestException(
        'GSTIN in file does not match selected GST profile',
      );
    }
  }

  computeFileHash(buffer: Buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async ensureNotDuplicate(payload: {
    sellerId: string;
    gstin: string;
    marketplace: string;
    fileHash: string;
    minInvoiceDate?: string;
    maxInvoiceDate?: string;
    totalRecords: number;
  }) {
    const byHash = await this.uploadModel
      .findOne({
        sellerId: payload.sellerId,
        gstin: payload.gstin,
        marketplace: payload.marketplace,
        fileHash: payload.fileHash,
      })
      .lean()
      .exec();
    if (byHash) {
      throw new BadRequestException('File already uploaded');
    }

    if (payload.minInvoiceDate && payload.maxInvoiceDate) {
      const byFingerprint = await this.uploadModel
        .findOne({
          sellerId: payload.sellerId,
          gstin: payload.gstin,
          marketplace: payload.marketplace,
          minInvoiceDate: payload.minInvoiceDate,
          maxInvoiceDate: payload.maxInvoiceDate,
          totalRecords: payload.totalRecords,
        })
        .lean()
        .exec();
      if (byFingerprint) {
        throw new BadRequestException('File already uploaded');
      }
    }
  }
}
