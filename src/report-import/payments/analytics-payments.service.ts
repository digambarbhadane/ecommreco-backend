import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ListAnalyticsPaymentsDto } from '../dto/list-analytics-payments.dto';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import { ValidationService } from '../services/validation.service';
import { FlipkartPaymentRepository } from './flipkart/flipkart-payment.repository';
import {
  mapFlipkartPaymentToAnalyticsRow,
  mapImportRowToPaymentAnalyticsRow,
  mapMeeshoOrderPaymentToAnalyticsRow,
  type PaymentAnalyticsRow,
} from './payment-analytics.types';
import { applyPaymentFiltersToMongoFilter } from '../utils/payment-filter.util';
import {
  MeeshoOrderPayments,
  MeeshoOrderPaymentsDocument,
} from './meesho/schemas/order-payments.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../../marketplaces/schemas/marketplace.schema';

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
    @InjectModel(MeeshoOrderPayments.name)
    private readonly meeshoOrderPaymentsModel: Model<MeeshoOrderPaymentsDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
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
    const marketplaceSlug = await this.resolveMarketplaceSlug(query.marketplace);

    const hasMeesho = await this.hasMeeshoPaymentData(
      sellerAliases,
      query.gstin,
    );
    const hasFlipkart = !(await this.shouldUseLegacyImportRows(
      { ...query, marketplace: marketplaceSlug || query.marketplace },
      sellerAliases,
    ));

    const includeMeesho =
      hasMeesho && (!marketplaceSlug || marketplaceSlug === 'meesho');
    const includeFlipkart =
      hasFlipkart && (!marketplaceSlug || marketplaceSlug === 'flipkart');

    if (!includeMeesho && !includeFlipkart) {
      return this.listLegacyImportRowPayments(query, sellerAliases, limit, skip);
    }

    const sortBy = FLIPKART_SORT_FIELDS.has(String(query.sortBy ?? ''))
      ? (query.sortBy as string)
      : 'paymentDate';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [flipkartResult, meeshoRows] = await Promise.all([
      includeFlipkart
        ? this.flipkartPaymentRepository.findBySeller({
            sellerIds: sellerAliases,
            gstin: query.gstin,
            marketplace:
              marketplaceSlug === 'flipkart'
                ? 'flipkart'
                : query.marketplace && marketplaceSlug !== 'meesho'
                  ? query.marketplace
                  : undefined,
            paymentDateFrom: query.paymentDateFrom,
            paymentDateTo: query.paymentDateTo,
            search: query.search,
            skip: 0,
            limit: 100_000,
            sortBy,
            sortOrder,
          })
        : Promise.resolve({ data: [], total: 0 }),
      includeMeesho
        ? this.listMeeshoPaymentDocs(query, sellerAliases)
        : Promise.resolve([]),
    ]);

    const mapped: PaymentAnalyticsRow[] = [
      ...flipkartResult.data.map((doc) =>
        mapFlipkartPaymentToAnalyticsRow(
          doc as Parameters<typeof mapFlipkartPaymentToAnalyticsRow>[0],
        ),
      ),
      ...meeshoRows.map((doc) => mapMeeshoOrderPaymentToAnalyticsRow(doc)),
    ];

    const sorted = this.sortPaymentRows(mapped, sortBy, sortOrder);
    const total = sorted.length;
    const page = sorted.slice(skip, skip + limit);

    return {
      success: true,
      data: page,
      total,
      limit,
      skip,
      source: includeMeesho && includeFlipkart
        ? 'mixed'
        : includeMeesho
          ? 'meesho_order_payments'
          : 'flipkart_payment_order_reports',
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

    const list = await this.listPayments({
      ...query,
      sellerId,
      limit: '100000',
      skip: '0',
    });
    const rows = (list.data ?? []) as PaymentAnalyticsRow[];
    const neftSet = new Set<string>();
    let totalSettlementAmount = 0;
    let rowsWithPaymentMode = 0;
    const byMode = new Map<string, { count: number; settlement: number }>();

    for (const row of rows) {
      totalSettlementAmount += Number(row.bankSettlementValue ?? 0);
      const neft = String(row.neftId ?? row.transactionId ?? '').trim();
      if (neft) neftSet.add(neft);
      const mode = String(row.neftType ?? row.paymentMode ?? '').trim();
      if (mode) {
        rowsWithPaymentMode += 1;
        const bucket = byMode.get(mode) ?? { count: 0, settlement: 0 };
        bucket.count += 1;
        bucket.settlement += Number(row.bankSettlementValue ?? 0);
        byMode.set(mode, bucket);
      }
    }

    return {
      success: true,
      data: {
        totalRows: rows.length,
        totalSettlementAmount,
        uniqueNeftCount: neftSet.size,
        rowsWithPaymentMode,
        byPaymentMode: Array.from(byMode.entries()).map(([paymentMode, v]) => ({
          paymentMode,
          count: v.count,
          settlement: v.settlement,
        })),
      },
    };
  }

  async exportCsv(
    query: ListAnalyticsPaymentsDto,
  ): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
    const pageSize = 5_000;
    const maxRows = 100_000;
    const rows: PaymentAnalyticsRow[] = [];
    let skip = 0;
    let total = Number.POSITIVE_INFINITY;

    while (rows.length < maxRows && skip < total) {
      const list = await this.listPayments({
        ...query,
        limit: String(pageSize),
        skip: String(skip),
      });
      const batch = (list.data ?? []) as PaymentAnalyticsRow[];
      total = Number(list.total ?? batch.length);
      if (!batch.length) break;
      rows.push(...batch);
      skip += batch.length;
      if (batch.length < pageSize) break;
    }

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

  private sortPaymentRows(
    rows: PaymentAnalyticsRow[],
    sortBy: string,
    sortOrder: 'asc' | 'desc',
  ) {
    const dir = sortOrder === 'asc' ? 1 : -1;
    const key = sortBy as keyof PaymentAnalyticsRow;
    return [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  private toSellerObjectIds(sellerAliases: string[]): Types.ObjectId[] {
    return sellerAliases
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
  }

  private meeshoSellerFilter(
    sellerAliases: string[],
    gstin?: string,
  ): Record<string, unknown> {
    const sellerObjectIds = this.toSellerObjectIds(sellerAliases);
    const filter: Record<string, unknown> = {
      sellerId: {
        $in:
          sellerObjectIds.length > 0
            ? [...sellerObjectIds, ...sellerAliases]
            : sellerAliases,
      },
      marketplace: 'meesho',
    };
    if (gstin) filter.gstin = gstin.trim().toUpperCase();
    return filter;
  }

  private async hasMeeshoPaymentData(
    sellerAliases: string[],
    gstin?: string,
  ): Promise<boolean> {
    const count = await this.meeshoOrderPaymentsModel
      .countDocuments(this.meeshoSellerFilter(sellerAliases, gstin))
      .exec();
    return count > 0;
  }

  private async listMeeshoPaymentDocs(
    query: ListAnalyticsPaymentsDto,
    sellerAliases: string[],
  ) {
    const filter = this.meeshoSellerFilter(sellerAliases, query.gstin);
    if (query.paymentDateFrom || query.paymentDateTo) {
      const range: Record<string, Date> = {};
      if (query.paymentDateFrom) {
        const start = new Date(query.paymentDateFrom);
        if (!Number.isNaN(start.getTime())) range.$gte = start;
      }
      if (query.paymentDateTo) {
        const end = new Date(query.paymentDateTo);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          range.$lte = end;
        }
      }
      if (Object.keys(range).length) filter.paymentDate = range;
    }

    const search = String(query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { subOrderNo: { $regex: escaped, $options: 'i' } },
        { transactionId: { $regex: escaped, $options: 'i' } },
        { supplierSku: { $regex: escaped, $options: 'i' } },
      ];
    }

    return this.meeshoOrderPaymentsModel
      .find(filter)
      .sort({ paymentDate: -1, subOrderNo: 1 })
      .lean()
      .exec();
  }

  private async resolveMarketplaceSlug(
    marketplace?: string,
  ): Promise<string> {
    const value = String(marketplace ?? '').trim();
    if (!value) return '';
    const lower = value.toLowerCase();
    if (
      lower === 'meesho' ||
      lower === 'flipkart' ||
      lower === 'amazon' ||
      lower === 'myntra'
    ) {
      return lower;
    }
    if (!Types.ObjectId.isValid(value)) return lower;

    const link = await this.marketplaceModel
      .findById(value)
      .populate('platformMarketplaceId')
      .lean()
      .exec();
    const platform = link?.platformMarketplaceId as
      | { slug?: string; name?: string }
      | null
      | undefined;
    const slug = String(platform?.slug ?? '').trim().toLowerCase();
    if (slug) return slug;
    const name = String(platform?.name ?? '').trim().toLowerCase();
    if (name.includes('meesho')) return 'meesho';
    if (name.includes('flipkart')) return 'flipkart';
    return name || lower;
  }

  private async shouldUseLegacyImportRows(
    query: Pick<ListAnalyticsPaymentsDto, 'marketplace' | 'sellerId'>,
    sellerAliases: string[],
  ): Promise<boolean> {
    const marketplace = String(query.marketplace ?? '').trim();
    if (!marketplace || marketplace === 'flipkart') {
      const flipkartCount = await this.flipkartPaymentRepository.countByFilter({
        sellerIds: sellerAliases,
        ...(marketplace === 'flipkart' ? { marketplace: 'flipkart' } : {}),
      });
      return flipkartCount === 0;
    }

    if (marketplace === 'meesho') return true;

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
}
