import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { ListAnalyticsPaymentsDto } from '../dto/list-analytics-payments.dto';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import { ValidationService } from '../services/validation.service';
import { FlipkartPaymentRepository } from './flipkart/flipkart-payment.repository';
import {
  mapFlipkartPaymentToAnalyticsRow,
  mapImportRowToPaymentAnalyticsRow,
  type PaymentAnalyticsRow,
} from './payment-analytics.types';
import { applyPaymentFiltersToMongoFilter } from '../utils/payment-filter.util';

const FLIPKART_SORT_FIELDS = new Set([
  'paymentDate',
  'bankSettlementValue',
  'neftId',
  'orderId',
  'saleAmount',
  'marketplaceFee',
  'commission',
  'invoiceDate',
  'sellerSku',
]);

@Injectable()
export class AnalyticsPaymentsService {
  constructor(
    private readonly flipkartPaymentRepository: FlipkartPaymentRepository,
    private readonly validationService: ValidationService,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
  ) {}

  async listPayments(query: ListAnalyticsPaymentsDto) {
    const sellerId = String(query.sellerId ?? '').trim();
    if (!sellerId) {
      return { success: true, data: [], total: 0, limit: 0, skip: 0, source: 'none' };
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const limit = Math.max(0, Number(query.limit ?? '50'));
    const skip = Math.max(0, Number(query.skip ?? '0'));

    const useLegacy = await this.shouldUseLegacyImportRows(query, sellerAliases);

    if (useLegacy) {
      return this.listLegacyImportRowPayments(query, sellerAliases, limit, skip);
    }

    const sortBy = FLIPKART_SORT_FIELDS.has(String(query.sortBy ?? ''))
      ? (query.sortBy as string)
      : 'paymentDate';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const result = await this.flipkartPaymentRepository.findBySeller({
      sellerIds: sellerAliases,
      gstin: query.gstin,
      marketplace: query.marketplace,
      paymentDateFrom: query.paymentDateFrom,
      paymentDateTo: query.paymentDateTo,
      search: query.search,
      skip,
      limit,
      sortBy,
      sortOrder,
    });

    return {
      success: true,
      data: result.data.map((doc) =>
        mapFlipkartPaymentToAnalyticsRow(
          doc as Parameters<typeof mapFlipkartPaymentToAnalyticsRow>[0],
        ),
      ),
      total: result.total,
      limit,
      skip,
      source: 'flipkart_payment_reports' as const,
    };
  }

  async getSummary(
    query: Pick<
      ListAnalyticsPaymentsDto,
      | 'sellerId'
      | 'gstin'
      | 'marketplace'
      | 'paymentDateFrom'
      | 'paymentDateTo'
      | 'paymentMode'
    >,
  ) {
    const sellerId = String(query.sellerId ?? '').trim();
    if (!sellerId) {
      return {
        success: true,
        data: {
          totalRows: 0,
          totalSettlementAmount: 0,
          uniqueNeftCount: 0,
          rowsWithPaymentMode: 0,
          byPaymentMode: [],
        },
      };
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const useLegacy = await this.shouldUseLegacyImportRows(
      { ...query, sellerId },
      sellerAliases,
    );

    if (useLegacy) {
      return this.getLegacyImportRowSummary(query, sellerAliases);
    }

    const summary = await this.flipkartPaymentRepository.aggregateAnalyticsSummary({
      sellerIds: sellerAliases,
      gstin: query.gstin,
      marketplace: query.marketplace,
      paymentDateFrom: query.paymentDateFrom,
      paymentDateTo: query.paymentDateTo,
    });

    return {
      success: true,
      data: {
        totalRows: summary.totalRows,
        totalSettlementAmount: summary.totalSettlementAmount,
        uniqueNeftCount: summary.uniqueNeftCount,
        rowsWithPaymentMode: summary.rowsWithNeftType,
        byPaymentMode: summary.byNeftType,
      },
    };
  }

  async exportCsv(
    query: ListAnalyticsPaymentsDto,
  ): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
    const list = await this.listPayments({
      ...query,
      limit: '100000',
      skip: '0',
    });
    const rows = (list.data ?? []) as PaymentAnalyticsRow[];

    const headers = [
      'Order ID',
      'Order Item ID',
      'NEFT ID',
      'NEFT Type',
      'Payment Date',
      'Bank Settlement',
      'Sale Amount',
      'Marketplace Fee',
      'Commission',
      'Refund',
      'Seller SKU',
      'Quantity',
      'Invoice ID',
      'Invoice Date',
      'GSTIN',
      'Report Month',
      'Marketplace',
    ];

    const escapeCsv = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };

    const lines = rows.map((row) =>
      [
        row.orderId,
        row.orderItemId,
        row.neftId,
        row.neftType,
        row.paymentDate,
        row.bankSettlementValue,
        row.saleAmount,
        row.marketplaceFee,
        row.commission,
        row.refund,
        row.sellerSku,
        row.quantity,
        row.invoiceId,
        row.invoiceDate,
        row.gstin,
        row.reportMonth,
        row.marketplace,
      ]
        .map(escapeCsv)
        .join(','),
    );

    const csv = [headers.join(','), ...lines].join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      buffer: Buffer.from(csv, 'utf-8'),
      filename: `analytics-payments-${stamp}.csv`,
      rowCount: rows.length,
    };
  }

  private async shouldUseLegacyImportRows(
    query: Pick<ListAnalyticsPaymentsDto, 'marketplace' | 'sellerId'>,
    sellerAliases: string[],
  ): Promise<boolean> {
    const marketplace = String(query.marketplace ?? '').trim();
    if (!marketplace) {
      const flipkartCount = await this.flipkartPaymentRepository.countByFilter({
        sellerIds: sellerAliases,
      });
      return flipkartCount === 0;
    }

    const collectionCount = await this.flipkartPaymentRepository.countByFilter({
      sellerIds: sellerAliases,
      marketplace,
    });
    return collectionCount === 0;
  }

  private async buildLegacyFilter(
    query: ListAnalyticsPaymentsDto,
    sellerAliases: string[],
  ) {
    const filter: Record<string, unknown> = {};
    filter.sellerId = { $in: sellerAliases };
    if (query.gstin) filter.gstin = query.gstin.trim().toUpperCase();
    if (query.marketplace) filter.marketplace = query.marketplace;
    applyPaymentFiltersToMongoFilter(filter, {
      hasPaymentData: 'yes',
      paymentDateFrom: query.paymentDateFrom,
      paymentDateTo: query.paymentDateTo,
      paymentMode: query.paymentMode,
    });
    const search = String(query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$and = [
        {
          $or: [
            { orderID: { $regex: escaped, $options: 'i' } },
            { transactionId: { $regex: escaped, $options: 'i' } },
            { paymentMode: { $regex: escaped, $options: 'i' } },
          ],
        },
      ];
    }
    return filter;
  }

  private async listLegacyImportRowPayments(
    query: ListAnalyticsPaymentsDto,
    sellerAliases: string[],
    limit: number,
    skip: number,
  ) {
    const filter = await this.buildLegacyFilter(query, sellerAliases);
    const sortBy = query.sortBy ?? 'paymentDate';
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
    return {
      success: true,
      data: (bucket.data ?? []).map((row) => mapImportRowToPaymentAnalyticsRow(row)),
      total: bucket.total[0]?.count ?? 0,
      limit,
      skip,
      source: 'import_rows' as const,
    };
  }

  private async getLegacyImportRowSummary(
    query: Pick<
      ListAnalyticsPaymentsDto,
      'gstin' | 'marketplace' | 'paymentDateFrom' | 'paymentDateTo' | 'paymentMode'
    >,
    sellerAliases: string[],
  ) {
    const filter = await this.buildLegacyFilter(
      { ...query, sellerId: sellerAliases[0] },
      sellerAliases,
    );

    const facetResult = await this.rowModel
      .aggregate<{
        totals: Array<{
          totalRows: number;
          totalSettlementAmount: number;
          uniqueNeftCount: number;
          rowsWithPaymentMode: number;
        }>;
        byPaymentMode: Array<{ _id: string; count: number; settlement: number }>;
      }>([
        { $match: filter },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  totalRows: { $sum: 1 },
                  totalSettlementAmount: {
                    $sum: { $ifNull: ['$finalSettlementAmount', 0] },
                  },
                  uniqueNeftCount: {
                    $addToSet: {
                      $trim: { input: { $ifNull: ['$transactionId', ''] } },
                    },
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
              {
                $project: {
                  _id: 0,
                  totalRows: 1,
                  totalSettlementAmount: 1,
                  rowsWithPaymentMode: 1,
                  uniqueNeftCount: {
                    $size: {
                      $filter: {
                        input: '$uniqueNeftCount',
                        as: 'neft',
                        cond: { $gt: [{ $strLenCP: '$$neft' }, 0] },
                      },
                    },
                  },
                },
              },
            ],
            byPaymentMode: [
              {
                $group: {
                  _id: {
                    $trim: {
                      input: { $ifNull: ['$paymentMode', 'Unknown'] },
                    },
                  },
                  count: { $sum: 1 },
                  settlement: {
                    $sum: { $ifNull: ['$finalSettlementAmount', 0] },
                  },
                },
              },
              { $sort: { count: -1, _id: 1 } },
            ],
          },
        },
      ])
      .exec();

    const facet = facetResult[0] ?? { totals: [], byPaymentMode: [] };
    const totals = facet.totals[0] ?? {
      totalRows: 0,
      totalSettlementAmount: 0,
      uniqueNeftCount: 0,
      rowsWithPaymentMode: 0,
    };

    return {
      success: true,
      data: {
        totalRows: Number(totals.totalRows ?? 0),
        totalSettlementAmount: Number(totals.totalSettlementAmount ?? 0),
        uniqueNeftCount: Number(totals.uniqueNeftCount ?? 0),
        rowsWithPaymentMode: Number(totals.rowsWithPaymentMode ?? 0),
        byPaymentMode: (facet.byPaymentMode ?? []).map((item) => ({
          paymentMode: String(item._id || 'Unknown'),
          count: Number(item.count ?? 0),
          settlement: Number(item.settlement ?? 0),
        })),
      },
    };
  }
}
