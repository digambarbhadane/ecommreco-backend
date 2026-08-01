import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { TtlCache, cacheKey } from '../common/ttl-cache';
import { ListImportedRowsDto } from './dto/list-imported-rows.dto';
import { ListAnalyticsOrdersDto } from './dto/list-analytics-orders.dto';
import { ListAnalyticsPaymentsDto } from './dto/list-analytics-payments.dto';
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
import {
  applyPaymentFiltersToMongoFilter,
  HAS_PAYMENT_DATA_EXPR,
} from './utils/payment-filter.util';
import { Gst, GstDocument } from '../gsts/schemas/gst.schema';
import {
  PlatformMarketplace,
  PlatformMarketplaceDocument,
} from '../platform-marketplaces/schemas/platform-marketplace.schema';
import { ValidationService } from './services/validation.service';
import type { MarketplaceUploadKey } from './marketplace-upload.routes';
import {
  inferUploadedSlotsFromFileHash,
  isMonthComplete,
  MARKETPLACE_COMPLETION_SLOTS,
  MARKETPLACE_TRACKED_SLOTS,
} from './import-slot.constants';
import { AnalyticsPaymentsService } from './payments/analytics-payments.service';
import { AnalyticsPayoutsService } from './payments/analytics-payouts.service';
import type { ListAnalyticsPayoutsDto } from './dto/list-analytics-payouts.dto';
import type { UpsertPayoutReceiptDto } from './dto/upsert-payout-receipt.dto';
import {
  repairImportRowDates,
} from '../common/utils/repair-legacy-date.util';

@Injectable()
export class ReportImportService {
  // Cache expensive read-only analytics aggregations for 60s.
  private readonly dashboardCache = new TtlCache<string, unknown>(60_000);
  private readonly profitLossCache = new TtlCache<string, unknown>(60_000);
  private readonly platformAnalyticsCache = new TtlCache<string, unknown>(60_000);

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
    private readonly analyticsPaymentsService: AnalyticsPaymentsService,
    private readonly analyticsPayoutsService: AnalyticsPayoutsService,
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

  /** Meesho returns are enriched onto sales rows — hide legacy RETURN documents from list counts. */
  private applyMeeshoImportedDataVisibilityFilter(
    filter: Record<string, unknown>,
    marketplace?: string,
  ) {
    const appliesToMeesho =
      !marketplace || marketplace.trim().toLowerCase() === 'meesho';
    if (!appliesToMeesho) return;

    const visibility = {
      $or: [
        { marketplace: { $ne: 'meesho' } },
        { documentType: { $not: /^RETURN$/i } },
      ],
    };

    if (Array.isArray(filter.$and)) {
      filter.$and.push(visibility);
      return;
    }
    filter.$and = [visibility];
  }

  private async buildImportedRowsFilter(
    query: Pick<
      ListImportedRowsDto,
      | 'sellerId'
      | 'gstin'
      | 'marketplace'
      | 'documentType'
      | 'fromDate'
      | 'toDate'
      | 'search'
      | 'hasPaymentData'
      | 'paymentDateFrom'
      | 'paymentDateTo'
      | 'paymentMode'
    >,
  ) {
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
    applyPaymentFiltersToMongoFilter(filter, query);
    const search = String(query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchClause = {
        $or: [
          { orderID: { $regex: escaped, $options: 'i' } },
          { documentType: { $regex: escaped, $options: 'i' } },
          { gstin: { $regex: escaped, $options: 'i' } },
          { invoiceNo: { $regex: escaped, $options: 'i' } },
          { skuID: { $regex: escaped, $options: 'i' } },
        ],
      };
      if (Array.isArray(filter.$and)) {
        filter.$and.push(searchClause);
      } else {
        filter.$and = [searchClause];
      }
    }
    this.applyMeeshoImportedDataVisibilityFilter(filter, query.marketplace);
    return filter;
  }

