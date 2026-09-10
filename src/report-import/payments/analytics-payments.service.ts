import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ListAnalyticsPaymentsDto } from '../dto/list-analytics-payments.dto';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import { ValidationService } from '../services/validation.service';
import { FlipkartPaymentRepository } from './flipkart/flipkart-payment.repository';
import { AmazonPaymentRepository } from './amazon/amazon-payment.repository';
import { MyntraPgRepository } from './myntra/myntra-pg.repository';
import { enrichMyntraPaymentAnalyticsRows } from './myntra/myntra-payment-analytics.mapper';
import { mapAmazonAggregatedSettlementsToAnalyticsRows } from './amazon/amazon-payment-analytics.mapper';
import {
  classifyAmazonTransactionType,
  isAmazonSaleCategory,
} from '../utils/amazon-analytics.util';
import {
  enrichFlipkartOrderDetailsMetadata,
  isFlipkartGstReturnDocumentType,
  mapFlipkartNoteImportRowToAnalyticsRow,
  mapFlipkartPaymentToAnalyticsRow,
  mapImportRowToPaymentAnalyticsRow,
  mapMeeshoOrderPaymentToAnalyticsRow,
  normalizeFlipkartImportSku,
  selectUncoveredFlipkartGstReturnRows,
  dedupeMeeshoDuplicatePaymentTransactions,
  type FlipkartGstReturnInvoiceMeta,
  type PaymentAnalyticsRow,
} from './payment-analytics.types';
import {
  aggregateOrderPaymentLifecycle,
  isFlipkartReturnCancellationDocumentType,
  isPaymentDispute,
  isPaymentDue,
  isPaymentOverdue,
  isPaymentSettled,
  matchesPaymentStatus,
  summarizePaymentRecords,
  sumOrderWisePaymentColumnTotals,
  toOrderPaymentStatusRow,
} from './payment-reconciliation.util';
import { repairDateToIso } from '../../common/utils/repair-legacy-date.util';
import { applyPaymentFiltersToMongoFilter } from '../utils/payment-filter.util';
import { chunkArray } from '../../common/utils/mongo-batch.util';
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

type PaymentDatasetCacheEntry = {
  rows: PaymentAnalyticsRow[];
  expiresAt: number;
};

@Injectable()
export class AnalyticsPaymentsService {
  private readonly logger = new Logger(AnalyticsPaymentsService.name);
  /** Short TTL cache so list + summary (and duplicate FE calls) share one load. */
  private readonly datasetCache = new Map<string, PaymentDatasetCacheEntry>();
  private readonly datasetInflight = new Map<
    string,
    Promise<PaymentAnalyticsRow[]>
  >();
  private static readonly DATASET_TTL_MS = 90_000;
  private static readonly DATASET_CACHE_MAX = 40;

  constructor(
    private readonly flipkartPaymentRepository: FlipkartPaymentRepository,
    private readonly amazonPaymentRepository: AmazonPaymentRepository,
    private readonly myntraPgRepository: MyntraPgRepository,
    private readonly validationService: ValidationService,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(MeeshoOrderPayments.name)
    private readonly meeshoOrderPaymentsModel: Model<MeeshoOrderPaymentsDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
  ) {}

  async listPayments(query: ListAnalyticsPaymentsDto) {
    const started = Date.now();
    const sellerId = String(query.sellerId ?? '').trim();
    if (!sellerId) {
      return {
        success: true,
        data: [],
        total: 0,
        limit: 0,
        skip: 0,
        source: 'none',
      };
    }

    const limit = Math.max(0, Number(query.limit ?? '50'));
    const skip = Math.max(0, Number(query.skip ?? '0'));
    const requestedSort = String(query.sortBy ?? '');
    const sortBy =
      FLIPKART_SORT_FIELDS.has(requestedSort) ||
      requestedSort === 'netSales' ||
      requestedSort === 'difference' ||
      requestedSort === 'refund'
        ? requestedSort
        : 'paymentDate';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const enriched = await this.getEnrichedPaymentRows(query);
    const marketplaceScoped = await this.filterRowsByMarketplace(
      enriched,
      query.marketplace,
    );
    const filtered = this.filterByPaymentStatus(
      marketplaceScoped,
      query.paymentStatus,
    );
    const { pageRows, totalOrders } = this.sortAndPaginateByUniqueOrderId(
      filtered,
      sortBy,
      sortOrder,
      skip,
      limit,
    );

    // Amazon SKU/invoice/qty is display-only — enrich the page, not the full set.
    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const displayRows = await this.attachAmazonSkusFromImportRows(
      pageRows,
      sellerAliases,
      query,
    );

    this.logger.log(
      `listPayments seller=${sellerId} rows=${enriched.length} page=${displayRows.length}/${totalOrders} ${Date.now() - started}ms`,
    );

    return {
      success: true,
      data: displayRows,
      total: totalOrders,
      limit,
      skip,
      source: this.inferSourceLabel(displayRows),
    };
  }

