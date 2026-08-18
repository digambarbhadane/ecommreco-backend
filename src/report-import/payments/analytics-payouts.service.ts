import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ListAnalyticsPayoutsDto } from '../dto/list-analytics-payouts.dto';
import type { UpsertPayoutReceiptDto } from '../dto/upsert-payout-receipt.dto';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import { ValidationService } from '../services/validation.service';
import { applyPaymentFiltersToMongoFilter } from '../utils/payment-filter.util';
import {
  buildPaymentSummaryByNeftPipeline,
  summarizePaymentNeftRows,
  type PaymentNeftSummaryRow,
} from '../utils/payment-summary.aggregation';
import { FlipkartPaymentRepository } from './flipkart/flipkart-payment.repository';
import {
  FLIPKART_PAYMENT_SECONDARY_SHEETS,
} from './flipkart/sheets/flipkart-payment-sheet-kinds';
import { FlipkartPaymentSecondaryRepository } from './flipkart/sheets/flipkart-payment-secondary.repository';
import {
  SellerPayoutRecord,
  SellerPayoutRecordDocument,
} from './schemas/seller-payout-record.schema';
import { repairDateToIso } from '../../common/utils/repair-legacy-date.util';
import {
  MeeshoOrderPayments,
  MeeshoOrderPaymentsDocument,
} from './meesho/schemas/order-payments.schema';
import { MeeshoAdsCost, MeeshoAdsCostDocument } from './meesho/schemas/ads-cost.schema';
import {
  MeeshoReferralPayments,
  MeeshoReferralPaymentsDocument,
} from './meesho/schemas/referral-payments.schema';
import {
  MeeshoCompensationRecovery,
  MeeshoCompensationRecoveryDocument,
} from './meesho/schemas/compensation-recovery.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../../marketplaces/schemas/marketplace.schema';
import {
  AmazonPaymentTransaction,
  AmazonPaymentTransactionDocument,
} from './amazon/schemas/amazon-payment-transaction.schema';
import { MyntraPgRepository } from './myntra/myntra-pg.repository';

export type MeeshoPayoutSheetKind =
  | 'ads'
  | 'referralPayments'
  | 'compensationRecovery';

export type PayoutSheetTotals = Record<string, number>;
export type PayoutSheetCounts = Record<string, number>;

const MEESHO_PAYOUT_SHEETS: Array<{ kind: MeeshoPayoutSheetKind; label: string }> =
  [
    { kind: 'ads', label: 'Ads Cost' },
    { kind: 'referralPayments', label: 'Referral Payments' },
    { kind: 'compensationRecovery', label: 'Compensation and Recovery' },
  ];

const AMAZON_PAYOUT_SHEETS = [
  {
    kind: 'amazonTransactions',
    label: 'Amazon Payment Transactions',
  },
] as const;

const MYNTRA_PAYOUT_SHEETS = [
  { kind: 'pg-forward', label: 'PG Forward Settled' },
  { kind: 'pg-reverse', label: 'PG Reverse Settled' },
] as const;

const PAYOUT_SHEET_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    FLIPKART_PAYMENT_SECONDARY_SHEETS.map((def) => [def.kind, def.label]),
  ),
  ...Object.fromEntries(MEESHO_PAYOUT_SHEETS.map((def) => [def.kind, def.label])),
  ...Object.fromEntries(AMAZON_PAYOUT_SHEETS.map((def) => [def.kind, def.label])),
  ...Object.fromEntries(MYNTRA_PAYOUT_SHEETS.map((def) => [def.kind, def.label])),
  ads: 'Ads Cost',
};

export type PayoutExpandedSheet = {
  kind: string;
  label: string;
  total: number;
  count: number;
  rows: Array<Record<string, unknown>>;
};

export type PayoutComponents = {
  netSales: number;
  commissionExpense: number;
  customerReturnCharges: number;
  claims: number;
  ads: number;
};

export type PayoutAnalyticsRow = {
  neftId: string;
  marketplace: string;
  paymentDate: string;
  /** Grand total = orderTotal + all secondary sheet totals */
  bankSettlementTotal: number;
  orderTotal: number;
  orderCount: number;
  sheetTotals: PayoutSheetTotals;
  sheetCounts: PayoutSheetCounts;
  salesCount: number;
  returnsCount: number;
  bankReceiveDate: string;
  bankReceiveAmount: number | null;
  variance: number | null;
  receiptId?: string;
  expandedData?: PayoutExpandedSheet[];
  components: PayoutComponents;
};

export type PayoutSheetBreakdownItem = {
  kind: string;
  label: string;
  total: number;
  count: number;
};

export type PayoutAnalyticsTotals = {
  bankSettlementTotal: number;
  salesCount: number;
  returnsCount: number;
  orderTotal: number;
  orderCount: number;
  sheetTotals: PayoutSheetTotals;
  sheetCounts: PayoutSheetCounts;
  sheetBreakdown: PayoutSheetBreakdownItem[];
  netSales: number;
  commissionExpense: number;
  customerReturnCharges: number;
  claims: number;
  ads: number;
  /** Net sales − commission − customer return charges + claims */
  totalSettlement: number;
  /** Total settlement − ads */
  bankPayout: number;
};

function emptyPayoutComponents(): PayoutComponents {
  return {
    netSales: 0,
    commissionExpense: 0,
    customerReturnCharges: 0,
    claims: 0,
    ads: 0,
  };
}

function absAmount(value: unknown): number {
  return Math.abs(Number(value ?? 0));
}

function derivePayoutFormulas(components: PayoutComponents): {
  totalSettlement: number;
  bankPayout: number;
} {
  const totalSettlement =
    Number(components.netSales ?? 0) -
    Number(components.commissionExpense ?? 0) -
    Number(components.customerReturnCharges ?? 0) +
    Number(components.claims ?? 0);
  return {
    totalSettlement,
    bankPayout: totalSettlement - Number(components.ads ?? 0),
  };
}

function componentsFromSheets(
  sheetTotals: PayoutSheetTotals,
  base: PayoutComponents = emptyPayoutComponents(),
): PayoutComponents {
  return {
    ...base,
    claims:
      Number(base.claims ?? 0) +
      absAmount(sheetTotals.nonOrderSpf) +
      absAmount(sheetTotals.compensationRecovery),
    ads:
      Number(base.ads ?? 0) +
      absAmount(sheetTotals.ads) +
      absAmount(sheetTotals.googleAdsServices),
  };
}

function emptySheetTotals(): PayoutSheetTotals {
  const totals: PayoutSheetTotals = {};
  for (const def of FLIPKART_PAYMENT_SECONDARY_SHEETS) {
    totals[def.kind] = 0;
  }
  for (const def of MEESHO_PAYOUT_SHEETS) {
    totals[def.kind] = 0;
  }
  for (const def of AMAZON_PAYOUT_SHEETS) {
    totals[def.kind] = 0;
  }
  for (const def of MYNTRA_PAYOUT_SHEETS) {
    totals[def.kind] = 0;
  }
  return totals;
}

function emptySheetCounts(): PayoutSheetCounts {
  const counts: PayoutSheetCounts = {};
  for (const def of FLIPKART_PAYMENT_SECONDARY_SHEETS) {
    counts[def.kind] = 0;
  }
  for (const def of MEESHO_PAYOUT_SHEETS) {
    counts[def.kind] = 0;
  }
  for (const def of AMAZON_PAYOUT_SHEETS) {
    counts[def.kind] = 0;
  }
  for (const def of MYNTRA_PAYOUT_SHEETS) {
    counts[def.kind] = 0;
  }
  return counts;
}

function sumSheetTotals(sheetTotals: PayoutSheetTotals): number {
  return Object.values(sheetTotals).reduce(
    (sum, value) => sum + Number(value ?? 0),
    0,
  );
}

function knownSheetKinds(): string[] {
  return Array.from(
    new Set([
      ...FLIPKART_PAYMENT_SECONDARY_SHEETS.map((def) => def.kind),
      ...MEESHO_PAYOUT_SHEETS.map((def) => def.kind),
      ...AMAZON_PAYOUT_SHEETS.map((def) => def.kind),
      ...MYNTRA_PAYOUT_SHEETS.map((def) => def.kind),
    ]),
  );
}

function buildSheetBreakdown(input: {
  orderTotal: number;
  orderCount: number;
  sheetTotals: PayoutSheetTotals;
  sheetCounts: PayoutSheetCounts;
}): PayoutSheetBreakdownItem[] {
  const items: PayoutSheetBreakdownItem[] = [
    {
      kind: 'orders',
      label: 'Orders',
      total: Number(input.orderTotal ?? 0),
      count: Number(input.orderCount ?? 0),
    },
  ];
  for (const kind of knownSheetKinds()) {
    items.push({
      kind,
      label: PAYOUT_SHEET_LABELS[kind] ?? kind,
      total: Number(input.sheetTotals[kind] ?? 0),
      count: Number(input.sheetCounts[kind] ?? 0),
    });
  }
  return items;
}

