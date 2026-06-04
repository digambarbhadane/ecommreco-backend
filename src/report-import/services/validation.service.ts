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
  extractGstinsFromRows,
  headerMatchesExcelColumn,
  headersHaveGstColumn,
  parseGstinFromCell,
} from '../config/importMappings/gst-column.util';
import { ParsedSheetRow } from './mapping.service';
import {
  buildMyntraValidationMessage,
  MyntraReportValidationInput,
} from '../utils/myntra-import.validation';

@Injectable()
export class ValidationService {
  constructor(
    @InjectModel(Gst.name) private readonly gstModel: Model<GstDocument>,
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
    const gst = await this.gstModel
      .findById(parseObjectId(payload.gstId, 'GST id'))
      .lean()
      .exec();
    if (
      !gst ||
      String(gst.sellerId) !== String(payload.sellerId).trim()
    ) {
      throw new NotFoundException('Selected GST profile not found');
    }
    const marketplace = await this.marketplaceModel
      .findById(parseObjectId(payload.marketplaceId, 'marketplace id'))
      .lean()
      .exec();
    if (
      !marketplace ||
      String(marketplace.sellerId) !== String(payload.sellerId).trim()
    ) {
      throw new NotFoundException('Selected marketplace not found');
    }
    if (marketplace.gstId !== payload.gstId) {
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

    return { gst, marketplace, marketplaceIdentifier };
  }

  validateRequiredHeaderGroups(
    headers: string[],
    requiredHeaderGroups: string[][],
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
  ) {
    const mapping =
      mappingOverride ??
      resolveMarketplaceImportMapping(marketplaceIdentifier);
    const gstColumn = mapping.gstin.excelColumns[0];
    const selectedGSTIN = parseGstinFromCell(expectedGstin) ?? '';

    // eslint-disable-next-line no-console
    console.log('Marketplace:', mapping.displayName);
    // eslint-disable-next-line no-console
    console.log('Selected GST:', selectedGSTIN);
    // eslint-disable-next-line no-console
    console.log('Mapped GST Column:', gstColumn);

    const { values, foundColumn } = extractGstinsFromRows(rows, mapping);
    fallbackGstins.forEach((raw) => {
      const gstin = parseGstinFromCell(raw);
      if (gstin) values.add(gstin);
    });
    // eslint-disable-next-line no-console
    console.log(
      '[GST_DEBUG_v2] rowValues=',
      [...values].join('|') || '(none)',
      'fallback=',
      fallbackGstins.join('|') || '(none)',
    );
    const headerHasGstColumn = headersHaveGstColumn(
      fileHeaders,
      mapping.gstin.excelColumns,
    );
    const gstColumnFound =
      foundColumn || headerHasGstColumn || fallbackGstins.length > 0;

    // eslint-disable-next-line no-console
    console.log(
      'GST Found In File:',
      values.size > 0 ? [...values].join(', ') : '(none)',
    );

    if (!gstColumnFound) {
      throw new BadRequestException(
        `GSTIN column not found in uploaded file.\n\nExpected column:\n${gstColumn}\n\nMarketplace:\n${mapping.displayName}`,
      );
    }

    if (!values.size) {
      const fillHint =
        mapping.key === 'flipkart'
          ? 'Ensure the Seller GSTIN column is filled on the Sales Report and Cash Back Report sheets.'
          : mapping.key === 'meesho'
            ? 'Ensure the gstin column is filled in TCS Sales Report.'
            : mapping.key === 'myntra'
              ? 'Ensure seller_gstin (or tax_seller_gstin) is filled in GSTR Report Packed.'
              : mapping.key === 'amazon'
                ? 'Ensure the Seller Gstin column is filled in your MTR report.'
                : 'Check that the GSTIN column is filled in your report.';
      throw new BadRequestException(
        `GSTIN column "${gstColumn}" was found in the file but contains no valid GSTIN values. ${fillHint}`,
      );
    }

    if (values.size > 1 || !values.has(selectedGSTIN)) {
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