  async listImportedRows(query: ListImportedRowsDto) {
    const filter = await this.buildImportedRowsFilter(query);
    const limit = Math.max(0, Number(query.limit ?? '50'));
    const skip = Math.max(0, Number(query.skip ?? '0'));
    const sortBy = query.sortBy ?? 'documentType';
    const sortOrder = query.sortOrder === 'desc' ? -1 : 1;

    const facetResult = await this.rowModel
      .aggregate<{
        data: ImportRowDocument[];
        total: { count: number }[];
      }>([
        { $match: filter },
        {
          $facet: {
            data: [
              { $sort: { [sortBy]: sortOrder } },
              { $skip: skip },
              { $limit: limit },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .option({ maxTimeMS: 30_000, allowDiskUse: true })
      .exec();

    const bucket = facetResult[0] ?? { data: [], total: [] };
    const data = (bucket.data ?? []).map((row) =>
      repairImportRowDates(row as unknown as Record<string, unknown>),
    );
    const total = bucket.total[0]?.count ?? 0;

    return {
      success: true,
      data,
      total,
      limit,
      skip,
    };
  }

  async listAnalyticsOrders(query: ListAnalyticsOrdersDto) {
    return this.listImportedRows({
      ...query,
      hasPaymentData: undefined,
      paymentDateFrom: undefined,
      paymentDateTo: undefined,
      paymentMode: undefined,
    });
  }

  private async buildAnalyticsPaymentsFilter(
    query: Pick<
      ListAnalyticsPaymentsDto,
      | 'sellerId'
      | 'gstin'
      | 'marketplace'
      | 'documentType'
      | 'fromDate'
      | 'toDate'
      | 'paymentDateFrom'
      | 'paymentDateTo'
      | 'paymentMode'
      | 'search'
    >,
  ) {
    const filter = await this.buildImportedRowsFilter({
      sellerId: query.sellerId,
      gstin: query.gstin,
      marketplace: query.marketplace,
      documentType: query.documentType,
      fromDate: query.fromDate,
      toDate: query.toDate,
      hasPaymentData: 'yes',
      paymentDateFrom: query.paymentDateFrom,
      paymentDateTo: query.paymentDateTo,
      paymentMode: query.paymentMode,
    });

    const search = String(query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchClause = {
        $or: [
          { orderID: { $regex: escaped, $options: 'i' } },
          { transactionId: { $regex: escaped, $options: 'i' } },
          { paymentMode: { $regex: escaped, $options: 'i' } },
          { gstin: { $regex: escaped, $options: 'i' } },
          { invoiceNo: { $regex: escaped, $options: 'i' } },
        ],
      };
      if (Array.isArray(filter.$and)) {
        filter.$and.push(searchClause);
      } else {
        filter.$and = [searchClause];
      }
    }

    return filter;
  }

  async listAnalyticsPayments(query: ListAnalyticsPaymentsDto) {
    return this.analyticsPaymentsService.listPayments(query);
  }

  async listAnalyticsPayouts(query: ListAnalyticsPayoutsDto) {
    return this.analyticsPayoutsService.listPayouts(query);
  }

  async upsertPayoutReceipt(dto: UpsertPayoutReceiptDto, updatedBy?: string) {
    return this.analyticsPayoutsService.upsertReceipt(dto, updatedBy);
  }

  async resetPayoutReceipt(
    dto: { sellerId: string; marketplace: string; neftId: string; gstin?: string },
    updatedBy?: string,
  ) {
    return this.analyticsPayoutsService.resetReceipt(dto, updatedBy);
  }

  async exportAnalyticsOrdersCsv(
    query: ListAnalyticsOrdersDto,
  ): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
    const filter = await this.buildImportedRowsFilter({
      ...query,
      hasPaymentData: undefined,
      paymentDateFrom: undefined,
      paymentDateTo: undefined,
      paymentMode: undefined,
    });
    const sortBy = query.sortBy ?? 'invoiceDate';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const maxRows = 100_000;

    const rows = await this.rowModel
      .find(filter)
      .sort({ [sortBy]: sortOrder })
      .limit(maxRows)
      .lean()
      .exec();

    const headers = [
      'GSTIN',
      'Document Type',
      'Order ID',
      'Invoice Date',
      'Invoice No',
      'Invoice Amount',
      'Taxable Amount',
      'IGST',
      'CGST',
      'SGST',
      'Quantity',
      'SKU',
      'Marketplace',
      'State',
    ];

    const escapeCsv = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };

    const lines = rows.map((row) => {
      const repaired = repairImportRowDates(
        row as unknown as Record<string, unknown>,
      );
      return [
        repaired.gstin,
        repaired.documentType,
        repaired.orderID,
        repaired.invoiceDate,
        repaired.invoiceNo,
        repaired.invoiceAmount,
        repaired.taxableAmount,
        repaired.igstAmount,
        repaired.cgstAmount,
        repaired.sgstAmount,
        repaired.quantity,
        repaired.skuID,
        repaired.marketplace,
        repaired.stateName,
      ]
        .map(escapeCsv)
        .join(',');
    });

    const csv = [headers.join(','), ...lines].join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      buffer: Buffer.from(csv, 'utf-8'),
      filename: `analytics-orders-${stamp}.csv`,
      rowCount: rows.length,
    };
  }

  async exportAnalyticsPaymentsCsv(
    query: ListAnalyticsPaymentsDto,
  ): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
    return this.analyticsPaymentsService.exportCsv(query);
  }

  async exportImportedRowsCsv(
    query: ListImportedRowsDto,
  ): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
    const filter = await this.buildImportedRowsFilter(query);
    const sortBy = query.sortBy ?? 'invoiceDate';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const maxRows = 100_000;

    const rows = await this.rowModel
      .find(filter)
      .sort({ [sortBy]: sortOrder })
      .limit(maxRows)
      .lean()
      .exec();

    const headers = [
      'GSTIN',
      'Document Type',
      'Order ID',
      'Invoice Date',
      'Invoice No',
      'Invoice Amount',
      'Taxable Amount',
      'IGST',
      'CGST',
      'SGST',
      'Quantity',
      'SKU',
      'Order Packed Date',
      'Order Cancel Date',
      'FR Refunded Date',
      'Marketplace',
      'Payment Mode',
      'Payment Date',
      'Final Settlement',
      'Transaction ID',
      'State',
    ];

    const escapeCsv = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };

