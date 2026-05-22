import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ListImportedRowsDto } from './dto/list-imported-rows.dto';
import {
  ImportUpload,
  ImportUploadDocument,
} from './schemas/import-upload.schema';
import { ImportRow, ImportRowDocument } from './schemas/import-row.schema';
import {
  ImportRowError,
  ImportRowErrorDocument,
} from './schemas/import-row-error.schema';

@Injectable()
export class ReportImportService {
  constructor(
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUploadDocument>,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(ImportRowError.name)
    private readonly rowErrorModel: Model<ImportRowErrorDocument>,
  ) {}

  async listImportedRows(query: ListImportedRowsDto) {
    const filter: Record<string, unknown> = {};
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.gstin) filter.gstin = query.gstin.trim().toUpperCase();
    if (query.marketplace) filter.marketplace = query.marketplace;
    if (query.documentType) filter.documentType = query.documentType;
    if (query.fromDate || query.toDate) {
      filter.invoiceDate = {};
      if (query.fromDate) {
        (filter.invoiceDate as Record<string, unknown>).$gte = query.fromDate;
      }
      if (query.toDate) {
        (filter.invoiceDate as Record<string, unknown>).$lte = query.toDate;
      }
    }

    const limit = Math.max(0, Number(query.limit ?? '50'));
    const skip = Math.max(0, Number(query.skip ?? '0'));
    const sortBy = query.sortBy ?? 'documentType';
    const sortOrder = query.sortOrder === 'desc' ? -1 : 1;

    const [data, total] = await Promise.all([
      this.rowModel
        .find(filter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.rowModel.countDocuments(filter),
    ]);

    return {
      success: true,
      data,
      total,
      limit,
      skip,
    };
  }

  async getDocumentTypeSummary(
    query: Pick<
      ListImportedRowsDto,
      'sellerId' | 'gstin' | 'marketplace' | 'fromDate' | 'toDate'
    >,
  ) {
    const filter: Record<string, unknown> = {};
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.gstin) filter.gstin = query.gstin.trim().toUpperCase();
    if (query.marketplace) filter.marketplace = query.marketplace;
    if (query.fromDate || query.toDate) {
      filter.invoiceDate = {};
      if (query.fromDate) {
        (filter.invoiceDate as Record<string, unknown>).$gte = query.fromDate;
      }
      if (query.toDate) {
        (filter.invoiceDate as Record<string, unknown>).$lte = query.toDate;
      }
    }

    const groups = await this.rowModel
      .aggregate<{
        _id: string;
        count: number;
      }>([
        { $match: filter },
        {
          $group: {
            _id: { $ifNull: ['$documentType', 'Unknown'] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
      ])
      .exec();

    const getCount = (matcher: (documentType: string) => boolean) =>
      groups
        .filter((item) => matcher(String(item._id || '').toUpperCase()))
        .reduce((acc, item) => acc + Number(item.count || 0), 0);

    return {
      success: true,
      data: {
        totalSalesCount: getCount((doc) => doc.includes('SALE')),
        totalReturnsCount: getCount((doc) => doc.includes('RETURN')),
        totalCancelledCount: getCount((doc) => doc.includes('CANCEL')),
        byDocumentType: groups.map((item) => ({
          documentType: item._id || 'UNKNOWN',
          count: item.count,
        })),
      },
    };
  }

  async getMarketplaceDocumentSummary(
    query: Pick<
      ListImportedRowsDto,
      'sellerId' | 'gstin' | 'fromDate' | 'toDate'
    >,
  ) {
    const filter: Record<string, unknown> = {};
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.gstin) filter.gstin = query.gstin.trim().toUpperCase();
    if (query.fromDate || query.toDate) {
      filter.invoiceDate = {};
      if (query.fromDate) {
        (filter.invoiceDate as Record<string, unknown>).$gte = query.fromDate;
      }
      if (query.toDate) {
        (filter.invoiceDate as Record<string, unknown>).$lte = query.toDate;
      }
    }

    const groups = await this.rowModel
      .aggregate<{
        marketplace: string;
        documentType: string;
        count: number;
      }>([
        { $match: filter },
        {
          $group: {
            _id: {
              marketplace: '$marketplace',
              documentType: { $ifNull: ['$documentType', 'Unknown'] },
            },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            marketplace: '$_id.marketplace',
            documentType: '$_id.documentType',
            count: 1,
          },
        },
        { $sort: { marketplace: 1, count: -1, documentType: 1 } },
      ])
      .exec();

    const byMarketplace = new Map<
      string,
      { documentType: string; count: number }[]
    >();
    for (const row of groups) {
      const mpId = String(row.marketplace ?? '');
      const list = byMarketplace.get(mpId) ?? [];
      list.push({
        documentType: row.documentType,
        count: row.count,
      });
      byMarketplace.set(mpId, list);
    }

    return {
      success: true,
      data: Array.from(byMarketplace.entries()).map(([marketplaceId, byDocumentType]) => ({
        marketplaceId,
        byDocumentType,
        totalCount: byDocumentType.reduce((sum, item) => sum + item.count, 0),
      })),
    };
  }

  async listUploads(sellerId?: string) {
    const filter = sellerId ? { sellerId } : {};
    const data = await this.uploadModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return {
      success: true,
      data,
    };
  }

  async getUploadErrorsCsv(uploadId: string) {
    const data = await this.rowErrorModel
      .find({ uploadId })
      .sort({ rowNumber: 1 })
      .lean()
      .exec();
    const header = 'sheet_name,row_number,error\n';
    const body = data
      .map((item) => {
        const escapedError = String(item.error || '').replace(/"/g, '""');
        return `${item.sheetName},${item.rowNumber},"${escapedError}"`;
      })
      .join('\n');
    return `${header}${body}`;
  }
}
