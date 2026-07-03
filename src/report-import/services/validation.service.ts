import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { parseObjectId } from '../../common/mongo-id.util';
import * as crypto from 'crypto';
import { Gst, GstDocument } from '../../gsts/schemas/gst.schema';
import { Seller, SellerDocument } from '../../sellers/schemas/seller.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../../marketplaces/schemas/marketplace.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from '../../platform-marketplaces/schemas/platform-marketplace.schema';
import {
  ImportUpload,
  ImportUploadDocument,
} from '../schemas/import-upload.schema';
import {
  MarketplaceImportMapping,
  resolveMarketplaceImportMapping,
} from '../config/importMappings';
import {
  collectGstinRowFilterProblems,
  collectGstinValidationProblems,
  enrichRowsWithForwardFilledGstin,
  filterRowsBySelectedGstin,
  headerMatchesExcelColumn,
} from '../config/importMappings/gst-column.util';
import { flipkartImportMapping } from '../config/importMappings/flipkart.mapping';
import { ParsedSheetRow } from './mapping.service';
import {
  buildMeeshoGstinValidationMessage,
  MeeshoReportValidationInput,
} from '../utils/meesho-import.validation';
import {
  buildMyntraValidationMessage,
  MyntraReportValidationInput,
} from '../utils/myntra-import.validation';
import { sellerStateKeysFromRegistration } from '../utils/state-wise-gst-split.util';
import { cacheKey, sellerAliasCache } from '../../common/ttl-cache';

@Injectable()
export class ValidationService {
  constructor(
    @InjectModel(Gst.name) private readonly gstModel: Model<GstDocument>,
    @InjectModel(Seller.name) private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(PlatformMarketplace.name)
    private readonly platformMarketplaceModel: Model<PlatformMarketplaceDocument>,
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUploadDocument>,
  ) {}

  async validateOwnership(payload: {
    sellerId: string;
    gstId: string;
    marketplaceId: string;
  }) {
    const seller = await this.findSellerByIdentifier(payload.sellerId);
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }
    const sellerIdAliases = this.getSellerIdAliases(seller, payload.sellerId);
    const requestedGstId = String(payload.gstId ?? '').trim();

    let gst = await this.findGstForSeller(requestedGstId, sellerIdAliases);
    if (!gst) {
      throw new NotFoundException('Selected GST profile not found');
    }
    const resolvedGstId = String(gst._id);

    const marketplace = await this.marketplaceModel
      .findById(parseObjectId(payload.marketplaceId, 'marketplace id'))
      .lean()
      .exec();
    if (
      !marketplace ||
      !sellerIdAliases.includes(String(marketplace.sellerId))
    ) {
      throw new NotFoundException('Selected marketplace not found');
    }
    const marketplaceGstId = String(marketplace.gstId ?? '').trim();
    if (
      marketplaceGstId !== resolvedGstId &&
      marketplaceGstId !== requestedGstId
    ) {
      throw new BadRequestException(
        'Selected marketplace is not linked to selected GST',
      );
    }
    let platformName = '';
    let platformSlug = '';
    if (marketplace.platformMarketplaceId) {
      const platform = Types.ObjectId.isValid(
        String(marketplace.platformMarketplaceId),
      )
        ? await this.platformMarketplaceModel
            .findById(marketplace.platformMarketplaceId)
            .lean()
            .exec()
        : null;
      platformName = String(platform?.name ?? '').trim().toLowerCase();
      platformSlug = String(platform?.slug ?? '').trim().toLowerCase();
    }

    const storeName = String(marketplace.storeName ?? '').trim().toLowerCase();
    const marketplaceIdentifier = `${platformName} ${platformSlug} ${storeName}`
      .trim()
      .toLowerCase();