  async getSummary(query: ListAnalyticsPaymentsDto) {
    const started = Date.now();
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
          salesRecords: 0,
          returnRecords: 0,
          totalOrderRecords: 0,
          dueCount: 0,
          overdueCount: 0,
          settledCount: 0,
          disputeCount: 0,
          dueNetSales: 0,
          overdueNetSales: 0,
          settledNetSales: 0,
          disputeNetSales: 0,
          columnTotals: {
            sales: 0,
            returns: 0,
            netSales: 0,
            marketplaceFees: 0,
            bankPayout: 0,
            difference: 0,
          },
          byMarketplace: [],
        },
      };
    }

    // Load once (shared cache with list). Never sort for summary.
    const allRows = await this.getEnrichedPaymentRows(query);
    const byMarketplace = await this.buildMarketplaceOrderCounts(allRows);
    // Status + column totals respect marketplace filter; cards stay global.
    const scopedRows = await this.filterRowsByMarketplace(
      allRows,
      query.marketplace,
    );

    const neftSet = new Set<string>();
    let totalSettlementAmount = 0;
    let rowsWithPaymentMode = 0;
    const byMode = new Map<string, { count: number; settlement: number }>();

    for (const row of scopedRows) {
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

    const reconciliation = summarizePaymentRecords(scopedRows);
    // Status-card counts stay on the full scoped dataset; table TOTAL row follows
    // the same paymentStatus filter as the paginated list (all matching orders).
    const columnTotalsRows = query.paymentStatus
      ? this.filterByPaymentStatus(scopedRows, query.paymentStatus)
      : scopedRows;
    const columnTotals = sumOrderWisePaymentColumnTotals(columnTotalsRows);

    this.logger.log(
      `getSummary seller=${sellerId} all=${allRows.length} scoped=${scopedRows.length} ${Date.now() - started}ms`,
    );

    return {
      success: true,
      data: {
        totalRows: reconciliation.totalOrderRecords,
        totalSettlementAmount,
        uniqueNeftCount: neftSet.size,
        rowsWithPaymentMode,
        byPaymentMode: Array.from(byMode.entries()).map(([paymentMode, v]) => ({
          paymentMode,
          count: v.count,
          settlement: v.settlement,
        })),
        ...reconciliation,
        columnTotals,
        byMarketplace,
      },
    };
  }

  private readonly linkIdsCache = new Map<
    string,
    { ids: string[]; expiresAt: number }
  >();

  private datasetCacheKey(query: ListAnalyticsPaymentsDto, sellerId: string) {
    const marketplace = String(query.marketplace ?? '').trim().toLowerCase();
    return [
      sellerId,
      marketplace || 'all',
      String(query.gstin ?? '').trim().toUpperCase(),
      String(query.paymentDateFrom ?? '').trim(),
      String(query.paymentDateTo ?? '').trim(),
      String(query.fromDate ?? '').trim(),
      String(query.toDate ?? '').trim(),
      String(query.paymentMode ?? '').trim().toLowerCase(),
      String(query.search ?? '').trim().toLowerCase(),
      String(query.orderId ?? '').trim(),
    ].join('|');
  }

  /**
   * Shared enriched dataset for list + summary. Marketplace / status / sort are
   * applied by callers so parallel requests coalesce on one Mongo load.
   */
  private async getEnrichedPaymentRows(
    query: ListAnalyticsPaymentsDto,
  ): Promise<PaymentAnalyticsRow[]> {
    const sellerId = String(query.sellerId ?? '').trim();
    const specificKey = this.datasetCacheKey(query, sellerId);
    const unscopedKey = this.datasetCacheKey(
      { ...query, marketplace: undefined },
      sellerId,
    );
    const now = Date.now();

    const cachedSpecific = this.datasetCache.get(specificKey);
    if (cachedSpecific && cachedSpecific.expiresAt > now) {
      this.logger.log(`payments dataset cache HIT seller=${sellerId}`);
      return cachedSpecific.rows;
    }

    const cachedUnscoped = this.datasetCache.get(unscopedKey);
    if (cachedUnscoped && cachedUnscoped.expiresAt > now) {
      this.logger.log(
        `payments dataset cache HIT (from unscoped) seller=${sellerId}`,
      );
      if (!query.marketplace) return cachedUnscoped.rows;
      return this.filterRowsByMarketplace(
        cachedUnscoped.rows,
        query.marketplace,
      );
    }

    const inflight =
      this.datasetInflight.get(specificKey) ||
      this.datasetInflight.get(unscopedKey);
    if (inflight) {
      this.logger.log(`payments dataset cache WAIT seller=${sellerId}`);
      const rows = await inflight;
      if (
        query.marketplace &&
        this.datasetInflight.get(unscopedKey) === inflight
      ) {
        return this.filterRowsByMarketplace(rows, query.marketplace);
      }
      return rows;
    }

    this.logger.log(`payments dataset cache MISS seller=${sellerId}`);

    const promise = this.loadEnrichedPaymentRows(query)
      .then((rows) => {
        this.datasetCache.set(specificKey, {
          rows,
          expiresAt: Date.now() + AnalyticsPaymentsService.DATASET_TTL_MS,
        });
        this.datasetInflight.delete(specificKey);
        this.pruneDatasetCache();
        return rows;
      })
      .catch((error) => {
        this.datasetInflight.delete(specificKey);
        throw error;
      });

    this.datasetInflight.set(specificKey, promise);
    return promise;
  }

  private pruneDatasetCache() {
    if (
      this.datasetCache.size <= AnalyticsPaymentsService.DATASET_CACHE_MAX
    ) {
      return;
    }
    const entries = [...this.datasetCache.entries()].sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt,
    );
    const removeCount =
      this.datasetCache.size - AnalyticsPaymentsService.DATASET_CACHE_MAX;
    for (let i = 0; i < removeCount; i += 1) {
      this.datasetCache.delete(entries[i][0]);
    }
  }

  private async loadEnrichedPaymentRows(
    query: ListAnalyticsPaymentsDto,
  ): Promise<PaymentAnalyticsRow[]> {
    const started = Date.now();
    const sellerId = String(query.sellerId ?? '').trim();
    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);

    const targetSlug = await this.resolveMarketplaceSlug(query.marketplace);
    const isMarketplaceScoped = Boolean(targetSlug);

    const unscopedQuery: ListAnalyticsPaymentsDto = {
      ...query,
      marketplace: isMarketplaceScoped ? query.marketplace : undefined,
      paymentStatus: undefined,
    };

    const isFlipkartTarget = !isMarketplaceScoped || targetSlug === 'flipkart';
    const isMeeshoTarget = !isMarketplaceScoped || targetSlug === 'meesho';
    const isAmazonTarget = !isMarketplaceScoped || targetSlug === 'amazon';
    const isMyntraTarget = !isMarketplaceScoped || targetSlug === 'myntra';
    const isOtherTarget =
      isMarketplaceScoped &&
      !isFlipkartTarget &&
      !isMeeshoTarget &&
      !isAmazonTarget &&
      !isMyntraTarget;

    const [hasMeesho, useLegacyFlipkart, hasAmazon, hasMyntraPg] =
      await Promise.all([
        isMeeshoTarget
          ? this.hasMeeshoPaymentData(sellerAliases, query.gstin)
          : Promise.resolve(false),
        isFlipkartTarget
          ? this.shouldUseLegacyImportRows(
              { ...unscopedQuery, marketplace: query.marketplace },
              sellerAliases,
            )
          : Promise.resolve(true),
        isAmazonTarget
          ? this.amazonPaymentRepository.hasDataForSeller({
              sellerIds: sellerAliases,
              gstin: query.gstin,
            })
          : Promise.resolve(false),
        isMyntraTarget
          ? this.myntraPgRepository.existsByFilter({
              sellerIds: sellerAliases,
              gstin: query.gstin,
            })
          : Promise.resolve(false),
      ]);
    const hasFlipkart = isFlipkartTarget && !useLegacyFlipkart;

    const includeMeesho = hasMeesho;
    const includeFlipkart = hasFlipkart;
    const includeAmazon = hasAmazon;
    const includeMyntraPg = hasMyntraPg;
    // Meesho-scoped + dedicated meesho_order_payments: skip legacy import_rows
    // for list views (avoids Return ≈ 2× Sales). When a specific orderId is
    // requested (Order Details), keep legacy so every related transaction loads;
    // lifecycle prefers meesho_order_payments amounts when both sources exist.
    const skipLegacyForMeeshoCollection =
      isMarketplaceScoped &&
      targetSlug === 'meesho' &&
      hasMeesho &&
      !String(query.orderId ?? '').trim();
    // Amazon-scoped + dedicated amazon_payment_transactions: never merge Amazon
    // GST import_rows as financial rows. Those SALE invoices inflate Sales while
    // Bank/Fees come from settlement components → mass Mismatch. SKU/invoice/qty
    // still attach via attachAmazonSkusFromImportRows (display-only).
    const skipLegacyForAmazonCollection =
      isMarketplaceScoped && targetSlug === 'amazon' && hasAmazon;
    const includeLegacy =
      !skipLegacyForMeeshoCollection &&
      !skipLegacyForAmazonCollection &&
      (!isMarketplaceScoped ||
        isMyntraTarget ||
        isOtherTarget ||
        useLegacyFlipkart);

    if (
      !includeMeesho &&
      !includeFlipkart &&
      !includeAmazon &&
      !includeLegacy
    ) {
      return [];
    }

    if (!includeMeesho && !includeFlipkart && !includeAmazon) {
      const legacyOnly = await this.fetchLegacyPaymentRows(
        // Drop orderId so Myntra sales/returns with different source order ids
        // still load and can canonicalize onto the portal Order Id.
        { ...unscopedQuery, orderId: undefined },
        sellerAliases,
      );
      return this.finalizeMyntraEnrichedRows(
        legacyOnly,
        sellerAliases,
        unscopedQuery,
        includeMyntraPg,
      );
    }

    const legacyExclusions =
      includeLegacy && !isMarketplaceScoped
        ? await this.resolveLegacyMarketplaceExclusions(sellerAliases, {
            excludeFlipkart: Boolean(includeFlipkart),
            excludeMeesho: Boolean(includeMeesho),
            excludeAmazon: Boolean(includeAmazon),
          })
        : undefined;

    const tFetch = Date.now();
    const flipkartPromise = includeFlipkart
      ? this.flipkartPaymentRepository.findBySeller({
          sellerIds: sellerAliases,
          gstin: query.gstin,
          paymentDateFrom: query.paymentDateFrom,
          paymentDateTo: query.paymentDateTo,
          search: query.search,
          orderId: query.orderId?.trim() || undefined,
          skip: 0,
          limit: 100_000,
          skipTotal: true,
          skipSort: true,
        })
      : Promise.resolve({ data: [] as unknown[], total: 0 });
    const meeshoPromise = includeMeesho
      ? this.listMeeshoPaymentDocs(unscopedQuery, sellerAliases)
      : Promise.resolve([]);
    const amazonPromise = includeAmazon
      ? this.amazonPaymentRepository.findAggregatedForAnalytics({
          sellerIds: sellerAliases,
          gstin: query.gstin,
          paymentDateFrom: query.paymentDateFrom,
          paymentDateTo: query.paymentDateTo,
          search: query.search,
          orderId: query.orderId?.trim() || undefined,
        })
      : Promise.resolve([]);
    const legacyPromise = includeLegacy
      ? this.fetchLegacyPaymentRows(
          { ...unscopedQuery, orderId: undefined },
          sellerAliases,
          {
            excludeMarketplaces: legacyExclusions,
          },
        )
      : Promise.resolve([] as PaymentAnalyticsRow[]);
    const myntraPgPromise = includeMyntraPg
      ? this.myntraPgRepository.findBySeller({
          sellerIds: sellerAliases,
          gstin: query.gstin,
          paymentDateFrom: query.paymentDateFrom,
          paymentDateTo: query.paymentDateTo,
          limit: 100_000,
        })
      : Promise.resolve([] as Array<Record<string, unknown>>);

    const notesPromise = includeFlipkart
      ? (async () => {
          const flipkartResult = await flipkartPromise;
          const orderIds = new Set<string>();
          for (const doc of flipkartResult.data) {
            const orderId = String(
              (doc as { orderId?: string }).orderId ?? '',
            ).trim();
            if (orderId) orderIds.add(orderId);
          }
          const forcedOrderId = String(unscopedQuery.orderId ?? '').trim();
          if (forcedOrderId) orderIds.add(forcedOrderId);
          if (!orderIds.size) {
            return {
              financialRows: [] as PaymentAnalyticsRow[],
              returnFinancialRows: [] as PaymentAnalyticsRow[],
              returnInvoices: [] as FlipkartGstReturnInvoiceMeta[],
            };
          }
          return this.loadFlipkartGstAttachBundle(
            orderIds,
            sellerAliases,
            unscopedQuery,
          );
        })()
      : Promise.resolve({
          financialRows: [] as PaymentAnalyticsRow[],
          returnFinancialRows: [] as PaymentAnalyticsRow[],
          returnInvoices: [] as FlipkartGstReturnInvoiceMeta[],
        });

    const [
      flipkartResult,
      meeshoRows,
      amazonDocs,
      legacyRows,
      myntraPgDocs,
      gstBundle,
    ] = await Promise.all([
      flipkartPromise,
      meeshoPromise,
      amazonPromise,
      legacyPromise,
      myntraPgPromise,
      notesPromise,
    ]);
    const fetchMs = Date.now() - tFetch;

    const tMap = Date.now();
    const amazonRows = includeAmazon
      ? mapAmazonAggregatedSettlementsToAnalyticsRows(amazonDocs)
      : [];

    const flipkartMapped = flipkartResult.data.map((doc) =>
      mapFlipkartPaymentToAnalyticsRow(
        doc as Parameters<typeof mapFlipkartPaymentToAnalyticsRow>[0],
      ),
    );
    const mapped: PaymentAnalyticsRow[] = dedupeMeeshoDuplicatePaymentTransactions(
      [
        ...flipkartMapped,
        ...meeshoRows.map((doc) => mapMeeshoOrderPaymentToAnalyticsRow(doc)),
        ...amazonRows,
        ...legacyRows,
      ],
    );
    const withMyntra = enrichMyntraPaymentAnalyticsRows(
      mapped,
      myntraPgDocs as Parameters<typeof enrichMyntraPaymentAnalyticsRows>[1],
    );
    const mapMs = Date.now() - tMap;

    const uncoveredGstReturns = selectUncoveredFlipkartGstReturnRows(
      flipkartMapped,
      gstBundle.returnFinancialRows,
    );
    const gstAttachRows = [
      ...gstBundle.financialRows,
      ...uncoveredGstReturns,
    ];
    const withNotes =
      gstAttachRows.length > 0 ? [...withMyntra, ...gstAttachRows] : withMyntra;
    const enriched = this.filterEnrichedRowsByOrderId(
      enrichFlipkartOrderDetailsMetadata(
        withNotes,
        gstBundle.returnInvoices,
      ),
      unscopedQuery.orderId,
    );

    this.logger.log(
      `loadEnrichedPaymentRows seller=${sellerId} target=${targetSlug || 'all'} fk=${flipkartResult.data.length} amzBuckets=${amazonDocs.length} mee=${meeshoRows.length} myntraPg=${myntraPgDocs.length} leg=${legacyRows.length} mapped=${mapped.length} enriched=${enriched.length} fetch=${fetchMs}ms map=${mapMs}ms notes=overlapped total=${Date.now() - started}ms`,
    );
    return enriched;
  }

  private async finalizeMyntraEnrichedRows(
    legacyRows: PaymentAnalyticsRow[],
    sellerAliases: string[],
    query: ListAnalyticsPaymentsDto,
    includeMyntraPg: boolean,
  ): Promise<PaymentAnalyticsRow[]> {
    const pgDocs = includeMyntraPg
      ? await this.myntraPgRepository.findBySeller({
          sellerIds: sellerAliases,
          gstin: query.gstin,
          paymentDateFrom: query.paymentDateFrom,
          paymentDateTo: query.paymentDateTo,
          limit: 100_000,
        })
      : [];
    const enriched = enrichMyntraPaymentAnalyticsRows(
      legacyRows,
      pgDocs as Parameters<typeof enrichMyntraPaymentAnalyticsRows>[1],
    );
    return this.filterEnrichedRowsByOrderId(enriched, query.orderId);
  }

  private filterEnrichedRowsByOrderId(
    rows: PaymentAnalyticsRow[],
    orderId?: string,
  ): PaymentAnalyticsRow[] {
    const key = String(orderId ?? '').trim();
    if (!key) return rows;
    return rows.filter((row) => String(row.orderId ?? '').trim() === key);
  }

  private async filterRowsByMarketplace(
    rows: PaymentAnalyticsRow[],
    marketplace?: string,
  ): Promise<PaymentAnalyticsRow[]> {
    const slug = await this.resolveMarketplaceSlug(marketplace);
    if (!slug) return rows;

    const rawValues = [
      ...new Set(
        rows
          .map((row) => String(row.marketplace ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const slugByRaw = await this.resolveMarketplaceSlugsBatch(rawValues);
    return rows.filter((row) => {
      const raw = String(row.marketplace ?? '').trim();
      if (!raw) return false;
      const rowSlug = slugByRaw.get(raw) || raw.toLowerCase();
      return rowSlug === slug;
    });
  }

  private async resolveMarketplaceSlugsBatch(
    rawValues: string[],
  ): Promise<Map<string, string>> {
    const slugByRaw = new Map<string, string>();
    const objectIdsToQuery: string[] = [];

    for (const raw of rawValues) {
      const trimmed = String(raw ?? '').trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (
        lower === 'meesho' ||
        lower === 'flipkart' ||
        lower === 'amazon' ||
        lower === 'myntra'
      ) {
        slugByRaw.set(trimmed, lower);
      } else if (lower.includes('flipkart')) {
        slugByRaw.set(trimmed, 'flipkart');
      } else if (lower.includes('meesho')) {
        slugByRaw.set(trimmed, 'meesho');
      } else if (lower.includes('amazon')) {
        slugByRaw.set(trimmed, 'amazon');
      } else if (lower.includes('myntra')) {
        slugByRaw.set(trimmed, 'myntra');
      } else if (Types.ObjectId.isValid(trimmed)) {
        objectIdsToQuery.push(trimmed);
      } else {
        slugByRaw.set(trimmed, lower);
      }
    }

    if (objectIdsToQuery.length > 0) {
      const links = await this.marketplaceModel
        .find({
          _id: { $in: objectIdsToQuery.map((id) => new Types.ObjectId(id)) },
        })
        .populate('platformMarketplaceId')
        .select({ _id: 1, platformMarketplaceId: 1 })
        .lean()
        .exec();

      for (const link of links) {
        const idStr = link._id.toString();
        const platform = link.platformMarketplaceId as
          | { slug?: string; name?: string }
          | null
          | undefined;
        const slug = String(platform?.slug ?? '')
          .trim()
          .toLowerCase();
        if (slug) {
          slugByRaw.set(idStr, slug);
          continue;
        }
        const name = String(platform?.name ?? '')
          .trim()
          .toLowerCase();
        if (name.includes('meesho')) slugByRaw.set(idStr, 'meesho');
        else if (name.includes('flipkart')) slugByRaw.set(idStr, 'flipkart');
        else if (name.includes('amazon')) slugByRaw.set(idStr, 'amazon');
        else if (name.includes('myntra')) slugByRaw.set(idStr, 'myntra');
        else slugByRaw.set(idStr, name || idStr.toLowerCase());
      }
    }

    return slugByRaw;
  }

  private inferSourceLabel(rows: PaymentAnalyticsRow[]): string {
    const sources = new Set(
      rows.map((row) => String(row.source ?? '').trim()).filter(Boolean),
    );
    if (sources.size === 0) return 'none';
    if (sources.size > 1) return 'mixed';
    const only = [...sources][0];
    return only || 'mixed';
  }

  /**
   * Unique Order ID counts per marketplace platform slug for the payments filter.
   * Resolves legacy import_rows ObjectIds to platform slugs so All-GST counts
   * match the same slug filter used by listPayments.
   */
  private async buildMarketplaceOrderCounts(
    rows: PaymentAnalyticsRow[],
  ): Promise<Array<{ marketplace: string; orderCount: number; netSales: number }>> {
    // Prefer row.source for dedicated collections — avoids N marketplace lookups.
    const slugFromSource = (row: PaymentAnalyticsRow): string => {
      const source = String(row.source ?? '').trim();
      if (source === 'amazon_payment_transactions') return 'amazon';
      if (source === 'flipkart_payment_order_reports') return 'flipkart';
      if (source === 'meesho_order_payments') return 'meesho';
      return '';
    };

    const legacyRawValues = [
      ...new Set(
        rows
          .filter((row) => !slugFromSource(row))
          .map((row) => String(row.marketplace ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const slugByRaw =
      legacyRawValues.length > 0
        ? await this.resolveMarketplaceSlugsBatch(legacyRawValues)
        : new Map<string, string>();

    const orderRowsById = new Map<string, PaymentAnalyticsRow[]>();
    const primarySlugByOrderId = new Map<string, string>();
    for (const row of rows) {
      const orderId = String(row.orderId ?? '').trim();
      if (!orderId) continue;
      const bucket = orderRowsById.get(orderId);
      if (bucket) bucket.push(row);
      else orderRowsById.set(orderId, [row]);

      if (primarySlugByOrderId.has(orderId)) continue;
      const fromSource = slugFromSource(row);
      if (fromSource) {
        primarySlugByOrderId.set(orderId, fromSource);
        continue;
      }
      const raw = String(row.marketplace ?? '').trim();
      if (!raw) continue;
      const slug = slugByRaw.get(raw) || raw.toLowerCase();
      if (slug) primarySlugByOrderId.set(orderId, slug);
    }

    const statsBySlug = new Map<string, { orderCount: number; netSales: number }>();
    for (const [orderId, orderRows] of orderRowsById) {
      const slug = primarySlugByOrderId.get(orderId);
      if (!slug) continue;
      const netSales = aggregateOrderPaymentLifecycle(orderRows).netSales;
      const existing = statsBySlug.get(slug) ?? { orderCount: 0, netSales: 0 };
      existing.orderCount += 1;
      existing.netSales += netSales;
      statsBySlug.set(slug, existing);
    }

    return Array.from(statsBySlug.entries())
      .map(([marketplace, stats]) => ({
        marketplace,
        orderCount: stats.orderCount,
        netSales: stats.netSales,
      }))
      .sort(
        (a, b) =>
          b.orderCount - a.orderCount ||
          a.marketplace.localeCompare(b.marketplace),
      );
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
      const batch = list.data ?? [];
      total = Number(list.total ?? 0);
      if (!batch.length) break;
      rows.push(...batch);
      // listPayments paginates by unique Order ID — advance skip in order units.
      const orderIdsOnPage = new Set(
        batch
          .map((row) => String(row.orderId ?? '').trim())
          .filter(Boolean),
      );
      const ordersAdvanced = orderIdsOnPage.size || batch.length;
      skip += ordersAdvanced;
      if (ordersAdvanced < pageSize) break;
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

  /**
   * Sort the full unique-Order-ID dataset, then paginate.
   * Sort keys are precomputed once per order (never inside the comparator).
   */
  private sortAndPaginateByUniqueOrderId(
    rows: PaymentAnalyticsRow[],
    sortBy: string,
    sortOrder: 'asc' | 'desc',
    skip: number,
    limit: number,
  ): { pageRows: PaymentAnalyticsRow[]; totalOrders: number } {
    const byOrder = new Map<string, PaymentAnalyticsRow[]>();

    for (const row of rows) {
      const orderId = String(row.orderId ?? '').trim() || row._id;
      const bucket = byOrder.get(orderId);
      if (bucket) bucket.push(row);
      else byOrder.set(orderId, [row]);
    }

    const dir = sortOrder === 'asc' ? 1 : -1;
    const entries = [...byOrder.entries()].map(([orderId, orderRows]) => ({
      orderId,
      orderRows,
      sortValue: this.pickOrderSortValue(orderRows, sortBy),
    }));

    entries.sort((a, b) => {
      const av = a.sortValue;
      const bv = b.sortValue;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return (
        String(av).localeCompare(String(bv), undefined, {
          numeric: true,
          sensitivity: 'base',
        }) * dir
      );
    });

    const totalOrders = entries.length;
    const pageEntries = entries.slice(
      Math.max(0, skip),
      Math.max(0, skip) + Math.max(1, limit),
    );
    const pageRows = pageEntries.flatMap((entry) => entry.orderRows);
    return { pageRows, totalOrders };
  }

  private pickOrderSortValue(
    orderRows: PaymentAnalyticsRow[],
    sortBy: string,
  ): string | number | undefined {
    const productPrimary = orderRows.find((row) => {
      const source = String(row.source ?? '').trim().toLowerCase();
      if (source === 'myntra_pg_settlement_rows') return false;
      const docType = String(row.documentType ?? '').trim().toLowerCase();
      return (
        docType === 'sale' ||
        docType === 'customer return' ||
        docType === 'rto return'
      );
    });
    const primary = productPrimary ?? orderRows[0];
    const needsLifecycle =
      sortBy === 'netSales' ||
      sortBy === 'difference' ||
      sortBy === 'refund' ||
      sortBy === 'saleAmount' ||
      sortBy === 'marketplaceFee' ||
      sortBy === 'commission' ||
      sortBy === 'bankSettlementValue' ||
      sortBy === 'finalSettlementAmount';

    if (needsLifecycle) {
      const lifecycle = aggregateOrderPaymentLifecycle(orderRows);
      if (sortBy === 'netSales') return lifecycle.netSales;
      if (sortBy === 'difference') return lifecycle.difference;
      if (sortBy === 'refund') return lifecycle.returns;
      if (sortBy === 'saleAmount') return lifecycle.sales;
      if (sortBy === 'marketplaceFee' || sortBy === 'commission') {
        return lifecycle.marketplaceFees;
      }
      return lifecycle.bankPayout;
    }

    if (sortBy === 'paymentStatus') {
      const statusRow = toOrderPaymentStatusRow(orderRows);
      if (isPaymentSettled(statusRow)) return '1-Settled';
      if (isPaymentDispute(statusRow)) return '2-Dispute';
      if (isPaymentDue(statusRow)) return '3-Due';
      if (isPaymentOverdue(statusRow)) return '4-Overdue';
      return '5-Other';
    }
    if (sortBy === 'orderId') {
      return String(primary?.orderId ?? '').trim();
    }
    if (sortBy === 'sellerSku') {
      return String(primary?.sellerSku ?? '').trim().toLowerCase();
    }
    if (sortBy === 'invoiceDate' || sortBy === 'paymentDate') {
      const dates = orderRows
        .map((row) =>
          String(
            sortBy === 'invoiceDate'
              ? row.invoiceDate || row.paymentDate || ''
              : row.paymentDate || row.invoiceDate || '',
          ).trim(),
        )
        .filter(Boolean)
        .sort();
      const pick =
        sortBy === 'invoiceDate' ? dates[0] : dates[dates.length - 1];
      if (!pick) return undefined;
      const ms = Date.parse(pick);
      return Number.isFinite(ms) ? ms : pick;
    }
    if (sortBy === 'neftId' || sortBy === 'transactionId') {
      return String(primary?.neftId ?? primary?.transactionId ?? '').trim();
    }

    const raw = primary?.[sortBy as keyof PaymentAnalyticsRow];
    if (typeof raw === 'number' || typeof raw === 'string') return raw;
    return undefined;
  }

  private filterByPaymentStatus(rows: PaymentAnalyticsRow[], status?: string) {
    const key = String(status ?? '')
      .trim()
      .toLowerCase();
    if (!key) return rows;

    // Settled/Dispute/Due/Overdue are order-level outcomes. Keep every NEFT
    // belonging to matching Order IDs so the frontend lifecycle stays intact.
    const byOrder = new Map<string, PaymentAnalyticsRow[]>();
    for (const row of rows) {
      const orderId = String(row.orderId ?? '').trim() || row._id;
      const bucket = byOrder.get(orderId);
      if (bucket) bucket.push(row);
      else byOrder.set(orderId, [row]);
    }

    const matchingOrderIds = new Set<string>();
    for (const [orderId, orderRows] of byOrder) {
      if (matchesPaymentStatus(toOrderPaymentStatusRow(orderRows), key)) {
        matchingOrderIds.add(orderId);
      }
    }

    return rows.filter((row) => {
      const orderId = String(row.orderId ?? '').trim() || row._id;
      return matchingOrderIds.has(orderId);
    });
  }

  /**
   * Keep every leaf row for Order IDs present on the page (NEFTs + CN/DN).
   * Pagination may otherwise split an Order ID across pages so the main table
   * Difference cannot use the same lifecycle value as Order Details.
   */
  private includeCompleteOrderRows(
    allRows: PaymentAnalyticsRow[],
    pageRows: PaymentAnalyticsRow[],
  ): PaymentAnalyticsRow[] {
    const orderIds = new Set<string>();
    for (const row of pageRows) {
      const orderId = String(row.orderId ?? '').trim();
      if (orderId) orderIds.add(orderId);
    }
    if (!orderIds.size) return pageRows;

    const pageIds = new Set(pageRows.map((row) => row._id));
    const extras = allRows.filter((row) => {
      const orderId = String(row.orderId ?? '').trim();
      return Boolean(orderId) && orderIds.has(orderId) && !pageIds.has(row._id);
    });
    if (!extras.length) return pageRows;
    return [...pageRows, ...extras];
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
    const doc = await this.meeshoOrderPaymentsModel
      .exists(this.meeshoSellerFilter(sellerAliases, gstin))
      .exec();
    return Boolean(doc);
  }

  private async listMeeshoPaymentDocs(
    query: ListAnalyticsPaymentsDto,
    sellerAliases: string[],
  ) {
    const filter = this.meeshoSellerFilter(sellerAliases, query.gstin);
    const orderId = String(query.orderId ?? '').trim();
    if (orderId) {
      filter.subOrderNo = orderId;
    }
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
    if (search && !orderId) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { subOrderNo: { $regex: escaped, $options: 'i' } },
        { transactionId: { $regex: escaped, $options: 'i' } },
        { supplierSku: { $regex: escaped, $options: 'i' } },
      ];
    }

    // No Mongo sort — order-wise sort happens in memory after enrichment.
    return this.meeshoOrderPaymentsModel.find(filter).lean().exec();
  }

  private async resolveMarketplaceSlug(marketplace?: string): Promise<string> {
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
    // Display-style labels like "Flipkart-GJ" / "Amazon-MH"
    if (lower.includes('flipkart')) return 'flipkart';
    if (lower.includes('meesho')) return 'meesho';
    if (lower.includes('amazon')) return 'amazon';
    if (lower.includes('myntra')) return 'myntra';
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
    const slug = String(platform?.slug ?? '')
      .trim()
      .toLowerCase();
    if (slug) return slug;
    const name = String(platform?.name ?? '')
      .trim()
      .toLowerCase();
    if (name.includes('meesho')) return 'meesho';
    if (name.includes('flipkart')) return 'flipkart';
    if (name.includes('amazon')) return 'amazon';
    if (name.includes('myntra')) return 'myntra';
    return name || lower;
  }

  private async shouldUseLegacyImportRows(
    query: Pick<ListAnalyticsPaymentsDto, 'marketplace' | 'sellerId'>,
    sellerAliases: string[],
  ): Promise<boolean> {
    const marketplace = String(query.marketplace ?? '')
      .trim()
      .toLowerCase();
    if (!marketplace || marketplace === 'flipkart') {
      const hasFlipkart = await this.flipkartPaymentRepository.existsByFilter({
        sellerIds: sellerAliases,
      });
      return !hasFlipkart;
    }

    if (marketplace === 'meesho') return true;

    const hasCollection = await this.flipkartPaymentRepository.existsByFilter({
      sellerIds: sellerAliases,
      marketplace,
    });
    return !hasCollection;
  }

  /**
   * Seller-marketplace link ObjectIds for a platform slug (amazon/flipkart/…).
   * Used when import_rows.marketplace stores link ids instead of slug labels.
   */
  private async resolveMarketplaceLinkIds(
    sellerAliases: string[],
    marketplaceSlug: string,
  ): Promise<string[]> {
    const slug = String(marketplaceSlug ?? '')
      .trim()
      .toLowerCase();
    if (!slug) return [];

    const cacheKey = `${sellerAliases.slice().sort().join(',')}|${slug}`;
    const cached = this.linkIdsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ids;
    }

    const links = await this.marketplaceModel
      .find({ sellerId: { $in: sellerAliases } })
      .populate('platformMarketplaceId')
      .select({ _id: 1, platformMarketplaceId: 1 })
      .lean()
      .exec();

    const ids: string[] = [];
    for (const link of links) {
      const platform = link.platformMarketplaceId as
        | { slug?: string; name?: string }
        | null
        | undefined;
      const platformSlug = String(platform?.slug ?? '')
        .trim()
        .toLowerCase();
      const name = String(platform?.name ?? '')
        .trim()
        .toLowerCase();
      if (platformSlug === slug || name.includes(slug)) {
        ids.push(String(link._id));
      }
    }

    this.linkIdsCache.set(cacheKey, {
      ids,
      expiresAt: Date.now() + 60_000,
    });
    return ids;
  }

  /**
   * import_rows.marketplace is often a seller-marketplace ObjectId, not "flipkart".
   * When dedicated Flipkart/Meesho collections are already included, exclude both
   * slug labels and those marketplace link ids so rows are not double-counted.
   */
  private async resolveLegacyMarketplaceExclusions(
    sellerAliases: string[],
    options: {
      excludeFlipkart: boolean;
      excludeMeesho: boolean;
      excludeAmazon?: boolean;
    },
  ): Promise<string[] | undefined> {
    if (
      !options.excludeFlipkart &&
      !options.excludeMeesho &&
      !options.excludeAmazon
    ) {
      return undefined;
    }

    const exclusions = new Set<string>();
    if (options.excludeFlipkart) exclusions.add('flipkart');
    if (options.excludeMeesho) exclusions.add('meesho');
    if (options.excludeAmazon) exclusions.add('amazon');

    const links = await this.marketplaceModel
      .find({ sellerId: { $in: sellerAliases } })
      .populate('platformMarketplaceId')
      .select({ _id: 1, platformMarketplaceId: 1 })
      .lean()
      .exec();

    for (const link of links) {
      const platform = link.platformMarketplaceId as
        | { slug?: string; name?: string }
        | null
        | undefined;
      const slug = String(platform?.slug ?? '')
        .trim()
        .toLowerCase();
      const name = String(platform?.name ?? '')
        .trim()
        .toLowerCase();
      const isFlipkart =
        slug === 'flipkart' || name.includes('flipkart');
      const isMeesho = slug === 'meesho' || name.includes('meesho');
      const isAmazon = slug === 'amazon' || name.includes('amazon');
      if (
        (options.excludeFlipkart && isFlipkart) ||
        (options.excludeMeesho && isMeesho) ||
        (options.excludeAmazon && isAmazon)
      ) {
        exclusions.add(String(link._id));
      }
    }

    return exclusions.size ? [...exclusions] : undefined;
  }

  private async buildLegacyFilter(
    query: ListAnalyticsPaymentsDto,
    sellerAliases: string[],
    options?: { excludeMarketplaces?: string[] },
  ) {
    const filter: Record<string, unknown> = {};
    filter.sellerId = { $in: sellerAliases };
    if (query.gstin) filter.gstin = query.gstin.trim().toUpperCase();

    const marketplace = String(query.marketplace ?? '')
      .trim()
      .toLowerCase();
    const excluded = (options?.excludeMarketplaces ?? [])
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (marketplace) {
      // import_rows.marketplace is often a seller-marketplace ObjectId, not "amazon".
      // Match slug/name labels AND link ids for that platform so card clicks work.
      const linkIds = await this.resolveMarketplaceLinkIds(
        sellerAliases,
        marketplace,
      );
      const escaped = marketplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const clauses: Record<string, unknown>[] = [
        { marketplace: { $regex: new RegExp(`^${escaped}`, 'i') } },
      ];
      if (linkIds.length > 0) {
        clauses.push({ marketplace: { $in: linkIds } });
        const objectIds = linkIds
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id));
        if (objectIds.length > 0) {
          clauses.push({ marketplace: { $in: objectIds } });
        }
      }
      filter.$and = [
        ...((filter.$and as unknown[]) ?? []),
        { $or: clauses },
      ];
    } else if (excluded.length > 0) {
      const escaped = excluded.map((item) =>
        item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      );
      // Exclude slug labels (flipkart/meesho) and seller-marketplace ObjectIds.
      filter.$and = [
        ...((filter.$and as unknown[]) ?? []),
        {
          $nor: [
            { marketplace: { $in: excluded } },
            {
              marketplace: {
                $regex: new RegExp(`^(${escaped.join('|')})`, 'i'),
              },
            },
          ],
        },
      ];
    }

    applyPaymentFiltersToMongoFilter(filter, {
      hasPaymentData: 'yes',
      paymentDateFrom: query.paymentDateFrom,
      paymentDateTo: query.paymentDateTo,
      paymentMode: query.paymentMode,
    });
    const orderId = String(query.orderId ?? '').trim();
    if (orderId) {
      filter.orderID = orderId;
    }
    const search = String(query.search ?? '').trim();
    if (search && !orderId) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchClause = {
        $or: [
          { orderID: { $regex: escapedSearch, $options: 'i' } },
          { transactionId: { $regex: escapedSearch, $options: 'i' } },
          { paymentMode: { $regex: escapedSearch, $options: 'i' } },
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

  /**
   * Load legacy import_rows payment analytics (Amazon/Myntra/etc) without pagination.
   * Used when merging with Flipkart/Meesho dedicated collections for All marketplaces.
   */
  private async fetchLegacyPaymentRows(
    query: ListAnalyticsPaymentsDto,
    sellerAliases: string[],
    options?: { excludeMarketplaces?: string[] },
  ): Promise<PaymentAnalyticsRow[]> {
    const filter = await this.buildLegacyFilter(query, sellerAliases, options);
    const docs = await this.rowModel
      .find(filter)
      .select({
        _id: 1,
        orderID: 1,
        gstin: 1,
        marketplace: 1,
        documentType: 1,
        paymentDate: 1,
        paymentMode: 1,
        finalSettlementAmount: 1,
        transactionId: 1,
        invoiceDate: 1,
        order_packed_date: 1,
        invoiceNo: 1,
        invoiceNumber: 1,
        invoiceAmount: 1,
        reportMonth: 1,
        skuID: 1,
        quantity: 1,
        saleAmount: 1,
        marketplaceFee: 1,
        commission: 1,
        refund: 1,
        tcs: 1,
        tds: 1,
        taxableAmount: 1,
        taxableValue: 1,
        igstAmount: 1,
        igst: 1,
        cgstAmount: 1,
        cgst: 1,
        sgstAmount: 1,
        sgst: 1,
        uploadId: 1,
        stateName: 1,
        linkedSaleRowId: 1,
        myntraReturnMatchStatus: 1,
        orderCancelDate: 1,
        frRefundedDate: 1,
      })
      .limit(100_000)
      .lean()
      .exec();
    return docs.map((row) => mapImportRowToPaymentAnalyticsRow(row));
  }

  /**
   * Amazon settlement components (`amazon_payment_transactions`) have no SKU,
   * invoice number, or quantity. Those live on Amazon GST/sales `import_rows`
   * (`skuID`, `invoiceNo`, `quantity`).
   *
   * Enrich Amazon payment analytics rows only — does not change financial amounts.
   */
  private async attachAmazonSkusFromImportRows(
    rows: PaymentAnalyticsRow[],
    sellerAliases: string[],
    query: ListAnalyticsPaymentsDto,
  ): Promise<PaymentAnalyticsRow[]> {
    const amazonOrderIds = new Set<string>();
    for (const row of rows) {
      if (row.source !== 'amazon_payment_transactions') continue;
      const orderId = String(row.orderId ?? '').trim();
      if (!orderId) continue;
      const needsSku = !String(row.sellerSku ?? '').trim();
      const needsInvoice = !String(row.invoiceId ?? '').trim();
      const needsQty = row.quantity == null;
      if (needsSku || needsInvoice || needsQty) amazonOrderIds.add(orderId);
    }
    if (!amazonOrderIds.size) return rows;

    const sellerObjectIds = sellerAliases
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const filter: Record<string, unknown> = {
      sellerId: {
        $in:
          sellerObjectIds.length > 0
            ? [...sellerObjectIds, ...sellerAliases]
            : sellerAliases,
      },
      orderID: { $in: [...amazonOrderIds] },
    };
    const gstin = String(query.gstin ?? '').trim().toUpperCase();
    if (gstin) filter.gstin = gstin;

    const amazonOrderIdList = [...amazonOrderIds];
    const amazonBatches = chunkArray(amazonOrderIdList, 1000);
    const amazonBatchDocs = await Promise.all(
      amazonBatches.map((batch) =>
        this.rowModel
          .find({
            ...filter,
            orderID: { $in: batch },
          })
          .select({
            orderID: 1,
            skuID: 1,
            invoiceNo: 1,
            quantity: 1,
            invoiceDate: 1,
            documentType: 1,
            voucherType: 1,
          })
          .lean()
          .exec(),
      ),
    );
    const importDocs = amazonBatchDocs.flat();

    type AmazonOrderMeta = {
      skus: string[];
      invoices: string[];
      quantity: number;
      invoiceDate?: string;
    };
    const metaByOrderId = new Map<string, AmazonOrderMeta>();

    for (const doc of importDocs) {
      const orderId = String(doc.orderID ?? '').trim();
      if (!orderId) continue;

      const meta = metaByOrderId.get(orderId) ?? {
        skus: [],
        invoices: [],
        quantity: 0,
      };

      const sku = String(doc.skuID ?? '').trim();
      if (sku && !meta.skus.includes(sku)) meta.skus.push(sku);

      const invoiceNo = String(doc.invoiceNo ?? '').trim();
      if (invoiceNo && !meta.invoices.includes(invoiceNo)) {
        meta.invoices.push(invoiceNo);
      }

      const category = classifyAmazonTransactionType(
        String(doc.documentType ?? ''),
        String(doc.voucherType ?? ''),
      );
      // Order-level qty from Amazon sales/shipment lines only (not refunds).
      if (isAmazonSaleCategory(category)) {
        const qty = Number(doc.quantity);
        if (Number.isFinite(qty) && qty !== 0) meta.quantity += qty;
      }

      const invoiceDate = String(doc.invoiceDate ?? '').trim();
      if (invoiceDate && !meta.invoiceDate) meta.invoiceDate = invoiceDate;

      metaByOrderId.set(orderId, meta);
    }
    if (!metaByOrderId.size) return rows;

    // Quantity must be applied once per Order ID — popup/table sum child rows.
    const quantityAttachedForOrder = new Set<string>();

    return rows.map((row) => {
      if (row.source !== 'amazon_payment_transactions') return row;
      const orderId = String(row.orderId ?? '').trim();
      const meta = metaByOrderId.get(orderId);
      if (!meta) return row;

      const next: PaymentAnalyticsRow = { ...row };
      let changed = false;

      if (!String(next.sellerSku ?? '').trim() && meta.skus.length) {
        next.sellerSku =
          meta.skus.length === 1 ? meta.skus[0] : meta.skus.join(', ');
        changed = true;
      }

      if (!String(next.invoiceId ?? '').trim() && meta.invoices.length) {
        next.invoiceId = meta.invoices.join(', ');
        changed = true;
      }

      if (!String(next.invoiceDate ?? '').trim() && meta.invoiceDate) {
        next.invoiceDate = meta.invoiceDate;
        changed = true;
      }

      if (
        next.quantity == null &&
        meta.quantity !== 0 &&
        !quantityAttachedForOrder.has(orderId)
      ) {
        next.quantity = meta.quantity;
        quantityAttachedForOrder.add(orderId);
        changed = true;
      }

      return changed ? next : row;
    });
  }

  /**
   * Attach Flipkart GST Sale invoices + Credit/Debit Notes / Sales/Return
   * Cancellations from import_rows onto payment rows for the same Order IDs.
   *
   * Payment-report NEFTs often only carry return settlements for fully-returned
   * orders; GST Sale invoices still live in import_rows and must be included so
   * Order Details / lifecycle see every sale line.
   *
   * GST Return invoices are always attached as financial line items (canonical
   * return documents, including cancelled / re-issued invoice pairs). When they
   * are present, {@link aggregateOrderPaymentLifecycle} skips Flipkart payment
   * refund amounts so multi-item rolled-up NEFT refunds are not double-counted.
   * Return invoice numbers are also applied via
   * {@link enrichFlipkartOrderDetailsMetadata}.
   *
   * Notes/sales/returns only affect Sales/Return aggregation
   * (bank/fees stay 0 on GST rows).
   *
   * Performance: constrain by Flipkart payment order IDs (`$in` batches) so we
   * do not scan every Sale/CN/DN/cancel row for the seller.
   */
  private async attachFlipkartCreditDebitNotes(
    rows: PaymentAnalyticsRow[],
    sellerAliases: string[],
    query: ListAnalyticsPaymentsDto,
  ): Promise<PaymentAnalyticsRow[]> {
    const flipkartOrderIds = new Set<string>();
    for (const row of rows) {
      if (row.source !== 'flipkart_payment_order_reports') continue;
      const orderId = String(row.orderId ?? '').trim();
      if (orderId) flipkartOrderIds.add(orderId);
    }
    const forcedOrderId = String(query.orderId ?? '').trim();
    if (forcedOrderId) flipkartOrderIds.add(forcedOrderId);
    if (!flipkartOrderIds.size) return rows;

    const bundle = await this.loadFlipkartGstAttachBundle(
      flipkartOrderIds,
      sellerAliases,
      query,
    );
    const uncoveredReturns = selectUncoveredFlipkartGstReturnRows(
      rows,
      bundle.returnFinancialRows,
    );
    const attachRows = [...bundle.financialRows, ...uncoveredReturns];
    const withNotes = attachRows.length ? [...rows, ...attachRows] : rows;
    return enrichFlipkartOrderDetailsMetadata(
      withNotes,
      bundle.returnInvoices,
    );
  }

  private async loadFlipkartNoteAnalyticsRows(
    flipkartOrderIds: Set<string>,
    sellerAliases: string[],
    query: ListAnalyticsPaymentsDto,
  ): Promise<PaymentAnalyticsRow[]> {
    const bundle = await this.loadFlipkartGstAttachBundle(
      flipkartOrderIds,
      sellerAliases,
      query,
    );
    // Without payment rows, only attach non-return GST financial docs.
    return bundle.financialRows;
  }

  private async loadFlipkartGstAttachBundle(
    flipkartOrderIds: Set<string>,
    sellerAliases: string[],
    query: ListAnalyticsPaymentsDto,
  ): Promise<{
    financialRows: PaymentAnalyticsRow[];
    returnFinancialRows: PaymentAnalyticsRow[];
    returnInvoices: FlipkartGstReturnInvoiceMeta[];
  }> {
    if (!flipkartOrderIds.size) {
      return {
        financialRows: [],
        returnFinancialRows: [],
        returnInvoices: [],
      };
    }

    const sellerObjectIds = sellerAliases
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const flipkartLinkIds = await this.resolveMarketplaceLinkIds(
      sellerAliases,
      'flipkart',
    );
    const marketplaceMatch: Record<string, unknown>[] = [
      { marketplace: { $regex: /flipkart/i } },
    ];
    if (flipkartLinkIds.length) {
      marketplaceMatch.push({ marketplace: { $in: flipkartLinkIds } });
    }

    const baseFilter: Record<string, unknown> = {
      sellerId: {
        $in:
          sellerObjectIds.length > 0
            ? [...sellerObjectIds, ...sellerAliases]
            : sellerAliases,
      },
      $and: [
        {
          $or: [
            // Exact Sale/Sales only — do not match Sales Cancellation.
            { documentType: { $regex: /^sales?$/i } },
            { documentType: { $regex: /credit\s*note/i } },
            { documentType: { $regex: /debit\s*note/i } },
            { documentType: { $regex: /return\s*cancel/i } },
            { documentType: { $regex: /cancel/i } },
            // GST Return / RTO invoices — financial when uncovered by payment.
            { documentType: { $regex: /return|rto|refund/i } },
          ],
        },
        { $or: marketplaceMatch },
      ],
    };
    const gstin = String(query.gstin ?? '').trim().toUpperCase();
    if (gstin) baseFilter.gstin = gstin;

    const noteSelect = {
      orderID: 1,
      documentType: 1,
      invoiceNo: 1,
      invoiceAmount: 1,
      taxableAmount: 1,
      igstAmount: 1,
      cgstAmount: 1,
      sgstAmount: 1,
      invoiceDate: 1,
      reportMonth: 1,
      skuID: 1,
      quantity: 1,
      gstin: 1,
      marketplace: 1,
      transactionId: 1,
    } as const;

    const orderIdBatches = chunkArray([...flipkartOrderIds], 1000);
    const noteDocs = (
      await Promise.all(
        orderIdBatches.map((batch) =>
          this.rowModel
            .find({
              ...baseFilter,
              orderID: { $in: batch },
            })
            .select(noteSelect)
            .lean()
            .exec(),
        ),
      )
    ).flat();

    const financialRows: PaymentAnalyticsRow[] = [];
    const returnFinancialRows: PaymentAnalyticsRow[] = [];
    const returnInvoices: FlipkartGstReturnInvoiceMeta[] = [];
    for (const doc of noteDocs) {
      const orderId = String(doc.orderID ?? '').trim();
      if (!orderId || !flipkartOrderIds.has(orderId)) continue;

      if (isFlipkartGstReturnDocumentType(doc.documentType)) {
        const mappedReturn = mapFlipkartNoteImportRowToAnalyticsRow(
          doc as Parameters<typeof mapFlipkartNoteImportRowToAnalyticsRow>[0],
        );
        if (!mappedReturn) continue;

        // Positive-amount GST "Return" → Return Cancellation (sales-side note).
        if (
          isFlipkartReturnCancellationDocumentType(mappedReturn.documentType)
        ) {
          financialRows.push(mappedReturn);
          continue;
        }

        const invoiceId = String(doc.invoiceNo ?? '').trim();
        if (!invoiceId) continue;
        returnInvoices.push({
          orderId,
          sellerSku: normalizeFlipkartImportSku(doc.skuID),
          invoiceId,
          invoiceDate:
            repairDateToIso(doc.invoiceDate, doc.reportMonth) || undefined,
        });
        returnFinancialRows.push(mappedReturn);
        continue;
      }

      const mapped = mapFlipkartNoteImportRowToAnalyticsRow(
        doc as Parameters<typeof mapFlipkartNoteImportRowToAnalyticsRow>[0],
      );
      if (!mapped) continue;
      financialRows.push(mapped);
    }
    return { financialRows, returnFinancialRows, returnInvoices };
  }

  private async listLegacyImportRowPayments(
    query: ListAnalyticsPaymentsDto,
    sellerAliases: string[],
    limit: number,
    skip: number,
  ) {
    const marketplaceSlug = await this.resolveMarketplaceSlug(query.marketplace);
    const legacyQuery: ListAnalyticsPaymentsDto = {
      ...query,
      marketplace: marketplaceSlug || undefined,
    };
    const filter = await this.buildLegacyFilter(legacyQuery, sellerAliases);
    const sortBy = query.sortBy ?? 'paymentDate';
    const sortOrder = query.sortOrder === 'desc' ? -1 : 1;
    const status = String(query.paymentStatus ?? '')
      .trim()
      .toLowerCase();

    // Legacy import_rows: load matching rows then paginate by unique Order ID
    // (same grain as dedicated Flipkart/Amazon/Meesho payments list).
    const docs = await this.rowModel
      .find(filter)
      .sort({ [sortBy]: sortOrder })
      .limit(100_000)
      .lean()
      .exec();
    const mapped = docs.map((row) => mapImportRowToPaymentAnalyticsRow(row));
    const filtered = status
      ? this.filterByPaymentStatus(mapped, status)
      : mapped;
    const { pageRows, totalOrders } = this.sortAndPaginateByUniqueOrderId(
      filtered,
      String(sortBy),
      sortOrder === -1 ? 'desc' : 'asc',
      skip,
      limit,
    );
    return {
      success: true,
      data: pageRows,
      total: totalOrders,
      limit,
      skip,
      source: 'import_rows' as const,
    };
  }
}
