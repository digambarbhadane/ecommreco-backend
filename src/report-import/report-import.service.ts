import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
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
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { Gst, GstDocument } from '../gsts/schemas/gst.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';
import { ValidationService } from './services/validation.service';

@Injectable()
export class ReportImportService {
  constructor(
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUploadDocument>,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(ImportRowError.name)
    private readonly rowErrorModel: Model<ImportRowErrorDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(Gst.name)
    private readonly gstModel: Model<GstDocument>,
    @InjectModel(PlatformMarketplace.name)
    private readonly platformMarketplaceModel: Model<PlatformMarketplaceDocument>,
    private readonly validationService: ValidationService,
  ) {}

  private async applySellerIdToFilter(
    filter: Record<string, unknown>,
    sellerId?: string,
  ) {
    const trimmed = String(sellerId ?? '').trim();
    if (!trimmed) return;
    filter.sellerId = {
      $in: await this.validationService.resolveSellerIdAliases(trimmed),
    };
  }

  async listImportedRows(query: ListImportedRowsDto) {
    const filter: Record<string, unknown> = {};
    await this.applySellerIdToFilter(filter, query.sellerId);
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
    await this.applySellerIdToFilter(filter, query.sellerId);
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
    await this.applySellerIdToFilter(filter, query.sellerId);
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

  private async buildRowFilter(
    query: Pick<
      ListImportedRowsDto,
      'sellerId' | 'gstin' | 'marketplace' | 'fromDate' | 'toDate'
    >,
  ): Promise<Record<string, unknown>> {
    const filter: Record<string, unknown> = {};
    await this.applySellerIdToFilter(filter, query.sellerId);
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
    return filter;
  }

  async getSellerDashboardStats(
    query: Pick<
      ListImportedRowsDto,
      'sellerId' | 'gstin' | 'fromDate' | 'toDate'
    >,
  ) {
    const filter = await this.buildRowFilter(query);

    const docTypeUpper = { $toUpper: { $ifNull: ['$documentType', ''] } };
    const isSales = {
      $regexMatch: { input: docTypeUpper, regex: 'SALE' },
    };
    const isReturn = {
      $or: [
        { $regexMatch: { input: docTypeUpper, regex: 'RETURN' } },
        { $regexMatch: { input: docTypeUpper, regex: 'RTO' } },
      ],
    };
    const isCancelled = {
      $regexMatch: { input: docTypeUpper, regex: 'CANCEL' },
    };
    const invoiceAmt = { $ifNull: ['$invoiceAmount', 0] };

    const [
      totalsRows,
      marketplaceRows,
      monthlyRows,
      gstinRows,
      recentUploads,
    ] = await Promise.all([
      this.rowModel
        .aggregate<{
          totalRecords: number;
          totalInvoiceAmount: number;
          totalSalesCount: number;
          totalReturnsCount: number;
          totalCancelledCount: number;
          totalSalesAmount: number;
          totalReturnsAmount: number;
        }>([
          { $match: filter },
          {
            $group: {
              _id: null,
              totalRecords: { $sum: 1 },
              totalInvoiceAmount: { $sum: invoiceAmt },
              totalSalesCount: { $sum: { $cond: [isSales, 1, 0] } },
              totalReturnsCount: { $sum: { $cond: [isReturn, 1, 0] } },
              totalCancelledCount: { $sum: { $cond: [isCancelled, 1, 0] } },
              totalSalesAmount: {
                $sum: { $cond: [isSales, invoiceAmt, 0] },
              },
              totalReturnsAmount: {
                $sum: { $cond: [isReturn, invoiceAmt, 0] },
              },
            },
          },
        ])
        .exec(),
      this.rowModel
        .aggregate<{
          marketplaceId: string;
          totalCount: number;
          salesCount: number;
          returnsCount: number;
          invoiceAmount: number;
          salesAmount: number;
        }>([
          { $match: filter },
          {
            $group: {
              _id: '$marketplace',
              totalCount: { $sum: 1 },
              salesCount: { $sum: { $cond: [isSales, 1, 0] } },
              returnsCount: { $sum: { $cond: [isReturn, 1, 0] } },
              invoiceAmount: { $sum: invoiceAmt },
              salesAmount: { $sum: { $cond: [isSales, invoiceAmt, 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              marketplaceId: '$_id',
              totalCount: 1,
              salesCount: 1,
              returnsCount: 1,
              invoiceAmount: 1,
              salesAmount: 1,
            },
          },
          { $sort: { totalCount: -1, marketplaceId: 1 } },
        ])
        .exec(),
      this.rowModel
        .aggregate<{
          month: string;
          totalCount: number;
          salesCount: number;
          returnsCount: number;
        }>([
          { $match: { ...filter, invoiceDate: { $exists: true, $nin: [null, ''] } } },
          {
            $addFields: {
              month: { $substr: ['$invoiceDate', 0, 7] },
            },
          },
          {
            $match: {
              month: { $regex: /^\d{4}-\d{2}$/ },
            },
          },
          {
            $group: {
              _id: '$month',
              totalCount: { $sum: 1 },
              salesCount: { $sum: { $cond: [isSales, 1, 0] } },
              returnsCount: { $sum: { $cond: [isReturn, 1, 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              month: '$_id',
              totalCount: 1,
              salesCount: 1,
              returnsCount: 1,
            },
          },
          { $sort: { month: 1 } },
          { $limit: 12 },
        ])
        .exec(),
      this.rowModel
        .aggregate<{ gstin: string }>([
          { $match: filter },
          { $group: { _id: '$gstin' } },
          { $project: { _id: 0, gstin: '$_id' } },
        ])
        .exec(),
      query.sellerId
        ? this.uploadModel
            .find({
              sellerId: query.sellerId,
              ...(query.gstin
                ? { gstin: query.gstin.trim().toUpperCase() }
                : {}),
            })
            .sort({ createdAt: -1 })
            .limit(8)
            .select(
              'marketplace fileName status totalRecords createdAt minInvoiceDate maxInvoiceDate',
            )
            .lean()
            .exec()
        : [],
    ]);

    const totals = totalsRows[0] ?? {
      totalRecords: 0,
      totalInvoiceAmount: 0,
      totalSalesCount: 0,
      totalReturnsCount: 0,
      totalCancelledCount: 0,
      totalSalesAmount: 0,
      totalReturnsAmount: 0,
    };

    const totalSalesCount = Number(totals.totalSalesCount || 0);
    const totalReturnsCount = Number(totals.totalReturnsCount || 0);
    const returnRatePercent =
      totalSalesCount > 0
        ? Math.round((totalReturnsCount / totalSalesCount) * 1000) / 10
        : 0;

    return {
      success: true,
      data: {
        totalRecords: Number(totals.totalRecords || 0),
        totalSalesCount,
        totalReturnsCount,
        totalCancelledCount: Number(totals.totalCancelledCount || 0),
        totalInvoiceAmount: Number(totals.totalInvoiceAmount || 0),
        totalSalesAmount: Number(totals.totalSalesAmount || 0),
        totalReturnsAmount: Number(totals.totalReturnsAmount || 0),
        returnRatePercent,
        gstinCount: gstinRows.length,
        marketplaceCount: marketplaceRows.length,
        byMarketplace: marketplaceRows.map((row) => ({
          marketplaceId: String(row.marketplaceId ?? ''),
          totalCount: Number(row.totalCount || 0),
          salesCount: Number(row.salesCount || 0),
          returnsCount: Number(row.returnsCount || 0),
          invoiceAmount: Number(row.invoiceAmount || 0),
          salesAmount: Number(row.salesAmount || 0),
        })),
        monthlyTrend: monthlyRows.map((row) => ({
          month: row.month,
          totalCount: Number(row.totalCount || 0),
          salesCount: Number(row.salesCount || 0),
          returnsCount: Number(row.returnsCount || 0),
        })),
        recentUploads: recentUploads.map((upload) => ({
          id: String(upload._id),
          marketplaceId: String(upload.marketplace ?? ''),
          fileName: String(upload.fileName ?? ''),
          status: String(upload.status ?? 'completed'),
          totalRecords: Number(upload.totalRecords || 0),
          createdAt: upload.createdAt,
          minInvoiceDate: upload.minInvoiceDate,
          maxInvoiceDate: upload.maxInvoiceDate,
        })),
      },
    };
  }

  private resolveAnalyticsDateRange(query: { fromDate?: string; toDate?: string }) {
    const today = new Date();
    const toDate = query.toDate?.trim() || today.toISOString().slice(0, 10);
    const defaultFrom = new Date(today);
    defaultFrom.setDate(defaultFrom.getDate() - 29);
    const fromDate = query.fromDate?.trim() || defaultFrom.toISOString().slice(0, 10);
    return { fromDate, toDate };
  }

  private async aggregateProfitLoss(
    filter: Record<string, unknown>,
    groupId: null | '$marketplace' | '$monthKey' | '$sellerId',
  ) {
    const pipeline: PipelineStage[] = [
      { $match: filter },
      {
        $addFields: {
          docUpper: { $toUpper: { $ifNull: ['$documentType', ''] } },
          inv: { $ifNull: ['$invoiceAmount', 0] },
          taxable: { $ifNull: ['$taxableAmount', 0] },
          tax: {
            $add: [
              { $ifNull: ['$igstAmount', 0] },
              { $ifNull: ['$cgstAmount', 0] },
              { $ifNull: ['$sgstAmount', 0] },
            ],
          },
          monthKey: {
            $cond: [
              {
                $regexMatch: {
                  input: { $ifNull: ['$invoiceDate', ''] },
                  regex: /^\d{4}-\d{2}/,
                },
              },
              { $substr: [{ $ifNull: ['$invoiceDate', ''] }, 0, 7] },
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          isSale: {
            $regexMatch: { input: '$docUpper', regex: 'SALE' },
          },
          isReturn: {
            $or: [
              { $regexMatch: { input: '$docUpper', regex: 'RETURN' } },
              { $regexMatch: { input: '$docUpper', regex: 'RTO' } },
            ],
          },
          feePart: {
            $cond: [
              {
                $regexMatch: { input: '$docUpper', regex: 'SALE' },
              },
              {
                $max: [
                  0,
                  {
                    $subtract: [
                      { $subtract: ['$inv', '$taxable'] },
                      '$tax',
                    ],
                  },
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          rowRevenue: { $cond: ['$isSale', '$inv', 0] },
          rowReturns: { $cond: ['$isReturn', '$inv', 0] },
          rowFees: {
            $cond: ['$isSale', { $add: ['$feePart', '$tax'] }, 0],
          },
        },
      },
    ];

    if (groupId === '$monthKey') {
      pipeline.push({ $match: { monthKey: { $ne: null } } });
    }

    pipeline.push({
      $group: {
        _id: groupId,
        revenue: { $sum: '$rowRevenue' },
        returns: { $sum: '$rowReturns' },
        fees: { $sum: '$rowFees' },
        recordCount: { $sum: 1 },
      },
    });

    if (groupId === '$monthKey') {
      pipeline.push({ $sort: { _id: 1 } }, { $limit: 12 });
    } else if (groupId === '$marketplace' || groupId === '$sellerId') {
      pipeline.push({ $sort: { revenue: -1, _id: 1 } });
      if (groupId === '$sellerId') {
        pipeline.push({ $limit: 10 });
      }
    }

    return this.rowModel.aggregate(pipeline).exec();
  }

  private async aggregateCategoryPerformance(filter: Record<string, unknown>) {
    return this.rowModel
      .aggregate<{
        _id: string;
        revenue: number;
        salesCount: number;
      }>([
        { $match: filter },
        {
          $addFields: {
            docUpper: { $toUpper: { $ifNull: ['$documentType', ''] } },
            inv: { $ifNull: ['$invoiceAmount', 0] },
            category: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ['$hsnCode', ''] }, ''] },
                    { $ne: [{ $ifNull: ['$hsnCode', ''] }, null] },
                  ],
                },
                { $toString: '$hsnCode' },
                'Uncategorized',
              ],
            },
          },
        },
        {
          $match: {
            $expr: { $regexMatch: { input: '$docUpper', regex: 'SALE' } },
          },
        },
        {
          $group: {
            _id: '$category',
            revenue: { $sum: '$inv' },
            salesCount: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1, _id: 1 } },
        { $limit: 8 },
      ])
      .exec();
  }

  async getPlatformAnalytics(query: { fromDate?: string; toDate?: string }) {
    const period = this.resolveAnalyticsDateRange(query);
    const filter = await this.buildRowFilter({
      fromDate: period.fromDate,
      toDate: period.toDate,
    });

    const [
      totalsRows,
      monthlyRows,
      marketplaceRows,
      topSellerRows,
      categoryRows,
      sellers,
      totalGsts,
      platformMarketplaces,
      uploadCount,
    ] = await Promise.all([
      this.aggregateProfitLoss(filter, null),
      this.aggregateProfitLoss(filter, '$monthKey'),
      this.aggregateProfitLoss(filter, '$marketplace'),
      this.aggregateProfitLoss(filter, '$sellerId'),
      this.aggregateCategoryPerformance(filter),
      this.sellerModel
        .find()
        .select(
          'fullName email publicId onboardingStatus accountStatus subscriptionStatus paymentAmount amount totalRevenue createdAt',
        )
        .lean()
        .exec(),
      this.gstModel.countDocuments().exec(),
      this.platformMarketplaceModel.find().select('name slug').lean().exec(),
      this.uploadModel.countDocuments().exec(),
    ]);

    const totals = this.mapPlGroup(
      (totalsRows[0] as {
        _id: null;
        revenue: number;
        returns: number;
        fees: number;
        recordCount: number;
      }) ?? {
        _id: null,
        revenue: 0,
        returns: 0,
        fees: 0,
        recordCount: 0,
      },
    );

    const marketplaceNameById = new Map<string, string>();
    for (const mp of platformMarketplaces) {
      const id = String(mp._id ?? '');
      if (id) {
        marketplaceNameById.set(id, String(mp.name ?? mp.slug ?? id));
      }
    }

    const sellerById = new Map<string, (typeof sellers)[number]>();
    for (const seller of sellers) {
      const id = String(seller._id ?? '');
      if (id) sellerById.set(id, seller);
      if (seller.publicId) sellerById.set(String(seller.publicId), seller);
    }

    const activeSellerStatuses = new Set([
      'active',
      'training_completed',
      'approved',
    ]);
    const activeSellers = sellers.filter(
      (seller) =>
        activeSellerStatuses.has(String(seller.onboardingStatus ?? '')) ||
        String(seller.accountStatus ?? '') === 'active',
    ).length;

    const subscriptionRevenue = sellers.reduce(
      (sum, seller) =>
        sum + Number(seller.paymentAmount ?? seller.amount ?? 0),
      0,
    );

    const sellersWithImportRevenue = topSellerRows.filter(
      (row) => Number((row as { revenue?: number }).revenue ?? 0) > 0,
    ).length;

    const avgRevenuePerSeller =
      sellersWithImportRevenue > 0
        ? totals.revenue / sellersWithImportRevenue
        : activeSellers > 0
          ? totals.revenue / activeSellers
          : 0;

    const monthLabel = (monthKey: string) => {
      const [year, month] = monthKey.split('-').map((part) => Number(part));
      if (!year || !month) return monthKey;
      return new Date(year, month - 1, 1).toLocaleString('en-IN', {
        month: 'short',
      });
    };

    return {
      success: true,
      data: {
        period,
        kpis: {
          totalGmv: totals.revenue,
          netProfit: totals.netProfit,
          totalRecords: totals.recordCount,
          activeSellers,
          totalSellers: sellers.length,
          totalGsts,
          avgRevenuePerSeller,
          subscriptionRevenue,
          totalUploads: uploadCount,
          returnRate:
            totals.revenue > 0
              ? Math.round((totals.returns / totals.revenue) * 1000) / 10
              : 0,
        },
        revenueTrend: (
          monthlyRows as Array<{
            _id: string;
            revenue: number;
            returns: number;
            fees: number;
            recordCount: number;
          }>
        ).map((row) => {
          const mapped = this.mapPlGroup(row);
          const month = String(row._id ?? '');
          return {
            month,
            label: monthLabel(month),
            revenue: mapped.revenue,
            profit: mapped.netProfit,
            expenses: mapped.returns + mapped.fees,
          };
        }),
        marketplaceDistribution: (
          marketplaceRows as Array<{
            _id: string;
            revenue: number;
            returns: number;
            fees: number;
            recordCount: number;
          }>
        ).map((row) => {
            const mapped = this.mapPlGroup(row);
            const marketplaceId = String(row._id ?? '');
            return {
              marketplaceId,
              name: marketplaceNameById.get(marketplaceId) ?? marketplaceId,
              revenue: mapped.revenue,
              value: mapped.revenue,
              recordCount: mapped.recordCount,
              netProfit: mapped.netProfit,
            };
          }),
        topSellers: (
          topSellerRows as Array<{
            _id: string;
            revenue: number;
            returns: number;
            fees: number;
            recordCount: number;
          }>
        ).map((row) => {
          const mapped = this.mapPlGroup(row);
          const aggregateKey = String(row._id ?? '');
          const seller = sellerById.get(aggregateKey);
          const mongoSellerId = seller
            ? String(seller._id ?? '')
            : Types.ObjectId.isValid(aggregateKey)
              ? aggregateKey
              : '';
          return {
            sellerId: mongoSellerId,
            publicId: seller?.publicId,
            name: seller?.fullName ?? seller?.email ?? 'Seller',
            revenue: mapped.revenue,
            netProfit: mapped.netProfit,
            recordCount: mapped.recordCount,
          };
        }),
        categoryPerformance: categoryRows.map((row) => ({
          category: String(row._id ?? 'Uncategorized'),
          revenue: Number(row.revenue ?? 0),
          salesCount: Number(row.salesCount ?? 0),
        })),
        onboardingBreakdown: this.buildOnboardingBreakdown(sellers),
      },
    };
  }

  private buildOnboardingBreakdown(
    sellers: Array<{ onboardingStatus?: string }>,
  ) {
    const counts = new Map<string, number>();
    for (const seller of sellers) {
      const status = String(seller.onboardingStatus ?? 'unknown');
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }

  private mapPlGroup(row: {
    _id: string | null;
    revenue: number;
    returns: number;
    fees: number;
    recordCount: number;
  }) {
    const revenue = Number(row.revenue || 0);
    const returns = Number(row.returns || 0);
    const fees = Number(row.fees || 0);
    const netProfit = revenue - returns - fees;
    const margin = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0;
    return {
      revenue,
      returns,
      fees,
      netProfit,
      margin,
      recordCount: Number(row.recordCount || 0),
    };
  }

  async getSellerProfitLossStats(
    query: Pick<
      ListImportedRowsDto,
      'sellerId' | 'gstin' | 'marketplace' | 'fromDate' | 'toDate'
    >,
  ) {
    const filter = await this.buildRowFilter(query);
    const [totalsRows, marketplaceRows, monthlyRows] = await Promise.all([
      this.aggregateProfitLoss(filter, null),
      this.aggregateProfitLoss(filter, '$marketplace'),
      this.aggregateProfitLoss(filter, '$monthKey'),
    ]);

    const totals = this.mapPlGroup(
      (totalsRows[0] as {
        _id: null;
        revenue: number;
        returns: number;
        fees: number;
        recordCount: number;
      }) ?? {
        _id: null,
        revenue: 0,
        returns: 0,
        fees: 0,
        recordCount: 0,
      },
    );

    let comparison:
      | {
          grossRevenueChangePercent: number;
          returnLossChangePercent: number;
          expensesChangePercent: number;
          netProfitChangePercent: number;
        }
      | undefined;

    if (query.fromDate && query.toDate && query.sellerId) {
      const from = new Date(query.fromDate);
      const to = new Date(query.toDate);
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to >= from) {
        const spanMs = to.getTime() - from.getTime() + 86_400_000;
        const prevTo = new Date(from.getTime() - 86_400_000);
        const prevFrom = new Date(prevTo.getTime() - spanMs + 86_400_000);
        const prevFilter = await this.buildRowFilter({
          ...query,
          fromDate: prevFrom.toISOString().slice(0, 10),
          toDate: prevTo.toISOString().slice(0, 10),
        });
        const prevRows = await this.aggregateProfitLoss(prevFilter, null);
        const prev = this.mapPlGroup(
          (prevRows[0] as {
            _id: null;
            revenue: number;
            returns: number;
            fees: number;
            recordCount: number;
          }) ?? {
            _id: null,
            revenue: 0,
            returns: 0,
            fees: 0,
            recordCount: 0,
          },
        );
        const pct = (current: number, previous: number) => {
          if (previous === 0) return current > 0 ? 100 : 0;
          return Math.round(((current - previous) / previous) * 1000) / 10;
        };
        const currentExpenses = totals.returns + totals.fees;
        const prevExpenses = prev.returns + prev.fees;
        comparison = {
          grossRevenueChangePercent: pct(totals.revenue, prev.revenue),
          returnLossChangePercent: pct(totals.returns, prev.returns),
          expensesChangePercent: pct(currentExpenses, prevExpenses),
          netProfitChangePercent: pct(totals.netProfit, prev.netProfit),
        };
      }
    }

    return {
      success: true,
      data: {
        grossRevenue: totals.revenue,
        returnLoss: totals.returns,
        fees: totals.fees,
        totalExpenses: totals.returns + totals.fees,
        netProfit: totals.netProfit,
        profitMargin: totals.margin,
        recordCount: totals.recordCount,
        comparison,
        byMarketplace: (
          marketplaceRows as Array<{
            _id: string;
            revenue: number;
            returns: number;
            fees: number;
            recordCount: number;
          }>
        ).map((row) => ({
          marketplaceId: String(row._id ?? ''),
          ...this.mapPlGroup(row),
        })),
        monthlyTrend: (
          monthlyRows as Array<{
            _id: string;
            revenue: number;
            returns: number;
            fees: number;
            recordCount: number;
          }>
        ).map((row) => {
          const mapped = this.mapPlGroup(row);
          return {
            month: String(row._id ?? ''),
            revenue: mapped.revenue,
            expenses: mapped.returns + mapped.fees,
            profit: mapped.netProfit,
          };
        }),
      },
    };
  }

  async listUploads(sellerId?: string) {
    const filter = sellerId
      ? {
          sellerId: {
            $in: await this.validationService.resolveSellerIdAliases(sellerId),
          },
        }
      : {};
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