function summarizePayoutRows(rows: PayoutAnalyticsRow[]): PayoutAnalyticsTotals {
  const sheetTotals = emptySheetTotals();
  const sheetCounts = emptySheetCounts();
  let bankSettlementTotal = 0;
  let salesCount = 0;
  let returnsCount = 0;
  let orderTotal = 0;
  let orderCount = 0;
  const components = emptyPayoutComponents();

  for (const row of rows) {
    bankSettlementTotal += Number(row.bankSettlementTotal ?? 0);
    salesCount += Number(row.salesCount ?? 0);
    returnsCount += Number(row.returnsCount ?? 0);
    orderTotal += Number(row.orderTotal ?? 0);
    orderCount += Number(row.orderCount ?? 0);
    components.netSales += Number(row.components?.netSales ?? 0);
    components.commissionExpense += Number(row.components?.commissionExpense ?? 0);
    components.customerReturnCharges += Number(
      row.components?.customerReturnCharges ?? 0,
    );
    components.claims += Number(row.components?.claims ?? 0);
    components.ads += Number(row.components?.ads ?? 0);
    for (const kind of knownSheetKinds()) {
      sheetTotals[kind] =
        Number(sheetTotals[kind] ?? 0) + Number(row.sheetTotals?.[kind] ?? 0);
      sheetCounts[kind] =
        Number(sheetCounts[kind] ?? 0) + Number(row.sheetCounts?.[kind] ?? 0);
    }
  }

  const derived = derivePayoutFormulas(components);
  return {
    bankSettlementTotal,
    salesCount,
    returnsCount,
    orderTotal,
    orderCount,
    sheetTotals,
    sheetCounts,
    sheetBreakdown: buildSheetBreakdown({
      orderTotal,
      orderCount,
      sheetTotals,
      sheetCounts,
    }),
    ...components,
    ...derived,
  };
}

function emptyPayoutAnalyticsTotals(): PayoutAnalyticsTotals {
  return {
    bankSettlementTotal: 0,
    salesCount: 0,
    returnsCount: 0,
    orderTotal: 0,
    orderCount: 0,
    sheetTotals: emptySheetTotals(),
    sheetCounts: emptySheetCounts(),
    sheetBreakdown: buildSheetBreakdown({
      orderTotal: 0,
      orderCount: 0,
      sheetTotals: emptySheetTotals(),
      sheetCounts: emptySheetCounts(),
    }),
    ...emptyPayoutComponents(),
    ...derivePayoutFormulas(emptyPayoutComponents()),
  };
}

@Injectable()
export class AnalyticsPayoutsService {
  constructor(
    private readonly flipkartPaymentRepository: FlipkartPaymentRepository,
    private readonly secondaryRepository: FlipkartPaymentSecondaryRepository,
    private readonly myntraPgRepository: MyntraPgRepository,
    private readonly validationService: ValidationService,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(MeeshoOrderPayments.name)
    private readonly meeshoOrderPaymentsModel: Model<MeeshoOrderPaymentsDocument>,
    @InjectModel(MeeshoAdsCost.name)
    private readonly meeshoAdsCostModel: Model<MeeshoAdsCostDocument>,
    @InjectModel(MeeshoReferralPayments.name)
    private readonly meeshoReferralPaymentsModel: Model<MeeshoReferralPaymentsDocument>,
    @InjectModel(MeeshoCompensationRecovery.name)
    private readonly meeshoCompensationRecoveryModel: Model<MeeshoCompensationRecoveryDocument>,
    @InjectModel(AmazonPaymentTransaction.name)
    private readonly amazonPaymentTransactionModel: Model<AmazonPaymentTransactionDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(SellerPayoutRecord.name)
    private readonly payoutRecordModel: Model<SellerPayoutRecordDocument>,
  ) {}