    return {
      gst,
      marketplace,
      marketplaceIdentifier,
      canonicalSellerId: this.getSellerObjectIdString(seller),
      sellerIdAliases,
    };
  }

  async resolveSellerIdAliases(identifier: string): Promise<string[]> {
    const key = cacheKey(identifier);
    if (key) {
      const cached = sellerAliasCache.get(key);
      if (cached) return cached;
    }
    const seller = await this.findSellerByIdentifier(identifier);
    const aliases = !seller
      ? (() => {
          const trimmed = String(identifier ?? '').trim();
          return trimmed ? [trimmed] : [];
        })()
      : this.getSellerIdAliases(seller, identifier);
    if (key && aliases.length > 0) {
      sellerAliasCache.set(key, aliases);
    }
    return aliases;
  }

  async sellerOwnsRecord(
    recordSellerId: string,
    requestedSellerId: string,
  ): Promise<boolean> {
    const aliases = await this.resolveSellerIdAliases(requestedSellerId);
    return aliases.includes(String(recordSellerId));
  }

  async getSellerGstStates(sellerIdAliases: string[]): Promise<string[]> {
    const info = await this.getSellerGstRegistrationInfo(sellerIdAliases);
    return info.states;
  }

  async getSellerGstRegistrationInfo(sellerIdAliases: string[]): Promise<{
    states: string[];
    gstins: string[];
  }> {
    if (!sellerIdAliases.length) {
      return { states: [], gstins: [] };
    }
    const rows = await this.gstModel
      .find({
        sellerId: { $in: sellerIdAliases },
      })
      .select('state gstNumber')
      .lean()
      .exec();

    const states = new Set<string>();
    const gstins = new Set<string>();
    for (const item of rows) {
      const state = String(item.state ?? '').trim();
      if (state.length > 0) {
        states.add(state);
      }
      const gstNumber = String(item.gstNumber ?? '').trim();
      if (gstNumber.length > 0) {
        gstins.add(gstNumber);
      }
    }

    return {
      states: [...states],
      gstins: [...gstins],
    };
  }

  /** Seller registration state keys for a specific GST record (month/state-wise reports). */
  async resolveSellerStateKeysForGst(
    gstId: string,
    sellerIdAliases: string[],
  ): Promise<Set<string>> {
    const gst = await this.findGstForSeller(gstId, sellerIdAliases);
    return sellerStateKeysFromRegistration(gst?.state, gst?.gstNumber ?? gstId);
  }

  validateRequiredHeaderGroups(
    headers: string[],
    requiredHeaderGroups: ReadonlyArray<readonly string[]>,
    sheetName: string,
  ) {
    const missing = requiredHeaderGroups.filter((aliases) => {
      const hit = headers.some((header) =>
        aliases.some((alias) => headerMatchesExcelColumn(header, alias)),
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

  validateMyntraImportBundle(
    reports: MyntraReportValidationInput[],
    expectedGstin: string,
  ) {
    const message = buildMyntraValidationMessage(reports, expectedGstin);
    if (message) {
      throw new BadRequestException(message);
    }
  }

  validateGstinMatch(
    rows: ParsedSheetRow[],
    expectedGstin: string,
    marketplaceIdentifier: string,
    fileHeaders: string[] = [],
    fallbackGstins: string[] = [],
    mappingOverride?: MarketplaceImportMapping,
    context?: { reportLabel?: string; fileName?: string },
  ) {
    const mapping =
      mappingOverride ??
      resolveMarketplaceImportMapping(marketplaceIdentifier);
    const problems = collectGstinValidationProblems({
      rows,
      expectedGstin,
      mapping,
      fileHeaders,
      fallbackGstins,
    });
    if (!problems.length) return;

    const prefix =
      context?.fileName || context?.reportLabel
        ? [
            context.reportLabel ? `Report: ${context.reportLabel}` : '',
            context.fileName ? `File: ${context.fileName}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : `Marketplace: ${mapping.displayName}`;

    throw new BadRequestException(
      [`GSTIN validation failed.`, prefix, '', ...problems.map((p) => `• ${p}`)].join(
        '\n',
      ),
    );
  }

  filterFlipkartRowsBySelectedGstin(
    parsed: {
      salesRows: ParsedSheetRow[];
      cashbackRows: ParsedSheetRow[];
      headers: Record<'Sales Report' | 'Cash Back Report', string[]>;
      gstinValues: string[];
    },
    expectedGstin: string,
  ): {
    salesRows: ParsedSheetRow[];
    cashbackRows: ParsedSheetRow[];
    skippedCount: number;
  } {
    const fileHeaders = [
      ...parsed.headers['Sales Report'],
      ...parsed.headers['Cash Back Report'],
    ];
    const enrichedSales = enrichRowsWithForwardFilledGstin(
      parsed.salesRows,
      flipkartImportMapping,
      parsed.headers['Sales Report'],
    );
    const enrichedCashback = enrichRowsWithForwardFilledGstin(
      parsed.cashbackRows,
      flipkartImportMapping,
      parsed.headers['Cash Back Report'],
    );
    const sales = filterRowsBySelectedGstin(
      enrichedSales,
      flipkartImportMapping,
      parsed.headers['Sales Report'],
      expectedGstin,
    );
    const cashback = filterRowsBySelectedGstin(
      enrichedCashback,
      flipkartImportMapping,
      parsed.headers['Cash Back Report'],
      expectedGstin,
    );
    const fileGstins = new Set([...sales.fileGstins, ...cashback.fileGstins]);

    const problems = collectGstinRowFilterProblems({
      rows: [...enrichedSales, ...enrichedCashback],
      expectedGstin,
      mapping: flipkartImportMapping,
      fileHeaders,
      fallbackGstins: parsed.gstinValues,
      matchedRowCount: sales.matchedCount + cashback.matchedCount,
      fileGstins,
    });

    if (problems.length) {
      throw new BadRequestException(
        [
          'GSTIN validation failed.',
          'Marketplace: Flipkart',
          '',
          ...problems.map((p) => `• ${p}`),
        ].join('\n'),
      );
    }

    return {
      salesRows: sales.rows,
      cashbackRows: cashback.rows,
      skippedCount: sales.skippedCount + cashback.skippedCount,
    };
  }

  validateMeeshoGstinBundle(
    reports: MeeshoReportValidationInput[],
    expectedGstin: string,
  ) {
    const message = buildMeeshoGstinValidationMessage(reports, expectedGstin);
    if (message) {
      throw new BadRequestException(message);
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
    excludeUploadId?: string;
  }) {
    const baseFilter = this.successfulUploadFilter(payload, payload.excludeUploadId);

    const byHash = await this.uploadModel
      .findOne({
        ...baseFilter,
        fileHash: payload.fileHash,
      })
      .lean()
      .exec();
    if (byHash) {
      throw this.duplicateUploadException(byHash);
    }

    if (payload.minInvoiceDate && payload.maxInvoiceDate) {
      const byFingerprint = await this.uploadModel
        .findOne({
          ...baseFilter,
          minInvoiceDate: payload.minInvoiceDate,
          maxInvoiceDate: payload.maxInvoiceDate,
          totalRecords: payload.totalRecords,
        })
        .lean()
        .exec();
      if (byFingerprint) {
        throw this.duplicateUploadException(byFingerprint);
      }
    }
  }

  async ensureNoDuplicateFileHashes(payload: {
    sellerId: string;
    gstin: string;
    marketplace: string;
    fileHashes: string[];
    excludeUploadId?: string;
  }) {
    const uniqueHashes = Array.from(
      new Set(payload.fileHashes.filter((hash) => typeof hash === 'string' && hash.length > 0)),
    );
    if (!uniqueHashes.length) return;

    const escapeRegex = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await this.uploadModel
      .findOne({
        ...this.successfulUploadFilter(payload, payload.excludeUploadId),
        $or: uniqueHashes.flatMap((hash) => [
          { fileHash: hash },
          {
            fileHash: {
              $regex: `(^|\\|)[^:]*:${escapeRegex(hash)}($|\\|)`,
            },
          },
        ]),
      })
      .lean()
      .exec();

    if (existing) {
      throw this.duplicateUploadException(existing);
    }
  }

  /** Only block when a prior import completed with saved rows. */
  private successfulUploadFilter(
    payload: { sellerId: string; gstin: string; marketplace: string },
    excludeUploadId?: string,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      sellerId: payload.sellerId,
      gstin: payload.gstin,
      marketplace: payload.marketplace,
      status: 'completed',
      totalRecords: { $gt: 0 },
    };
    if (excludeUploadId && Types.ObjectId.isValid(excludeUploadId)) {
      filter._id = { $ne: new Types.ObjectId(excludeUploadId) };
    }
    return filter;
  }

  private async findGstForSeller(
    gstId: string,
    sellerIdAliases: string[],
  ) {
    const value = String(gstId ?? '').trim();
    if (!value) return null;

    if (Types.ObjectId.isValid(value)) {
      const byId = await this.gstModel.findById(value).lean().exec();
      if (byId && sellerIdAliases.includes(String(byId.sellerId))) {
        return byId;
      }
    }

    return this.gstModel
      .findOne({
        sellerId: { $in: sellerIdAliases },
        gstNumber: value.toUpperCase(),
      })
      .lean()
      .exec();
  }

  private async findSellerByIdentifier(identifier: string) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;
    if (Types.ObjectId.isValid(value)) {
      const sellerById = await this.sellerModel.findById(value).exec();
      if (sellerById) return sellerById;
    }
    const sellerByPublicId = await this.sellerModel
      .findOne({ publicId: value })
      .exec();
    if (sellerByPublicId) return sellerByPublicId;

    const user = await this.findSellerUserByIdentifier(value);
    if (!user) return null;
    const email = String(user.email ?? '').trim().toLowerCase();
    if (!email) return null;
    return this.sellerModel
      .findOne({
        $or: [{ email }, { username: email }],
      })
      .exec();
  }

  private async findSellerUserByIdentifier(identifier: string) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;
    if (Types.ObjectId.isValid(value)) {
      const byId = await this.userModel
        .findOne({ _id: value, role: 'seller' })
        .exec();
      if (byId) return byId;
    }
    return this.userModel
      .findOne({
        role: 'seller',
        $or: [{ publicId: value }, { email: value }, { username: value }],
      })
      .exec();
  }

  private getSellerObjectIdString(seller: SellerDocument) {
    const id = seller?._id as Types.ObjectId | string | undefined;
    return typeof id === 'string' ? id : id?.toString?.() ?? '';
  }

  private getSellerIdAliases(seller: SellerDocument, requestedId?: string) {
    const aliases = new Set<string>();
    const objectId = this.getSellerObjectIdString(seller);
    if (objectId) aliases.add(objectId);
    if (typeof seller.publicId === 'string' && seller.publicId.trim()) {
      aliases.add(seller.publicId.trim());
    }
    if (typeof requestedId === 'string' && requestedId.trim()) {
      aliases.add(requestedId.trim());
    }
    return Array.from(aliases);
  }

  private duplicateUploadException(existing: {
    _id?: unknown;
    totalRecords?: number;
    createdAt?: Date;
  }) {
    const when =
      existing.createdAt instanceof Date
        ? existing.createdAt.toISOString().slice(0, 10)
        : 'a previous date';
    const count = Number(existing.totalRecords ?? 0);
    return new BadRequestException(
      count > 0
        ? `These report files were already imported successfully (${count} records on ${when}). Open Imported Data to view them, or upload different files.`
        : 'File already uploaded',
    );
  }
}