    const lines = rows.map((row) => {
      const repaired = repairImportRowDates(
        row as unknown as Record<string, unknown>,
      );
      return [
        repaired.gstin,
        repaired.documentType,
        repaired.orderID,
        repaired.invoiceDate,
        repaired.invoiceNo,
        repaired.invoiceAmount,
        repaired.taxableAmount,
        repaired.igstAmount,
        repaired.cgstAmount,
        repaired.sgstAmount,
        repaired.quantity,
        repaired.skuID,
        repaired.order_packed_date,
        repaired.orderCancelDate,
        repaired.frRefundedDate,
        repaired.marketplace,
        repaired.paymentMode,
        repaired.paymentDate,
        repaired.finalSettlementAmount,
        repaired.transactionId,
        repaired.stateName,
      ]
        .map(escapeCsv)
        .join(',');
    });

    const csv = [headers.join(','), ...lines].join('\n');
    const stamp = new Date().toISOString().slice(0, 10);

    return {
      buffer: Buffer.from(csv, 'utf-8'),
      filename: `analytics-export-${stamp}.csv`,
      rowCount: rows.length,
    };
  }

  async getDocumentTypeSummary(
    query: Pick<
      ListImportedRowsDto,
      | 'sellerId'
      | 'gstin'
      | 'marketplace'
      | 'fromDate'
      | 'toDate'
      | 'hasPaymentData'
      | 'paymentDateFrom'
      | 'paymentDateTo'
      | 'paymentMode'
    >,
  ) {
    const filter = await this.buildImportedRowsFilter({
      ...query,
      documentType: undefined,
      search: undefined,
    });

    const facetResult = await this.rowModel
      .aggregate<{
        byDocumentType: Array<{ _id: string; count: number }>;
        paymentStats: Array<{
          rowsWithPaymentData: number;
          rowsMissingPaymentData: number;
          totalSettlementAmount: number;
          rowsWithPaymentMode: number;
        }>;
      }>([
        { $match: filter },
        {
          $facet: {
            byDocumentType: [
              {
                $group: {
                  _id: { $ifNull: ['$documentType', 'Unknown'] },
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1, _id: 1 } },
            ],
            paymentStats: [
              {
                $group: {
                  _id: null,
                  rowsWithPaymentData: {
                    $sum: {
                      $cond: [HAS_PAYMENT_DATA_EXPR, 1, 0],
                    },
                  },
                  rowsMissingPaymentData: {
                    $sum: {
                      $cond: [HAS_PAYMENT_DATA_EXPR, 0, 1],
                    },
                  },
                  totalSettlementAmount: {
                    $sum: { $ifNull: ['$finalSettlementAmount', 0] },
                  },
                  rowsWithPaymentMode: {
                    $sum: {
                      $cond: [
                        {
                          $gt: [
                            {
                              $strLenCP: {
                                $trim: {
                                  input: { $ifNull: ['$paymentMode', ''] },
                                },
                              },
                            },
                            0,
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      ])
      .exec();

    const facet = facetResult[0] ?? {
      byDocumentType: [],
      paymentStats: [],
    };
    const groups = facet.byDocumentType ?? [];
    const paymentStats = facet.paymentStats[0] ?? {
      rowsWithPaymentData: 0,
      rowsMissingPaymentData: 0,
      totalSettlementAmount: 0,
      rowsWithPaymentMode: 0,
    };

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
        paymentOverview: {
          rowsWithPaymentData: Number(paymentStats.rowsWithPaymentData ?? 0),
          rowsMissingPaymentData: Number(paymentStats.rowsMissingPaymentData ?? 0),
          totalSettlementAmount: Number(paymentStats.totalSettlementAmount ?? 0),
          rowsWithPaymentMode: Number(paymentStats.rowsWithPaymentMode ?? 0),
        },
      },
    };
  }

  async getAnalyticsOrdersSummary(
    query: Pick<
      ListAnalyticsOrdersDto,
      'sellerId' | 'gstin' | 'marketplace' | 'fromDate' | 'toDate'
    >,
  ) {
    const result = await this.getDocumentTypeSummary({
      ...query,
      hasPaymentData: undefined,
      paymentDateFrom: undefined,
      paymentDateTo: undefined,
      paymentMode: undefined,
    });
    const data = result.data as {
      totalSalesCount: number;
      totalReturnsCount: number;
      totalCancelledCount: number;
      byDocumentType: Array<{ documentType: string; count: number }>;
    };
    return {
      success: true,
      data: {
        totalSalesCount: data.totalSalesCount,
        totalReturnsCount: data.totalReturnsCount,
        totalCancelledCount: data.totalCancelledCount,
        byDocumentType: data.byDocumentType,
      },
    };
  }

  async getAnalyticsPaymentsSummary(
    query: Pick<
      ListAnalyticsPaymentsDto,
      | 'sellerId'
      | 'gstin'
      | 'marketplace'
      | 'fromDate'
      | 'toDate'
      | 'paymentDateFrom'
      | 'paymentDateTo'
      | 'paymentMode'
    >,
  ) {
    return this.analyticsPaymentsService.getSummary(query);
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
    const ck = cacheKey(
      `dash:${query.sellerId ?? ''}:${query.gstin ?? ''}:${query.fromDate ?? ''}:${query.toDate ?? ''}`,
    );
    const cached = this.dashboardCache.get(ck);
    if (cached !== undefined) return { success: true, data: cached };

    const filter = await this.buildRowFilter(query);
    const data = await this.aggregateSellerDashboardData(filter, query);
    this.dashboardCache.set(ck, data);
    return { success: true, data };
  }

  async getSellerAnalyticsBundle(
    query: Pick<
      ListImportedRowsDto,
      'sellerId' | 'gstin' | 'fromDate' | 'toDate'
    >,
  ) {
    const dashCk = cacheKey(
      `dash:${query.sellerId ?? ''}:${query.gstin ?? ''}:${query.fromDate ?? ''}:${query.toDate ?? ''}`,
    );
    const plCk = cacheKey(
      `pl:${query.sellerId ?? ''}:${query.gstin ?? ''}::${query.fromDate ?? ''}:${query.toDate ?? ''}`,
    );
    const cachedDash = this.dashboardCache.get(dashCk);
    const cachedPl = this.profitLossCache.get(plCk);

    if (cachedDash !== undefined && cachedPl !== undefined) {
      return { success: true, data: { dashboard: cachedDash, profitLoss: cachedPl } };
    }

    const filter = await this.buildRowFilter(query);
    const [dashboard, profitLoss] = await Promise.all([
      cachedDash !== undefined
        ? Promise.resolve(cachedDash)
        : this.aggregateSellerDashboardData(filter, query),
      cachedPl !== undefined
        ? Promise.resolve(cachedPl)
        : this.buildProfitLossPayload(filter, query),
    ]);

    if (cachedDash === undefined) this.dashboardCache.set(dashCk, dashboard);
    if (cachedPl === undefined) this.profitLossCache.set(plCk, profitLoss);

    return {
      success: true,
      data: { dashboard, profitLoss },
    };
  }

  private async aggregateSellerDashboardData(
    filter: Record<string, unknown>,
    query: Pick<
      ListImportedRowsDto,
      'sellerId' | 'gstin' | 'fromDate' | 'toDate'
    >,
  ) {
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

    const [facetRows, recentUploads] = await Promise.all([
      this.rowModel
        .aggregate<{
          totals: Array<{
            totalRecords: number;
            totalInvoiceAmount: number;
            totalSalesCount: number;
            totalReturnsCount: number;
            totalCancelledCount: number;
            totalSalesAmount: number;
            totalReturnsAmount: number;
          }>;
          marketplaces: Array<{
            marketplaceId: string;
            totalCount: number;
            salesCount: number;
            returnsCount: number;
            invoiceAmount: number;
            salesAmount: number;
          }>;
          monthly: Array<{
            month: string;
            totalCount: number;
            salesCount: number;
            returnsCount: number;
          }>;
          gstins: Array<{ gstin: string }>;
        }>([
          { $match: filter },
          {
            $facet: {
              totals: [
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
              ],
              marketplaces: [
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
              ],
              monthly: [
                {
                  $addFields: {
                    // Returns (RTO/Customer Return) don't carry an invoiceDate —
                    // bucket them by their own return date so they aren't
                    // silently dropped from month-wise totals.
                    effectiveDate: {
                      $ifNull: [
                        '$invoiceDate',
                        { $ifNull: ['$orderCancelDate', '$frRefundedDate'] },
                      ],
                    },
                  },
                },
                {
                  $match: {
                    effectiveDate: { $exists: true, $nin: [null, ''] },
                  },
                },
                {
                  $addFields: {
                    month: { $substr: ['$effectiveDate', 0, 7] },
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
              ],
              gstins: [
                { $group: { _id: '$gstin' } },
                { $project: { _id: 0, gstin: '$_id' } },
              ],
            },
          },
        ])
        .option({ maxTimeMS: 45_000, allowDiskUse: true })
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

    const facet = facetRows[0] ?? {
      totals: [],
      marketplaces: [],
      monthly: [],
      gstins: [],
    };
    const totalsRows = facet.totals;
    const marketplaceRows = facet.marketplaces;
    const monthlyRows = facet.monthly;
    const gstinRows = facet.gstins;

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

  private profitLossBaseStages(): PipelineStage[] {
    return [
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
            $let: {
              vars: {
                // Returns (RTO/Customer Return) don't carry an invoiceDate —
                // fall back to their own return date so they still land in
                // the month they were actually returned in.
                effectiveDate: {
                  $ifNull: [
                    '$invoiceDate',
                    { $ifNull: ['$orderCancelDate', '$frRefundedDate'] },
                  ],
                },
              },
              in: {
                $cond: [
                  {
                    $regexMatch: {
                      input: { $ifNull: ['$$effectiveDate', ''] },
                      regex: /^\d{4}-\d{2}/,
                    },
                  },
                  { $substr: [{ $ifNull: ['$$effectiveDate', ''] }, 0, 7] },
                  null,
                ],
              },
            },
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
  }

  private profitLossGroupStages(
    groupId: null | '$marketplace' | '$monthKey' | '$sellerId',
  ): PipelineStage[] {
    const stages: PipelineStage[] = [];
    if (groupId === '$monthKey') {
      stages.push({ $match: { monthKey: { $ne: null } } });
    }
    stages.push({
      $group: {
        _id: groupId,
        revenue: { $sum: '$rowRevenue' },
        returns: { $sum: '$rowReturns' },
        fees: { $sum: '$rowFees' },
        recordCount: { $sum: 1 },
      },
    });
    if (groupId === '$monthKey') {
      stages.push({ $sort: { _id: 1 } }, { $limit: 12 });
    } else if (groupId === '$marketplace' || groupId === '$sellerId') {
      stages.push({ $sort: { revenue: -1, _id: 1 } });
      if (groupId === '$sellerId') {
        stages.push({ $limit: 10 });
      }
    }
    return stages;
  }

  private async aggregateProfitLossFacet(
    filter: Record<string, unknown>,
    branches: Array<'totals' | 'marketplaces' | 'monthly' | 'topSellers' | 'categories'>,
  ) {
    const groupByBranch: Record<
      (typeof branches)[number],
      null | '$marketplace' | '$monthKey' | '$sellerId'
    > = {
      totals: null,
      marketplaces: '$marketplace',
      monthly: '$monthKey',
      topSellers: '$sellerId',
      categories: null,
    };

    const facet: Record<string, PipelineStage[]> = {};
    for (const branch of branches) {
      if (branch === 'categories') {
        facet.categories = [
          {
            $addFields: {
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
        ];
      } else {
        facet[branch] = this.profitLossGroupStages(groupByBranch[branch]);
      }
    }

    const [result] = await this.rowModel
      .aggregate<Record<string, unknown[]>>([
        { $match: filter },
        ...this.profitLossBaseStages(),
        { $facet: facet } as PipelineStage,
      ])
      .option({ maxTimeMS: 45_000, allowDiskUse: true })
      .exec();

    return result ?? {};
  }

  /** @deprecated Use aggregateProfitLossFacet for multi-branch reads. */
  private async aggregateProfitLoss(
    filter: Record<string, unknown>,
    groupId: null | '$marketplace' | '$monthKey' | '$sellerId',
  ) {
    const branch =
      groupId === null
        ? 'totals'
        : groupId === '$marketplace'
          ? 'marketplaces'
          : groupId === '$monthKey'
            ? 'monthly'
            : 'topSellers';
    const facet = await this.aggregateProfitLossFacet(filter, [branch]);
    return facet[branch] ?? [];
  }

  /** @deprecated Use aggregateProfitLossFacet with categories branch. */
  private async aggregateCategoryPerformance(filter: Record<string, unknown>) {
    const facet = await this.aggregateProfitLossFacet(filter, ['categories']);
    return facet.categories ?? [];
  }

  async getPlatformAnalytics(query: { fromDate?: string; toDate?: string }) {
    const period = this.resolveAnalyticsDateRange(query);
    const ck = cacheKey(`platform:${period.fromDate}:${period.toDate}`);
    const cached = this.platformAnalyticsCache.get(ck);
    if (cached !== undefined) return cached;

    const filter = await this.buildRowFilter({
      fromDate: period.fromDate,
      toDate: period.toDate,
    });

    const [
      plFacet,
      sellerSummaryRows,
      onboardingRows,
      platformMarketplaces,
      totalGsts,
      uploadCount,
    ] = await Promise.all([
      this.aggregateProfitLossFacet(filter, [
        'totals',
        'monthly',
        'marketplaces',
        'topSellers',
        'categories',
      ]),
      this.sellerModel
        .aggregate<{
          totalSellers: number;
          activeSellers: number;
          subscriptionRevenue: number;
        }>([
          {
            $group: {
              _id: null,
              totalSellers: { $sum: 1 },
              activeSellers: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        {
                          $in: [
                            '$onboardingStatus',
                            ['active', 'training_completed', 'approved'],
                          ],
                        },
                        { $eq: ['$accountStatus', 'active'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              subscriptionRevenue: {
                $sum: {
                  $ifNull: ['$paymentAmount', { $ifNull: ['$amount', 0] }],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              totalSellers: 1,
              activeSellers: 1,
              subscriptionRevenue: 1,
            },
          },
        ])
        .exec(),
      this.sellerModel
        .aggregate<{ status: string; count: number }>([
          {
            $group: {
              _id: { $ifNull: ['$onboardingStatus', 'unknown'] },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, status: '$_id', count: 1 } },
          { $sort: { count: -1 } },
        ])
        .exec(),
      this.platformMarketplaceModel.find().select('name slug').lean().exec(),
      this.gstModel.estimatedDocumentCount().exec(),
      this.uploadModel.estimatedDocumentCount().exec(),
    ]);

    const totalsRows = (plFacet.totals ?? []) as Array<{
      _id: null;
      revenue: number;
      returns: number;
      fees: number;
      recordCount: number;
    }>;
    const monthlyRows = (plFacet.monthly ?? []) as Array<{
      _id: string;
      revenue: number;
      returns: number;
      fees: number;
      recordCount: number;
    }>;
    const marketplaceRows = (plFacet.marketplaces ?? []) as Array<{
      _id: string;
      revenue: number;
      returns: number;
      fees: number;
      recordCount: number;
    }>;
    const topSellerRows = (plFacet.topSellers ?? []) as Array<{
      _id: string;
      revenue: number;
      returns: number;
      fees: number;
      recordCount: number;
    }>;
    const categoryRows = (plFacet.categories ?? []) as Array<{
      _id: string;
      revenue: number;
      salesCount: number;
    }>;

    const totals = this.mapPlGroup(
      totalsRows[0] ?? {
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

    const topSellerKeys = topSellerRows
      .map((row) => String(row._id ?? ''))
      .filter(Boolean);
    const sellerObjectIds = topSellerKeys.filter((id) =>
      Types.ObjectId.isValid(id),
    );
    const sellers = sellerObjectIds.length
      ? await this.sellerModel
          .find({
            $or: [
              { _id: { $in: sellerObjectIds } },
              { publicId: { $in: topSellerKeys } },
            ],
          })
          .select(
            'fullName email publicId onboardingStatus accountStatus subscriptionStatus paymentAmount amount totalRevenue createdAt',
          )
          .lean()
          .exec()
      : [];

    const sellerById = new Map<string, (typeof sellers)[number]>();
    for (const seller of sellers) {
      const id = String(seller._id ?? '');
      if (id) sellerById.set(id, seller);
      if (seller.publicId) sellerById.set(String(seller.publicId), seller);
    }

    const sellerSummary = sellerSummaryRows[0] ?? {
      totalSellers: 0,
      activeSellers: 0,
      subscriptionRevenue: 0,
    };
    const activeSellers = Number(sellerSummary.activeSellers || 0);
    const subscriptionRevenue = Number(sellerSummary.subscriptionRevenue || 0);

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

    const result = {
      success: true,
      data: {
        period,
        kpis: {
          totalGmv: totals.revenue,
          netProfit: totals.netProfit,
          totalRecords: totals.recordCount,
          activeSellers,
          totalSellers: Number(sellerSummary.totalSellers || 0),
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
        onboardingBreakdown: onboardingRows,
      },
    };
    this.platformAnalyticsCache.set(ck, result);
    return result;
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
    const ck = cacheKey(
      `pl:${query.sellerId ?? ''}:${query.gstin ?? ''}:${query.marketplace ?? ''}:${query.fromDate ?? ''}:${query.toDate ?? ''}`,
    );
    const cached = this.profitLossCache.get(ck);
    if (cached !== undefined) return { success: true, data: cached };

    const filter = await this.buildRowFilter(query);
    const data = await this.buildProfitLossPayload(filter, query);
    this.profitLossCache.set(ck, data);
    return { success: true, data };
  }

  private async buildProfitLossPayload(
    filter: Record<string, unknown>,
    query: Pick<
      ListImportedRowsDto,
      'sellerId' | 'gstin' | 'marketplace' | 'fromDate' | 'toDate'
    >,
  ) {
    const plFacet = await this.aggregateProfitLossFacet(filter, [
      'totals',
      'marketplaces',
      'monthly',
    ]);
    const totalsRows = (plFacet.totals ?? []) as Array<{
      _id: null;
      revenue: number;
      returns: number;
      fees: number;
      recordCount: number;
    }>;
    const marketplaceRows = (plFacet.marketplaces ?? []) as Array<{
      _id: string;
      revenue: number;
      returns: number;
      fees: number;
      recordCount: number;
    }>;
    const monthlyRows = (plFacet.monthly ?? []) as Array<{
      _id: string;
      revenue: number;
      returns: number;
      fees: number;
      recordCount: number;
    }>;

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

  async getMonthUploadStatus(query: {
    sellerId: string;
    gstId: string;
    marketplaceId: string;
    marketplace: MarketplaceUploadKey;
    reportMonth?: string;
  }) {
    const sellerId = String(query.sellerId ?? '').trim();
    const gstId = String(query.gstId ?? '').trim();
    const marketplaceId = String(query.marketplaceId ?? '').trim();
    const marketplace = query.marketplace;

    if (!sellerId || !gstId || !marketplaceId) {
      throw new BadRequestException(
        'sellerId, gstId, and marketplaceId are required',
      );
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const uploads = await this.uploadModel
      .find({
        sellerId: { $in: sellerAliases },
        gstId,
        marketplace: marketplaceId,
        status: 'completed',
        reportMonth: { $exists: true, $nin: [null, ''] },
      })
      .select('reportMonth uploadedSlots fileHash')
      .lean()
      .exec();

    const monthSlots = new Map<string, Set<string>>();
    for (const upload of uploads) {
      const month = String(upload.reportMonth ?? '').trim();
      if (!month) continue;
      if (!monthSlots.has(month)) {
        monthSlots.set(month, new Set());
      }
      const bucket = monthSlots.get(month)!;
      const stored = Array.isArray(upload.uploadedSlots)
        ? upload.uploadedSlots
        : [];
      if (stored.length > 0) {
        stored.forEach((slot) => bucket.add(String(slot)));
      } else {
        inferUploadedSlotsFromFileHash(String(upload.fileHash ?? '')).forEach(
          (slot) => bucket.add(slot),
        );
      }
    }

    const months = [...monthSlots.entries()]
      .map(([reportMonth, uploadedSet]) => {
        const uploadedSlots = [...uploadedSet].sort();
        return {
          reportMonth,
          uploadedSlots,
          isComplete: isMonthComplete(marketplace, uploadedSet),
        };
      })
      .sort((a, b) => b.reportMonth.localeCompare(a.reportMonth));

    const selectedReportMonth = query.reportMonth?.trim();
    const selectedMonth = selectedReportMonth
      ? months.find((m) => m.reportMonth === selectedReportMonth) ?? {
          reportMonth: selectedReportMonth,
          uploadedSlots: [] as string[],
          isComplete: false,
        }
      : undefined;

    return {
      success: true,
      data: {
        marketplace,
        trackedSlots: MARKETPLACE_TRACKED_SLOTS[marketplace] ?? [],
        completionSlots: MARKETPLACE_COMPLETION_SLOTS[marketplace] ?? [],
        months,
        selectedMonth,
      },
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