  async listPayouts(query: ListAnalyticsPayoutsDto) {
    const sellerId = String(query.sellerId ?? '').trim();
    if (!sellerId) {
      return {
        success: true,
        data: [],
        total: 0,
        limit: 0,
        skip: 0,
        totals: emptyPayoutAnalyticsTotals(),
      };
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const limit = Math.max(0, Number(query.limit ?? '50'));
    const skip = Math.max(0, Number(query.skip ?? '0'));

    const marketplaceSlug =
      String(query.marketplaceSlug ?? '').trim().toLowerCase() ||
      (await this.resolveMarketplaceSlug(query.marketplace));
    const selectedMarketplace = String(query.marketplace ?? '').trim();
    const normalizedQuery: ListAnalyticsPayoutsDto = {
      ...query,
      // Payment collections historically store the marketplace-link ObjectId,
      // while newer Meesho collections store the platform slug. Keep the
      // selected storage identifier here; marketplaceSlug is only for routing.
      marketplace: selectedMarketplace || marketplaceSlug,
    };

    let aggregated: Awaited<ReturnType<typeof this.aggregateMeeshoPayouts>> = [];
    let useLegacy = false;

    // Selected-marketplace requests must only inspect that marketplace. Besides
    // fixing link-id/slug mismatches, this avoids several unnecessary count and
    // aggregation queries on every filter change.
    if (marketplaceSlug === 'meesho') {
      const hasMeesho = await this.hasMeeshoPaymentData(query, sellerAliases);
      if (hasMeesho) {
        aggregated = await this.aggregateMeeshoPayouts(
          normalizedQuery,
          sellerAliases,
        );
      } else {
        useLegacy = true;
        aggregated = await this.aggregateLegacyPayouts(
          normalizedQuery,
          sellerAliases,
        );
      }
    } else if (marketplaceSlug === 'flipkart') {
      aggregated = await this.aggregateFlipkartPayouts(
        normalizedQuery,
        sellerAliases,
      );
      if (aggregated.length === 0) {
        useLegacy = true;
        aggregated = await this.aggregateLegacyPayouts(
          normalizedQuery,
          sellerAliases,
        );
      }
    } else if (marketplaceSlug === 'amazon') {
      aggregated = await this.aggregateAmazonPayouts(
        normalizedQuery,
        sellerAliases,
      );
    } else if (marketplaceSlug === 'myntra') {
      const hasMyntra = await this.hasMyntraPaymentData(
        normalizedQuery,
        sellerAliases,
      );
      if (hasMyntra) {
        aggregated = await this.aggregateMyntraPayouts(
          normalizedQuery,
          sellerAliases,
        );
      } else {
        useLegacy = true;
        aggregated = await this.aggregateLegacyPayouts(
          normalizedQuery,
          sellerAliases,
        );
      }
    } else if (marketplaceSlug) {
      // Myntra and future marketplaces currently use normalized legacy rows.
      useLegacy = true;
      aggregated = await this.aggregateLegacyPayouts(
        normalizedQuery,
        sellerAliases,
      );
    } else {
      // Run marketplace aggregations in parallel. Existence probes used to
      // serialize extra countDocuments before any aggregation started.
      const [meeshoRows, flipkartRows, amazonRows, myntraRows, flipkartExists] =
        await Promise.all([
          this.aggregateMeeshoPayouts(
            { ...query, marketplace: 'meesho' },
            sellerAliases,
          ),
          this.aggregateFlipkartPayouts(
            { ...query, marketplace: undefined },
            sellerAliases,
          ),
          this.aggregateAmazonPayouts(
            { ...query, marketplace: undefined },
            sellerAliases,
          ),
          this.aggregateMyntraPayouts(
            { ...query, marketplace: undefined },
            sellerAliases,
          ),
          this.flipkartPaymentRepository.existsByFilter({
            sellerIds: sellerAliases,
          }),
        ]);
      useLegacy = !flipkartExists;
      const flipkartOrLegacy = useLegacy
        ? await this.aggregateLegacyPayouts(
            { ...query, marketplace: undefined },
            sellerAliases,
          )
        : flipkartRows;
      aggregated = [
        ...meeshoRows,
        ...flipkartOrLegacy,
        ...amazonRows,
        ...myntraRows,
      ];
    }

    const receipts = await this.payoutRecordModel
      .find({
        sellerId: { $in: sellerAliases },
        ...(query.gstin
          ? { gstin: query.gstin.trim().toUpperCase() }
          : {}),
        ...(selectedMarketplace
          ? {
              marketplace: {
                $in: Array.from(
                  new Set([selectedMarketplace, marketplaceSlug].filter(Boolean)),
                ),
              },
            }
          : {}),
      })
      .lean()
      .exec();

    const receiptByMarketplaceNeft = new Map(
      receipts.map((r) => [`${r.marketplace}::${r.neftId}`, r] as const),
    );
    const receiptByNeft = new Map<string, (typeof receipts)[number]>();
    for (const receipt of receipts) {
      if (!receiptByNeft.has(receipt.neftId)) {
        receiptByNeft.set(receipt.neftId, receipt);
      }
    }

    let rows: PayoutAnalyticsRow[] = aggregated.map((row) => {
      const receipt =
        receiptByMarketplaceNeft.get(`${row.marketplace}::${row.neftId}`) ??
        receiptByNeft.get(row.neftId);
      const bankReceiveAmount =
        receipt?.bankReceiveAmount != null
          ? Number(receipt.bankReceiveAmount)
          : null;
      const bankSettlementTotal = Number(row.bankSettlementTotal ?? 0);
      const variance =
        bankReceiveAmount != null
          ? bankReceiveAmount - bankSettlementTotal
          : null;

      return {
        neftId: row.neftId,
        marketplace: row.marketplace,
        paymentDate:
          repairDateToIso(row.paymentDate ?? receipt?.paymentDate ?? '') ?? '',
        bankSettlementTotal,
        orderTotal: Number(row.orderTotal ?? 0),
        orderCount: Number(row.orderCount ?? 0),
        sheetTotals: row.sheetTotals ?? emptySheetTotals(),
        sheetCounts: row.sheetCounts ?? emptySheetCounts(),
        salesCount: Number(row.salesCount ?? 0),
        returnsCount: Number(row.returnsCount ?? 0),
        bankReceiveDate:
          repairDateToIso(receipt?.bankReceiveDate ?? '') ??
          receipt?.bankReceiveDate ??
          '',
        bankReceiveAmount,
        variance,
        receiptId: receipt?._id?.toString(),
        components: row.components ?? emptyPayoutComponents(),
      };
    });

    const search = String(query.search ?? '').trim().toLowerCase();
    if (search) {
      rows = rows.filter(
        (r) =>
          r.neftId.toLowerCase().includes(search) ||
          r.marketplace.toLowerCase().includes(search),
      );
    }

    const totals = summarizePayoutRows(rows);
    const receiptCounts = {
      all: rows.length,
      verified: rows.filter((r) => r.bankReceiveAmount != null).length,
      pending: rows.filter((r) => r.bankReceiveAmount == null).length,
      verifiedAmount: rows
        .filter((r) => r.bankReceiveAmount != null)
        .reduce((sum, r) => sum + Number(r.bankReceiveAmount ?? 0), 0),
      pendingAmount: rows
        .filter((r) => r.bankReceiveAmount == null)
        .reduce((sum, r) => sum + Number(r.bankSettlementTotal ?? 0), 0),
    };

    const receiptStatus = String(query.receiptStatus ?? 'all').trim().toLowerCase();
    if (receiptStatus === 'verified') {
      rows = rows.filter((r) => r.bankReceiveAmount != null);
    } else if (receiptStatus === 'pending') {
      rows = rows.filter((r) => r.bankReceiveAmount == null);
    }

    const sortBy = query.sortBy ?? 'bankSettlementTotal';
    const sortDir = query.sortOrder === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortBy as keyof PayoutAnalyticsRow];
      const bv = b[sortBy as keyof PayoutAnalyticsRow];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * sortDir;
      }
      return String(av).localeCompare(String(bv)) * sortDir;
    });

    const total = rows.length;
    const data = rows.slice(skip, skip + limit);

    // Sheet summaries only. Line-item rows are loaded on expand via
    // getPayoutExpandedDetails — attaching them here scanned up to 100k
    // payment rows per NEFT on every list request.
    for (const row of data) {
      row.expandedData = this.buildExpandedSheetSummaries(row);
    }

    return {
      success: true,
      data,
      total,
      limit,
      skip,
      totals,
      receiptCounts,
      source: useLegacy
        ? ('import_rows' as const)
        : ('flipkart_payment_order_reports' as const),
    };
  }

  async getPayoutExpandedDetails(query: {
    sellerId?: string;
    marketplace?: string;
    neftId?: string;
    gstin?: string;
    paymentDate?: string;
  }) {
    const sellerId = String(query.sellerId ?? '').trim();
    const marketplace = String(query.marketplace ?? '').trim();
    const neftId = String(query.neftId ?? '').trim();
    if (!sellerId || !marketplace || !neftId) {
      return { success: false, data: [] as PayoutExpandedSheet[] };
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const slug = await this.resolveMarketplaceSlug(marketplace);
    const row: PayoutAnalyticsRow = {
      neftId,
      marketplace,
      paymentDate: String(query.paymentDate ?? ''),
      bankSettlementTotal: 0,
      orderTotal: slug === 'amazon' ? 0 : 1,
      orderCount: slug === 'amazon' ? 0 : 1,
      sheetTotals: emptySheetTotals(),
      sheetCounts: emptySheetCounts(),
      salesCount: 0,
      returnsCount: 0,
      bankReceiveDate: '',
      bankReceiveAmount: null,
      variance: null,
      components: emptyPayoutComponents(),
    };
    if (slug === 'amazon') {
      row.sheetTotals.amazonTransactions = 1;
      row.sheetCounts.amazonTransactions = 1;
    }
    row.expandedData = this.buildExpandedSheetSummaries(row);
    for (const kind of knownSheetKinds()) {
      if (!row.expandedData.some((sheet) => sheet.kind === kind)) {
        row.expandedData.push({
          kind,
          label: PAYOUT_SHEET_LABELS[kind] ?? kind,
          total: 0,
          count: 0,
          rows: [],
        });
      }
    }

    await Promise.all([
      this.attachAmazonExpandedRows([row], sellerAliases),
      this.attachOtherExpandedRows([row], sellerAliases, query.gstin),
    ]);

    const data = (row.expandedData ?? []).filter(
      (sheet) => (sheet.rows?.length ?? 0) > 0,
    );
    for (const sheet of data) {
      if (!sheet.count) sheet.count = sheet.rows.length;
    }

    return { success: true, data };
  }

  async upsertReceipt(dto: UpsertPayoutReceiptDto, updatedBy?: string) {
    const sellerId = String(dto.sellerId ?? '').trim();
    const neftId = String(dto.neftId ?? '').trim();
    const marketplace = String(dto.marketplace ?? '').trim();

    if (!sellerId || !neftId || !marketplace) {
      return { success: false, message: 'sellerId, marketplace, and neftId are required' };
    }

    const gstin = dto.gstin?.trim().toUpperCase();

    const update: Partial<SellerPayoutRecord> = {
      sellerId,
      marketplace,
      neftId,
      updatedBy,
    };

    if (gstin) update.gstin = gstin;
    if (dto.paymentDate !== undefined) update.paymentDate = dto.paymentDate;
    if (dto.bankSettlementTotal !== undefined) {
      update.bankSettlementTotal = Number(dto.bankSettlementTotal);
    }
    if (dto.bankReceiveDate !== undefined) {
      update.bankReceiveDate = dto.bankReceiveDate;
    }
    if (dto.bankReceiveAmount !== undefined) {
      update.bankReceiveAmount = Number(dto.bankReceiveAmount);
    }

    const doc = await this.payoutRecordModel
      .findOneAndUpdate(
        { sellerId, marketplace, neftId },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    const bankSettlementTotal = Number(
      doc?.bankSettlementTotal ?? dto.bankSettlementTotal ?? 0,
    );
    const bankReceiveAmount =
      doc?.bankReceiveAmount != null ? Number(doc.bankReceiveAmount) : null;

    return {
      success: true,
      data: {
        receiptId: doc?._id?.toString(),
        neftId,
        marketplace,
        paymentDate: doc?.paymentDate ?? '',
        bankSettlementTotal,
        bankReceiveDate: doc?.bankReceiveDate ?? '',
        bankReceiveAmount,
        variance:
          bankReceiveAmount != null
            ? bankReceiveAmount - bankSettlementTotal
            : null,
      },
    };
  }

  /** Clear bank receive date/amount so variance resets until user re-enters. */
  async resetReceipt(
    dto: {
      sellerId: string;
      marketplace: string;
      neftId: string;
      gstin?: string;
    },
    updatedBy?: string,
  ) {
    const sellerId = String(dto.sellerId ?? '').trim();
    const neftId = String(dto.neftId ?? '').trim();
    const marketplace = String(dto.marketplace ?? '').trim();

    if (!sellerId || !neftId || !marketplace) {
      return { success: false, message: 'sellerId, marketplace, and neftId are required' };
    }

    const doc = await this.payoutRecordModel
      .findOneAndUpdate(
        { sellerId, marketplace, neftId },
        {
          $unset: { bankReceiveDate: 1, bankReceiveAmount: 1 },
          $set: {
            updatedBy,
            ...(dto.gstin ? { gstin: dto.gstin.trim().toUpperCase() } : {}),
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    return {
      success: true,
      data: {
        receiptId: doc?._id?.toString(),
        neftId,
        marketplace,
        paymentDate: doc?.paymentDate ?? '',
        bankSettlementTotal: Number(doc?.bankSettlementTotal ?? 0),
        bankReceiveDate: '',
        bankReceiveAmount: null,
        variance: null,
      },
    };
  }

  /**
   * On Flipkart payment re-upload: clear bank receive values for affected NEFTs
   * so variance does not stay based on stale manual amounts.
   */
  async resetReceiptsForNefts(input: {
    sellerId: string;
    marketplace: string;
    neftIds: string[];
    updatedBy?: string;
  }): Promise<number> {
    const sellerId = String(input.sellerId ?? '').trim();
    const marketplace = String(input.marketplace ?? '').trim();
    const neftIds = [...new Set(input.neftIds.map((id) => String(id).trim()).filter(Boolean))];
    if (!sellerId || !marketplace || !neftIds.length) return 0;

    const result = await this.payoutRecordModel
      .updateMany(
        { sellerId, marketplace, neftId: { $in: neftIds } },
        {
          $unset: { bankReceiveDate: 1, bankReceiveAmount: 1 },
          $set: { updatedBy: input.updatedBy },
        },
      )
      .exec();

    return result.modifiedCount ?? 0;
  }

  /**
   * Month-summary / Payments-tab Flipkart NEFT view (orders + all secondary sheets).
   */
  async summarizeFlipkartPaymentForMonth(query: {
    sellerIds: string[];
    gstin?: string;
    marketplace: string;
    reportMonth: string;
  }) {
    const aggregated = await this.aggregateFlipkartPayouts(
      {
        sellerId: query.sellerIds[0],
        gstin: query.gstin,
        marketplace: query.marketplace,
        // reportMonth is applied inside via repository filters when provided
      } as ListAnalyticsPayoutsDto & { reportMonth?: string },
      query.sellerIds,
    );

    // Re-aggregate with explicit reportMonth on order + secondary collections.
    const filterQuery = {
      sellerIds: query.sellerIds,
      gstin: query.gstin,
      marketplace: query.marketplace,
      reportMonth: query.reportMonth,
    };

    const [orderRows, secondaryRows] = await Promise.all([
      this.flipkartPaymentRepository.aggregatePayoutsByNeft(filterQuery),
      this.secondaryRepository.sumSettlementByNeft(filterQuery),
    ]);

    const byNeft = new Map<
      string,
      {
        neftId: string;
        paymentDate: string;
        orderTotal: number;
        orderCount: number;
        salesCount: number;
        returnsCount: number;
        sheetTotals: PayoutSheetTotals;
        sheetCounts: PayoutSheetCounts;
      }
    >();

    for (const row of orderRows) {
      byNeft.set(row.neftId, {
        neftId: row.neftId,
        paymentDate: row.paymentDate ?? '',
        orderTotal: Number(row.bankSettlementTotal ?? 0),
        orderCount: Number(row.orderCount ?? 0),
        salesCount: Number(row.salesCount ?? 0),
        returnsCount: Number(row.returnsCount ?? 0),
        sheetTotals: emptySheetTotals(),
        sheetCounts: emptySheetCounts(),
      });
    }

    for (const row of secondaryRows) {
      const existing = byNeft.get(row.neftId);
      if (existing) {
        existing.sheetTotals = { ...existing.sheetTotals, ...row.totals };
        existing.sheetCounts = { ...existing.sheetCounts, ...row.counts };
      } else {
        byNeft.set(row.neftId, {
          neftId: row.neftId,
          paymentDate: '',
          orderTotal: 0,
          orderCount: 0,
          salesCount: 0,
          returnsCount: 0,
          sheetTotals: { ...emptySheetTotals(), ...row.totals },
          sheetCounts: { ...emptySheetCounts(), ...row.counts },
        });
      }
    }

    // Prefer paymentDate from the unrestricted aggregate when missing.
    for (const row of aggregated) {
      const existing = byNeft.get(row.neftId);
      if (existing && !existing.paymentDate && row.paymentDate) {
        existing.paymentDate = row.paymentDate;
      }
    }

    const rows = Array.from(byNeft.values()).map((row) => ({
      neftNo: row.neftId,
      paymentDate: row.paymentDate,
      orderTotal: row.orderTotal,
      bankSettlementTotal: row.orderTotal + sumSheetTotals(row.sheetTotals),
      salesCount: row.salesCount,
      returnsCount: row.returnsCount,
      sheetTotals: row.sheetTotals,
      sheetCounts: row.sheetCounts,
    }));

    rows.sort((a, b) => b.bankSettlementTotal - a.bankSettlementTotal);

    const payoutLikeRows: PayoutAnalyticsRow[] = rows.map((row) => ({
      neftId: row.neftNo,
      marketplace: query.marketplace,
      paymentDate: row.paymentDate,
      bankSettlementTotal: row.bankSettlementTotal,
      orderTotal: row.orderTotal,
      orderCount: 0,
      sheetTotals: row.sheetTotals,
      sheetCounts: row.sheetCounts,
      salesCount: row.salesCount,
      returnsCount: row.returnsCount,
      bankReceiveDate: '',
      bankReceiveAmount: null,
      variance: null,
      components: emptyPayoutComponents(),
    }));

    const totals = summarizePayoutRows(payoutLikeRows);

    return {
      rows,
      totals: {
        bankSettlementTotal: totals.bankSettlementTotal,
        salesCount: totals.salesCount,
        returnsCount: totals.returnsCount,
        orderTotal: totals.orderTotal,
        sheetBreakdown: totals.sheetBreakdown,
      },
    };
  }

  /**
   * Month-summary / Payments-tab Amazon settlement view (from payment report uploads).
   */
  async summarizeAmazonPaymentForMonth(query: {
    sellerIds: string[];
    gstin?: string;
    marketplace: string;
    reportMonth: string;
  }) {
    const match: Record<string, unknown> = {
      sellerId: { $in: query.sellerIds },
      marketplace: query.marketplace,
      reportMonth: query.reportMonth,
    };
    const gstin = query.gstin?.trim().toUpperCase();
    if (gstin) {
      match.gstin = gstin;
    }

    const returnLikeExpr = {
      $or: [
        {
          $regexMatch: {
            input: { $toLower: { $ifNull: ['$transactionType', ''] } },
            regex: 'refund|return',
          },
        },
        {
          $regexMatch: {
            input: { $toLower: { $ifNull: ['$amountDescription', ''] } },
            regex: 'refund|return',
          },
        },
      ],
    };

    const aggregated = await this.amazonPaymentTransactionModel
      .aggregate<{
        settlementId: string;
        paymentDate: Date | string;
        bankSettlementTotal: number;
        salesCount: number;
        returnsCount: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: { $trim: { input: { $ifNull: ['$settlementId', ''] } } },
            paymentDate: { $max: '$depositDate' },
            bankSettlementTotal: { $sum: { $ifNull: ['$amount', 0] } },
            salesCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ne: [
                          { $trim: { input: { $ifNull: ['$orderId', ''] } } },
                          '',
                        ],
                      },
                      { $not: returnLikeExpr },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            returnsCount: {
              $sum: { $cond: [returnLikeExpr, 1, 0] },
            },
          },
        },
        { $match: { _id: { $ne: '' } } },
        { $sort: { bankSettlementTotal: -1, _id: 1 } },
        {
          $project: {
            _id: 0,
            settlementId: '$_id',
            paymentDate: 1,
            bankSettlementTotal: 1,
            salesCount: 1,
            returnsCount: 1,
          },
        },
      ])
      .allowDiskUse(true)
      .exec();

    const rows = aggregated.map((row) => ({
      neftNo: row.settlementId,
      bankSettlementTotal: Number(row.bankSettlementTotal ?? 0),
      salesCount: Number(row.salesCount ?? 0),
      returnsCount: Number(row.returnsCount ?? 0),
      paymentDate:
        row.paymentDate instanceof Date
          ? row.paymentDate.toISOString()
          : String(row.paymentDate ?? ''),
      orderTotal: 0,
    }));

    return {
      rows,
      totals: {
        ...summarizePaymentNeftRows(rows),
        orderTotal: 0,
        sheetBreakdown: [],
      },
    };
  }

  private async aggregateFlipkartPayouts(
    query: ListAnalyticsPayoutsDto,
    sellerAliases: string[],
  ) {
    const filterQuery = {
      sellerIds: sellerAliases,
      gstin: query.gstin,
      marketplace: query.marketplace,
      paymentDateFrom: query.paymentDateFrom,
      paymentDateTo: query.paymentDateTo,
      search: query.search,
    };

    const [orderRows, secondaryRows] = await Promise.all([
      this.flipkartPaymentRepository.aggregatePayoutsByNeft(filterQuery),
      this.secondaryRepository.sumSettlementByNeft(filterQuery),
    ]);

    const byNeft = new Map<
      string,
      {
        neftId: string;
        marketplace: string;
        paymentDate: string;
        orderTotal: number;
        orderCount: number;
        salesCount: number;
        returnsCount: number;
        sheetTotals: PayoutSheetTotals;
        sheetCounts: PayoutSheetCounts;
        components: PayoutComponents;
      }
    >();

    for (const row of orderRows) {
      byNeft.set(row.neftId, {
        neftId: row.neftId,
        marketplace: row.marketplace,
        paymentDate: row.paymentDate ?? '',
        orderTotal: Number(row.bankSettlementTotal ?? 0),
        orderCount: Number(row.orderCount ?? 0),
        salesCount: Number(row.salesCount ?? 0),
        returnsCount: Number(row.returnsCount ?? 0),
        sheetTotals: emptySheetTotals(),
        sheetCounts: emptySheetCounts(),
        components: {
          ...emptyPayoutComponents(),
          netSales: Number(row.netSales ?? 0),
          commissionExpense: absAmount(row.commissionExpense),
          customerReturnCharges: absAmount(row.customerReturnCharges),
        },
      });
    }

    for (const row of secondaryRows) {
      const existing = byNeft.get(row.neftId);
      if (existing) {
        existing.sheetTotals = { ...existing.sheetTotals, ...row.totals };
        existing.sheetCounts = { ...existing.sheetCounts, ...row.counts };
      } else {
        byNeft.set(row.neftId, {
          neftId: row.neftId,
          marketplace: String(query.marketplace ?? 'flipkart'),
          paymentDate: '',
          orderTotal: 0,
          orderCount: 0,
          salesCount: 0,
          returnsCount: 0,
          sheetTotals: { ...emptySheetTotals(), ...row.totals },
          sheetCounts: { ...emptySheetCounts(), ...row.counts },
          components: emptyPayoutComponents(),
        });
      }
    }

    return Array.from(byNeft.values()).map((row) => ({
      ...row,
      bankSettlementTotal: row.orderTotal + sumSheetTotals(row.sheetTotals),
      components: componentsFromSheets(row.sheetTotals, row.components),
    }));
  }

  private buildExpandedSheetSummaries(
    row: PayoutAnalyticsRow,
  ): PayoutExpandedSheet[] {
    const expanded: PayoutExpandedSheet[] = [];
    if (Number(row.orderTotal ?? 0) !== 0 || Number(row.orderCount ?? 0) !== 0) {
      expanded.push({
        kind: 'orders',
        label: 'Orders',
        total: Number(row.orderTotal ?? 0),
        count: Number(row.orderCount ?? 0),
        rows: [],
      });
    }
    const kinds = new Set([
      ...knownSheetKinds(),
      ...Object.keys(row.sheetTotals ?? {}),
      ...Object.keys(row.sheetCounts ?? {}),
    ]);
    for (const kind of kinds) {
      const total = Number(row.sheetTotals?.[kind] ?? 0);
      const count = Number(row.sheetCounts?.[kind] ?? 0);
      if (count === 0 && total === 0) continue;
      expanded.push({
        kind,
        label: PAYOUT_SHEET_LABELS[kind] ?? kind,
        total,
        count,
        rows: [],
      });
    }
    return expanded;
  }

  private payoutDateKey(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value ?? ''));
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private setExpandedRows(
    row: PayoutAnalyticsRow,
    kind: string,
    records: Array<Record<string, unknown>>,
  ): void {
    if (!row.expandedData) row.expandedData = [];
    let sheet = row.expandedData.find((item) => item.kind === kind);
    if (!sheet) {
      sheet = {
        kind,
        label: PAYOUT_SHEET_LABELS[kind] ?? kind,
        total: 0,
        count: records.length,
        rows: records,
      };
      row.expandedData.push(sheet);
      return;
    }
    sheet.rows = records;
  }

  private async attachOtherExpandedRows(
    rows: PayoutAnalyticsRow[],
    sellerAliases: string[],
    gstin?: string,
  ): Promise<void> {
    const nonAmazonRows = rows.filter(
      (row) => Number(row.sheetCounts?.amazonTransactions ?? 0) === 0,
    );
    if (!nonAmazonRows.length) return;

    const uniqueMarketplaces = [
      ...new Set(nonAmazonRows.map((row) => row.marketplace)),
    ];
    const slugEntries = await Promise.all(
      uniqueMarketplaces.map(async (marketplace) => [
        marketplace,
        await this.resolveMarketplaceSlug(marketplace),
      ] as const),
    );
    const slugByMarketplace = new Map(slugEntries);

    const flipkartRows = nonAmazonRows.filter(
      (row) => slugByMarketplace.get(row.marketplace) === 'flipkart',
    );
    await Promise.all(
      flipkartRows.map(async (row) => {
        const orderSheet = row.expandedData?.find(
          (sheet) => sheet.kind === 'orders',
        );
        const [orders, secondary] = await Promise.all([
          orderSheet
            ? this.flipkartPaymentRepository.findBySeller({
                sellerIds: sellerAliases,
                marketplace: row.marketplace,
                gstin,
                neftId: row.neftId,
                limit: 100_000,
                skip: 0,
                sortBy: 'orderId',
                sortOrder: 'asc',
                skipTotal: true,
              })
            : Promise.resolve({ data: [] }),
          this.secondaryRepository.listByNeftIds({
            sellerIds: sellerAliases,
            marketplace: row.marketplace,
            gstin,
            neftIds: [row.neftId],
          }),
        ]);
        this.setExpandedRows(
          row,
          'orders',
          orders.data as unknown as Array<Record<string, unknown>>,
        );
        for (const [kind, records] of Object.entries(secondary)) {
          this.setExpandedRows(row, kind, records);
        }
      }),
    );

    const meeshoRows = nonAmazonRows.filter(
      (row) => slugByMarketplace.get(row.marketplace) === 'meesho',
    );
    const myntraRows = nonAmazonRows.filter(
      (row) => slugByMarketplace.get(row.marketplace) === 'myntra',
    );
    if (myntraRows.length) {
      await Promise.all(
        myntraRows.map(async (row) => {
          const records = await this.myntraPgRepository.findRowsByNeft({
            sellerIds: sellerAliases,
            marketplace: row.marketplace,
            gstin,
            neftId: row.neftId,
          });
          this.setExpandedRows(
            row,
            'pg-forward',
            records.filter((record) => record.reportKind === 'forward'),
          );
          this.setExpandedRows(
            row,
            'pg-reverse',
            records.filter((record) => record.reportKind === 'reverse'),
          );
        }),
      );
    }
    if (meeshoRows.length) {
      const dates = meeshoRows
        .map((row) => new Date(row.paymentDate))
        .filter((date) => !Number.isNaN(date.getTime()));
      if (dates.length) {
        const minDate = new Date(
          Math.min(...dates.map((date) => date.getTime())),
        );
        const maxDate = new Date(
          Math.max(...dates.map((date) => date.getTime())),
        );
        minDate.setUTCDate(minDate.getUTCDate() - 1);
        maxDate.setUTCDate(maxDate.getUTCDate() + 1);
        const baseFilter = this.meeshoSellerFilter(sellerAliases, gstin);
        const range = { $gte: minDate, $lte: maxDate };
        const [orders, ads, referrals, compensation] = await Promise.all([
          this.meeshoOrderPaymentsModel
            .find({ ...baseFilter, paymentDate: range })
            .lean()
            .exec(),
          this.meeshoAdsCostModel
            .find({ ...baseFilter, deductionDate: range })
            .lean()
            .exec(),
          this.meeshoReferralPaymentsModel
            .find({ ...baseFilter, paymentDate: range })
            .lean()
            .exec(),
          this.meeshoCompensationRecoveryModel
            .find({ ...baseFilter, date: range })
            .lean()
            .exec(),
        ]);
        for (const row of meeshoRows) {
          const dateKey = this.payoutDateKey(row.paymentDate);
          this.setExpandedRows(
            row,
            'orders',
            orders.filter(
              (record) =>
                this.payoutDateKey(record.paymentDate) === dateKey,
            ) as unknown as Array<Record<string, unknown>>,
          );
          this.setExpandedRows(
            row,
            'ads',
            ads.filter(
              (record) =>
                this.payoutDateKey(record.deductionDate) === dateKey,
            ) as unknown as Array<Record<string, unknown>>,
          );
          this.setExpandedRows(
            row,
            'referralPayments',
            referrals.filter(
              (record) =>
                this.payoutDateKey(record.paymentDate) === dateKey,
            ) as unknown as Array<Record<string, unknown>>,
          );
          this.setExpandedRows(
            row,
            'compensationRecovery',
            compensation.filter(
              (record) => this.payoutDateKey(record.date) === dateKey,
            ) as unknown as Array<Record<string, unknown>>,
          );
        }
      }
    }

    const legacyRows = nonAmazonRows.filter((row) => {
      const slug = slugByMarketplace.get(row.marketplace);
      return slug !== 'flipkart' && slug !== 'meesho' && slug !== 'myntra';
    });
    await Promise.all(
      legacyRows.map(async (row) => {
        const records = await this.rowModel
          .find({
            sellerId: { $in: sellerAliases },
            marketplace: row.marketplace,
            ...(gstin ? { gstin: gstin.trim().toUpperCase() } : {}),
            transactionId: row.neftId,
          })
          .lean()
          .exec();
        this.setExpandedRows(
          row,
          'orders',
          records as unknown as Array<Record<string, unknown>>,
        );
      }),
    );
  }

  private async attachAmazonExpandedRows(
    rows: PayoutAnalyticsRow[],
    sellerAliases: string[],
  ): Promise<void> {
    const amazonRows = rows.filter(
      (row) => Number(row.sheetCounts?.amazonTransactions ?? 0) > 0,
    );
    if (!amazonRows.length) return;

    const settlementIds = [...new Set(amazonRows.map((row) => row.neftId))];
    const marketplaceIds = [
      ...new Set(amazonRows.map((row) => row.marketplace)),
    ];
    const transactions = await this.amazonPaymentTransactionModel
      .find({
        sellerId: { $in: sellerAliases },
        marketplace: { $in: marketplaceIds },
        settlementId: { $in: settlementIds },
      })
      .select({
        _id: 0,
        settlementId: 1,
        marketplace: 1,
        orderId: 1,
        transactionType: 1,
        amountDescription: 1,
        amount: 1,
        sourceRowNumber: 1,
      })
      .sort({ orderId: 1, sourceRowNumber: 1 })
      .lean()
      .exec();

    type AmazonOrderGroup = {
      orderId: string;
      components: Map<string, number>;
      totalAmount: number;
      rowCount: number;
      sourceRowNumber: number;
    };
    type AmazonTransactionGroups = Map<
      string,
      Map<string, AmazonOrderGroup>
    >;

    const groupedBySettlement = new Map<
      string,
      AmazonTransactionGroups
    >();
    for (const transaction of transactions) {
      const settlementKey = `${transaction.marketplace}::${transaction.settlementId}`;
      const orderId = String(transaction.orderId ?? '').trim();
      const orderKey = orderId || '__settlement_level__';
      const transactionType =
        String(transaction.transactionType ?? '').trim() || 'Other';
      const transactionGroups =
        groupedBySettlement.get(settlementKey) ??
        new Map<string, Map<string, AmazonOrderGroup>>();
      const orderGroups =
        transactionGroups.get(transactionType) ??
        new Map<string, AmazonOrderGroup>();
      const group = orderGroups.get(orderKey) ?? {
        orderId,
        components: new Map<string, number>(),
        totalAmount: 0,
        rowCount: 0,
        sourceRowNumber: Number(transaction.sourceRowNumber ?? 0),
      };
      const description =
        String(transaction.amountDescription ?? '') || 'Unspecified';
      const amount = Number(transaction.amount ?? 0);
      group.components.set(
        description,
        Number(group.components.get(description) ?? 0) + amount,
      );
      group.totalAmount += amount;
      group.rowCount += 1;
      group.sourceRowNumber = Math.min(
        group.sourceRowNumber,
        Number(transaction.sourceRowNumber ?? group.sourceRowNumber),
      );
      orderGroups.set(orderKey, group);
      transactionGroups.set(transactionType, orderGroups);
      groupedBySettlement.set(settlementKey, transactionGroups);
    }

    for (const row of amazonRows) {
      const amazonSheet = row.expandedData?.find(
        (sheet) => sheet.kind === 'amazonTransactions',
      );
      if (amazonSheet) {
        const transactionGroups =
          groupedBySettlement.get(`${row.marketplace}::${row.neftId}`) ??
          new Map<string, Map<string, AmazonOrderGroup>>();
        amazonSheet.rows = Array.from(transactionGroups.entries())
          .map(([transactionType, orderGroups]) => {
            const children = Array.from(orderGroups.values())
              .sort((a, b) => {
                if (!a.orderId && b.orderId) return -1;
                if (a.orderId && !b.orderId) return 1;
                return a.orderId.localeCompare(b.orderId);
              })
              .map((group) => ({
                orderId: group.orderId,
                components: Array.from(group.components.entries()).map(
                  ([amountDescription, amount]) => ({
                    amountDescription,
                    amount,
                  }),
                ),
                totalAmount: group.totalAmount,
                rowCount: group.rowCount,
                sourceRowNumber: group.sourceRowNumber,
              }));
            return {
              transactionType,
              children,
              totalAmount: children.reduce(
                (total, child) => total + child.totalAmount,
                0,
              ),
              rowCount: children.reduce(
                (total, child) => total + child.rowCount,
                0,
              ),
            };
          })
          .sort((a, b) =>
            a.transactionType.localeCompare(b.transactionType),
          );
      }
    }
  }

  private async shouldUseLegacyImportRows(
    query: Pick<ListAnalyticsPayoutsDto, 'marketplace' | 'sellerId'>,
    sellerAliases: string[],
  ): Promise<boolean> {
    const marketplace = String(query.marketplace ?? '').trim();
    if (!marketplace || marketplace === 'flipkart') {
      const flipkartExists = await this.flipkartPaymentRepository.existsByFilter({
        sellerIds: sellerAliases,
        ...(marketplace === 'flipkart' ? { marketplace: 'flipkart' } : {}),
      });
      return !flipkartExists;
    }

    if (marketplace === 'meesho') return true;

    const collectionExists = await this.flipkartPaymentRepository.existsByFilter({
      sellerIds: sellerAliases,
      marketplace,
    });
    return !collectionExists;
  }

  private dateRangeFilter(
    from?: string,
    to?: string,
  ): Record<string, Date> | undefined {
    const start = from ? new Date(from) : null;
    const end = to ? new Date(to) : null;
    const filter: Record<string, Date> = {};
    if (start && !Number.isNaN(start.getTime())) filter.$gte = start;
    if (end && !Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      filter.$lte = end;
    }
    return Object.keys(filter).length ? filter : undefined;
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
    const sellerIdFilter =
      sellerObjectIds.length > 0
        ? { $in: [...sellerObjectIds, ...sellerAliases] }
        : { $in: sellerAliases };
    const filter: Record<string, unknown> = {
      sellerId: sellerIdFilter,
      marketplace: 'meesho',
    };
    if (gstin) filter.gstin = gstin.trim().toUpperCase();
    return filter;
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
    if (name.includes('amazon')) return 'amazon';
    return name || lower;
  }

  private async hasMeeshoPaymentData(
    query: Pick<ListAnalyticsPayoutsDto, 'gstin'>,
    sellerAliases: string[],
  ): Promise<boolean> {
    const filter = this.meeshoSellerFilter(sellerAliases, query.gstin);
    const exists = await this.meeshoOrderPaymentsModel.exists(filter);
    return Boolean(exists);
  }

  private async aggregateSheetByDate(
    model: Model<any>,
    filter: Record<string, unknown>,
    dateField: string,
    amountExpr: Record<string, unknown>,
  ): Promise<Map<string, { total: number; count: number }>> {
    const rows = await model
      .aggregate<{ dateKey: string; total: number; count: number }>([
        { $match: filter },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: `$${dateField}`,
                timezone: 'Asia/Kolkata',
              },
            },
            total: { $sum: amountExpr },
            count: { $sum: 1 },
          },
        },
        { $project: { _id: 0, dateKey: '$_id', total: 1, count: 1 } },
      ])
      .exec();
    return new Map(
      rows
        .filter((r) => r.dateKey)
        .map((r) => [r.dateKey, { total: Number(r.total ?? 0), count: Number(r.count ?? 0) }] as const),
    );
  }

  private async aggregateAmazonPayouts(
    query: ListAnalyticsPayoutsDto,
    sellerAliases: string[],
  ) {
    const filter: Record<string, unknown> = {
      sellerId: { $in: sellerAliases },
    };
    if (query.gstin) {
      filter.gstin = query.gstin.trim().toUpperCase();
    }
    if (query.marketplace) {
      filter.marketplace = query.marketplace;
    }
    const depositDateRange = this.dateRangeFilter(
      query.paymentDateFrom,
      query.paymentDateTo,
    );
    if (depositDateRange) {
      filter.depositDate = depositDateRange;
    }

    const settlements = await this.amazonPaymentTransactionModel
      .aggregate<{
        settlementId: string;
        marketplace: string;
        paymentDate: Date | string;
        transactionTotal: number;
        transactionCount: number;
        orderCount: number;
        netSales: number;
        commissionExpense: number;
        customerReturnCharges: number;
        claims: number;
        ads: number;
      }>([
        { $match: filter },
        {
          $group: {
            _id: {
              settlementId: '$settlementId',
              marketplace: '$marketplace',
            },
            paymentDate: { $max: '$depositDate' },
            transactionTotal: { $sum: { $ifNull: ['$amount', 0] } },
            transactionCount: { $sum: 1 },
            netSales: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $regexMatch: {
                          input: {
                            $toLower: {
                              $concat: [
                                { $ifNull: ['$transactionType', ''] },
                                ' ',
                                { $ifNull: ['$amountDescription', ''] },
                              ],
                            },
                          },
                          regex: 'principal|product tax',
                        },
                      },
                      {
                        $not: {
                          $regexMatch: {
                            input: {
                              $toLower: {
                                $concat: [
                                  { $ifNull: ['$transactionType', ''] },
                                  ' ',
                                  { $ifNull: ['$amountDescription', ''] },
                                ],
                              },
                            },
                            regex: 'refund|return',
                          },
                        },
                      },
                    ],
                  },
                  { $ifNull: ['$amount', 0] },
                  0,
                ],
              },
            },
            commissionExpense: {
              $sum: {
                $cond: [
                  {
                    $regexMatch: {
                      input: {
                        $toLower: {
                          $concat: [
                            { $ifNull: ['$transactionType', ''] },
                            ' ',
                            { $ifNull: ['$amountDescription', ''] },
                          ],
                        },
                      },
                      regex: 'commission',
                    },
                  },
                  { $abs: { $ifNull: ['$amount', 0] } },
                  0,
                ],
              },
            },
            customerReturnCharges: {
              $sum: {
                $cond: [
                  {
                    $regexMatch: {
                      input: {
                        $toLower: {
                          $concat: [
                            { $ifNull: ['$transactionType', ''] },
                            ' ',
                            { $ifNull: ['$amountDescription', ''] },
                          ],
                        },
                      },
                      regex: 'refund|return',
                    },
                  },
                  { $abs: { $ifNull: ['$amount', 0] } },
                  0,
                ],
              },
            },
            claims: {
              $sum: {
                $cond: [
                  {
                    $regexMatch: {
                      input: {
                        $toLower: {
                          $concat: [
                            { $ifNull: ['$transactionType', ''] },
                            ' ',
                            { $ifNull: ['$amountDescription', ''] },
                          ],
                        },
                      },
                      regex: 'claim|reimbursement|safe-t',
                    },
                  },
                  { $ifNull: ['$amount', 0] },
                  0,
                ],
              },
            },
            ads: {
              $sum: {
                $cond: [
                  {
                    $regexMatch: {
                      input: {
                        $toLower: {
                          $concat: [
                            { $ifNull: ['$transactionType', ''] },
                            ' ',
                            { $ifNull: ['$amountDescription', ''] },
                          ],
                        },
                      },
                      regex: 'servicefee|advert|sponsored',
                    },
                  },
                  { $abs: { $ifNull: ['$amount', 0] } },
                  0,
                ],
              },
            },
            orderIds: {
              $addToSet: {
                $cond: [
                  { $ne: [{ $trim: { input: { $ifNull: ['$orderId', ''] } } }, ''] },
                  '$orderId',
                  '$$REMOVE',
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            settlementId: '$_id.settlementId',
            marketplace: '$_id.marketplace',
            paymentDate: 1,
            transactionTotal: 1,
            transactionCount: 1,
            orderCount: { $size: '$orderIds' },
            netSales: 1,
            commissionExpense: 1,
            customerReturnCharges: 1,
            claims: 1,
            ads: 1,
          },
        },
      ])
      .option({ allowDiskUse: true, maxTimeMS: 30_000 })
      .exec();

    return settlements
      .filter((row) => String(row.settlementId ?? '').trim())
      .map((row) => {
        const transactionTotal = Number(row.transactionTotal ?? 0);
        const transactionCount = Number(row.transactionCount ?? 0);
        const orderCount = Number(row.orderCount ?? 0);
        return {
          neftId: String(row.settlementId),
          marketplace: String(row.marketplace),
          paymentDate:
            row.paymentDate instanceof Date
              ? row.paymentDate.toISOString()
              : String(row.paymentDate ?? ''),
          orderTotal: 0,
          orderCount: 0,
          bankSettlementTotal: transactionTotal,
          sheetTotals: {
            ...emptySheetTotals(),
            amazonTransactions: transactionTotal,
          },
          sheetCounts: {
            ...emptySheetCounts(),
            amazonTransactions: transactionCount,
          },
          salesCount: orderCount,
          returnsCount: 0,
          components: {
            netSales: Number(row.netSales ?? 0),
            commissionExpense: absAmount(row.commissionExpense),
            customerReturnCharges: absAmount(row.customerReturnCharges),
            claims: Number(row.claims ?? 0),
            ads: absAmount(row.ads),
          },
        };
      });
  }

  private async aggregateMeeshoPayouts(
    query: ListAnalyticsPayoutsDto,
    sellerAliases: string[],
  ) {
    const filter = this.meeshoSellerFilter(sellerAliases, query.gstin);
    const paymentDateRange = this.dateRangeFilter(
      query.paymentDateFrom,
      query.paymentDateTo,
    );
    if (paymentDateRange) filter.paymentDate = paymentDateRange;

    const orderRowsPromise = this.meeshoOrderPaymentsModel
      .aggregate<{
        paymentDateKey: string;
        neftId: string;
        orderTotal: number;
        orderCount: number;
        netSales: number;
        commissionExpense: number;
        customerReturnCharges: number;
        claims: number;
      }>([
        { $match: filter },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$paymentDate',
                timezone: 'Asia/Kolkata',
              },
            },
            orderTotal: { $sum: { $ifNull: ['$finalSettlementAmount', 0] } },
            orderCount: { $sum: 1 },
            netSales: {
              $sum: {
                $subtract: [
                  { $ifNull: ['$totalSaleAmountInclShippingGst', 0] },
                  { $abs: { $ifNull: ['$totalSaleReturnAmountInclShippingGst', 0] } },
                ],
              },
            },
            commissionExpense: {
              $sum: { $abs: { $ifNull: ['$meeshoCommissionInclGst', 0] } },
            },
            customerReturnCharges: {
              $sum: {
                $add: [
                  { $abs: { $ifNull: ['$returnShippingChargeInclGst', 0] } },
                  { $abs: { $ifNull: ['$returnPremiumInclGst', 0] } },
                  { $abs: { $ifNull: ['$returnPremiumReturnInclGst', 0] } },
                ],
              },
            },
            claims: { $sum: { $ifNull: ['$claims', 0] } },
            transactionIds: {
              $addToSet: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$transactionId', null] },
                      { $ne: ['$transactionId', ''] },
                    ],
                  },
                  '$transactionId',
                  '$$REMOVE',
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            paymentDateKey: '$_id',
            neftId: {
              $cond: [
                { $gt: [{ $size: '$transactionIds' }, 0] },
                { $arrayElemAt: ['$transactionIds', 0] },
                {
                  $concat: [
                    'PAY-',
                    {
                      $replaceAll: {
                        input: '$_id',
                        find: '-',
                        replacement: '',
                      },
                    },
                  ],
                },
              ],
            },
            orderTotal: 1,
            orderCount: 1,
            netSales: 1,
            commissionExpense: 1,
            customerReturnCharges: 1,
            claims: 1,
          },
        },
      ])
      .exec();

    const baseSheetFilter = this.meeshoSellerFilter(sellerAliases, query.gstin);
    const adsFilter = { ...baseSheetFilter };
    const referralFilter = { ...baseSheetFilter };
    const compensationFilter = { ...baseSheetFilter };
    if (paymentDateRange) {
      adsFilter.deductionDate = paymentDateRange;
      referralFilter.paymentDate = paymentDateRange;
      compensationFilter.date = paymentDateRange;
    }

    const [orderRows, adsByDate, referralByDate, compensationByDate] =
      await Promise.all([
      orderRowsPromise,
      this.aggregateSheetByDate(
        this.meeshoAdsCostModel,
        adsFilter,
        'deductionDate',
        {
          $ifNull: [
            '$totalAdsCost',
            {
              $ifNull: [
                '$adCostInclCreditsWaiversDiscounts',
                { $ifNull: ['$adCost', 0] },
              ],
            },
          ],
        },
      ),
      this.aggregateSheetByDate(
        this.meeshoReferralPaymentsModel,
        referralFilter,
        'paymentDate',
        { $ifNull: ['$netReferralAmount', 0] },
      ),
      this.aggregateSheetByDate(
        this.meeshoCompensationRecoveryModel,
        compensationFilter,
        'date',
        { $ifNull: ['$amountInclGstInr', 0] },
      ),
    ]);

    const byDate = new Map<
      string,
      {
        neftId: string;
        marketplace: string;
        paymentDate: string;
        orderTotal: number;
        orderCount: number;
        bankSettlementTotal: number;
        sheetTotals: PayoutSheetTotals;
        sheetCounts: PayoutSheetCounts;
        salesCount: number;
        returnsCount: number;
        components: PayoutComponents;
      }
    >();

    for (const row of orderRows) {
      const paymentDateKey = String(row.paymentDateKey ?? '');
      if (!paymentDateKey) continue;
      byDate.set(paymentDateKey, {
        neftId: String(row.neftId ?? `PAY-${paymentDateKey.replace(/-/g, '')}`),
        marketplace: 'meesho',
        paymentDate: paymentDateKey,
        orderTotal: Number(row.orderTotal ?? 0),
        orderCount: Number(row.orderCount ?? 0),
        bankSettlementTotal: Number(row.orderTotal ?? 0),
        sheetTotals: emptySheetTotals(),
        sheetCounts: emptySheetCounts(),
        salesCount: Number(row.orderCount ?? 0),
        returnsCount: 0,
        components: {
          ...emptyPayoutComponents(),
          netSales: Number(row.netSales ?? 0),
          commissionExpense: absAmount(row.commissionExpense),
          customerReturnCharges: absAmount(row.customerReturnCharges),
          claims: Number(row.claims ?? 0),
        },
      });
    }

    const allDateKeys = new Set([
      ...byDate.keys(),
      ...adsByDate.keys(),
      ...referralByDate.keys(),
      ...compensationByDate.keys(),
    ]);

    for (const paymentDateKey of allDateKeys) {
      let row = byDate.get(paymentDateKey);
      if (!row) {
        row = {
          neftId: `PAY-${paymentDateKey.replace(/-/g, '')}`,
          marketplace: 'meesho',
          paymentDate: paymentDateKey,
          orderTotal: 0,
          orderCount: 0,
          bankSettlementTotal: 0,
          sheetTotals: emptySheetTotals(),
          sheetCounts: emptySheetCounts(),
          salesCount: 0,
          returnsCount: 0,
          components: emptyPayoutComponents(),
        };
        byDate.set(paymentDateKey, row);
      }

      const ads = adsByDate.get(paymentDateKey);
      const referral = referralByDate.get(paymentDateKey);
      const compensation = compensationByDate.get(paymentDateKey);

      row.sheetTotals.ads = Number(ads?.total ?? 0);
      row.sheetCounts.ads = Number(ads?.count ?? 0);
      row.sheetTotals.referralPayments = Number(referral?.total ?? 0);
      row.sheetCounts.referralPayments = Number(referral?.count ?? 0);
      row.sheetTotals.compensationRecovery = Number(compensation?.total ?? 0);
      row.sheetCounts.compensationRecovery = Number(compensation?.count ?? 0);
      row.bankSettlementTotal =
        row.orderTotal +
        row.sheetTotals.ads +
        row.sheetTotals.referralPayments +
        row.sheetTotals.compensationRecovery;
      row.components = componentsFromSheets(row.sheetTotals, row.components);
    }

    return Array.from(byDate.values());
  }

  private async hasMyntraPaymentData(
    query: ListAnalyticsPayoutsDto,
    sellerAliases: string[],
  ): Promise<boolean> {
    const count = await this.myntraPgRepository.countByFilter({
      sellerIds: sellerAliases,
      gstin: query.gstin,
      marketplace: this.resolveMyntraMarketplaceFilter(query.marketplace),
    });
    return count > 0;
  }

  private resolveMyntraMarketplaceFilter(marketplace?: string): string | undefined {
    const value = String(marketplace ?? '').trim();
    if (!value || value.toLowerCase() === 'myntra') {
      return undefined;
    }
    return value;
  }

  private async aggregateMyntraPayouts(
    query: ListAnalyticsPayoutsDto,
    sellerAliases: string[],
  ) {
    const rows = await this.myntraPgRepository.aggregatePayoutsByNeft({
      sellerIds: sellerAliases,
      gstin: query.gstin,
      marketplace: this.resolveMyntraMarketplaceFilter(query.marketplace),
      paymentDateFrom: query.paymentDateFrom,
      paymentDateTo: query.paymentDateTo,
    });

    return rows.map((row) => ({
      neftId: row.neftId,
      marketplace: row.marketplace,
      paymentDate: row.paymentDate,
      orderTotal: 0,
      orderCount: 0,
      bankSettlementTotal: Number(row.bankSettlementTotal ?? 0),
      sheetTotals: {
        ...emptySheetTotals(),
        'pg-forward': Number(row.sheetTotals['pg-forward'] ?? 0),
        'pg-reverse': Number(row.sheetTotals['pg-reverse'] ?? 0),
      },
      sheetCounts: {
        ...emptySheetCounts(),
        'pg-forward': Number(row.sheetCounts['pg-forward'] ?? 0),
        'pg-reverse': Number(row.sheetCounts['pg-reverse'] ?? 0),
      },
      salesCount: Number(row.salesCount ?? 0),
      returnsCount: Number(row.returnsCount ?? 0),
      components: emptyPayoutComponents(),
    }));
  }

  private async aggregateLegacyPayouts(
    query: ListAnalyticsPayoutsDto,
    sellerAliases: string[],
  ) {
    const filter: Record<string, unknown> = {
      sellerId: { $in: sellerAliases },
    };
    if (query.gstin) filter.gstin = query.gstin.trim().toUpperCase();
    if (query.marketplace) filter.marketplace = query.marketplace;
    applyPaymentFiltersToMongoFilter(filter, {
      hasPaymentData: 'yes',
      paymentDateFrom: query.paymentDateFrom,
      paymentDateTo: query.paymentDateTo,
    });

    const summaryRows = await this.rowModel
      .aggregate<{
        neftNo: string;
        bankSettlementTotal: number;
        salesCount: number;
        returnsCount: number;
      }>([...buildPaymentSummaryByNeftPipeline(filter)])
      .option({ maxTimeMS: 30_000, allowDiskUse: true })
      .exec();

    const metaByNeft = await this.rowModel
      .aggregate<{
        _id: string;
        marketplace: string;
        paymentDate: string;
      }>([
        { $match: filter },
        {
          $match: {
            transactionId: { $exists: true, $nin: [null, ''] },
          },
        },
        {
          $group: {
            _id: { $trim: { input: { $ifNull: ['$transactionId', ''] } } },
            marketplace: { $first: { $ifNull: ['$marketplace', 'unknown'] } },
            paymentDate: { $max: { $ifNull: ['$paymentDate', ''] } },
          },
        },
      ])
      .option({ maxTimeMS: 30_000, allowDiskUse: true })
      .exec();

    const metaMap = new Map(
      metaByNeft.map((row) => [row._id, row] as const),
    );

    return summaryRows.map((row) => {
      const meta = metaMap.get(row.neftNo);
      const orderTotal = Number(row.bankSettlementTotal ?? 0);
      return {
        neftId: row.neftNo,
        marketplace: meta?.marketplace ?? 'unknown',
        paymentDate: meta?.paymentDate ?? '',
        bankSettlementTotal: orderTotal,
        orderTotal,
        orderCount: Number(row.salesCount ?? 0) + Number(row.returnsCount ?? 0),
        sheetTotals: emptySheetTotals(),
        sheetCounts: emptySheetCounts(),
        salesCount: Number(row.salesCount ?? 0),
        returnsCount: Number(row.returnsCount ?? 0),
        components: emptyPayoutComponents(),
      };
    });
  }
}
