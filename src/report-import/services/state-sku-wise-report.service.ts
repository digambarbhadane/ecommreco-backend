import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import ExcelJS from 'exceljs';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../../marketplaces/schemas/marketplace.schema';
import { Gst, GstDocument } from '../../gsts/schemas/gst.schema';
import { ValidationService } from './validation.service';
import { StateWiseExportDto } from '../dto/state-wise-export.dto';
import { buildStateWiseSalesMatch } from '../utils/state-wise-report.aggregation';
import {
  SkuMasterMapping,
  SkuMasterMappingDocument,
} from '../../sku-master/schemas/sku-master-mapping.schema';
import {
  FlipkartPaymentReport,
  FlipkartPaymentReportDocument,
} from '../payments/flipkart/schemas/flipkart-payment-report.schema';
import {
  MeeshoOrderPayments,
  MeeshoOrderPaymentsDocument,
} from '../payments/meesho/schemas/order-payments.schema';

type MarketplaceTarget = {
  id: string;
  name: string;
  matchKeys: string[];
};

type ReportContext = {
  sellerId: string;
  gstin: string;
  sellerAliases: string[];
  gstScopeIds: string[];
};

type SkuFinanceMetrics = {
  salesQty: number;
  returnQty: number;
  netPcs: number;
  grossSales: number;
  returnAmount: number;
  netSales: number;
  bankPayout: number;
  commission: number;
  cost: number;
  profit: number;
  returnPercent: number;
};

const EMPTY_FINANCE: SkuFinanceMetrics = {
  salesQty: 0,
  returnQty: 0,
  netPcs: 0,
  grossSales: 0,
  returnAmount: 0,
  netSales: 0,
  bankPayout: 0,
  commission: 0,
  cost: 0,
  profit: 0,
  returnPercent: 0,
};

type SkuMasterGroup = {
  masterSku: string;
  status: 'MAPPED' | 'UNMAPPED';
  productName?: string;
  category?: string;
  brand?: string;
  rates: Set<number>;
  marketplaceSkus: Array<{
    marketplace: string;
    marketplaceSku: string;
    rate: number | null;
    productName?: string;
  }>;
};

type SkuDetailRow = {
  label: string;
  gstRate: number;
  qty: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  invoiceAmount: number;
};

type StateGroup = {
  stateName: string;
  skus: SkuDetailRow[];
  qty: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  invoiceAmount: number;
};

const HEADERS = [
  'STATE Name',
  'GST RATE',
  'QTY',
  'TAXABLE VALUE',
  'IGST',
  'CGST',
  'SGST',
  'INVOICE AMOUNT',
] as const;

const NO_DATA_MESSAGE =
  'No data available for the selected seller, GSTIN, and marketplace. Import marketplace data first or verify your GST and marketplace selection.';

@Injectable()
export class StateSkuWiseReportService {
  private readonly logger = new Logger(StateSkuWiseReportService.name);

  constructor(
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(Gst.name)
    private readonly gstModel: Model<GstDocument>,
    @InjectModel(SkuMasterMapping.name)
    private readonly skuMasterMappingModel: Model<SkuMasterMappingDocument>,
    @InjectModel(FlipkartPaymentReport.name)
    private readonly flipkartPaymentModel: Model<FlipkartPaymentReportDocument>,
    @InjectModel(MeeshoOrderPayments.name)
    private readonly meeshoOrderPaymentsModel: Model<MeeshoOrderPaymentsDocument>,
    private readonly validationService: ValidationService,
  ) {}

  private sanitizeSheetName(name: string): string {
    const cleaned = String(name ?? '')
      .replace(/[\\/*?:[\]]/g, '')
      .trim();
    return (cleaned || 'Marketplace').slice(0, 31);
  }

  private formatGstRate(rate: number): string {
    if (!Number.isFinite(rate) || rate <= 0) return '0%';
    const rounded = Math.round(rate * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded}%`;
  }

  private platformIdOf(mp: { platformMarketplaceId?: unknown }): string {
    const ref = mp.platformMarketplaceId;
    if (ref && typeof ref === 'object' && ref !== null && '_id' in ref) {
      return String((ref as { _id: unknown })._id);
    }
    return ref ? String(ref) : '';
  }

  private resolveSkuGrouping(
    query: StateWiseExportDto,
  ): 'master_sku' | 'marketplace_sku' {
    return query.skuGrouping === 'marketplace_sku'
      ? 'marketplace_sku'
      : 'master_sku';
  }

  private async resolveContext(
    query: StateWiseExportDto,
  ): Promise<ReportContext> {
    const sellerId = String(query.sellerId ?? '').trim();
    const gstin = String(query.gstin ?? '')
      .trim()
      .toUpperCase();
    if (!sellerId) {
      throw new BadRequestException('sellerId is required');
    }
    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const gstScopeIds = gstin
      ? await this.resolveGstScopeIds(gstin, sellerAliases)
      : await this.resolveAllGstScopeIds(sellerAliases);
    return { sellerId, gstin, sellerAliases, gstScopeIds };
  }

  private async resolveAllGstScopeIds(
    sellerAliases: string[],
  ): Promise<string[]> {
    const records = await this.gstModel
      .find({ sellerId: { $in: sellerAliases } })
      .select('_id gstNumber')
      .lean()
      .exec();
    const scope = new Set<string>();
    for (const record of records) {
      if (record?._id) scope.add(String(record._id));
      const number = String(record?.gstNumber ?? '')
        .trim()
        .toUpperCase();
      if (number) scope.add(number);
    }
    return Array.from(scope);
  }

  private async resolveGstScopeIds(
    gstin: string,
    sellerAliases: string[],
  ): Promise<string[]> {
    const normalizedGstin = String(gstin ?? '')
      .trim()
      .toUpperCase();
    const scope = new Set<string>([normalizedGstin]);
    const gstRecord = await this.gstModel
      .findOne({
        gstNumber: normalizedGstin,
        sellerId: { $in: sellerAliases },
      })
      .select('_id')
      .lean()
      .exec();
    if (gstRecord?._id) {
      scope.add(String(gstRecord._id));
    }
    return Array.from(scope);
  }

  private async buildSalesFilter(
    ctx: ReportContext,
    query: StateWiseExportDto,
  ): Promise<Record<string, unknown>> {
    const filter = buildStateWiseSalesMatch({
      sellerId: { $in: ctx.sellerAliases },
      ...(ctx.gstin ? { gstin: ctx.gstin } : {}),
    });
    const reportMonth = String(query.reportMonth ?? '').trim();
    if (reportMonth) {
      filter.reportMonth = reportMonth;
    }
    if (query.fromDate || query.toDate) {
      const invoiceDate: Record<string, string> = {};
      if (query.fromDate) invoiceDate.$gte = query.fromDate;
      if (query.toDate) invoiceDate.$lte = query.toDate;
      filter.invoiceDate = invoiceDate;
    }
    return filter;
  }

  private async buildPlatformGroups(
    ctx: ReportContext,
    query: StateWiseExportDto,
  ): Promise<
    Array<{
      platformId: string;
      name: string;
      rowMarketplaceIds: string[];
      registeredLinkIds: string[];
    }>
  > {
    const salesFilter = await this.buildSalesFilter(ctx, query);
    const rowMarketplaceIds = (
      await this.rowModel.distinct('marketplace', salesFilter).exec()
    ).map(String);

    if (!rowMarketplaceIds.length) {
      return [];
    }

    const rowDocs = await this.marketplaceModel
      .find({ _id: { $in: rowMarketplaceIds } })
      .populate<{ platformMarketplaceId?: { name?: string; slug?: string } }>(
        'platformMarketplaceId',
        'name slug',
      )
      .lean()
      .exec();

    const registeredLinks = await this.marketplaceModel
      .find({
        sellerId: { $in: ctx.sellerAliases },
        ...(ctx.gstin && ctx.gstScopeIds.length
          ? { gstId: { $in: ctx.gstScopeIds } }
          : {}),
      })
      .populate<{ platformMarketplaceId?: { name?: string; slug?: string } }>(
        'platformMarketplaceId',
        'name slug',
      )
      .lean()
      .exec();

    const groups = new Map<
      string,
      {
        platformId: string;
        name: string;
        rowMarketplaceIds: Set<string>;
        registeredLinkIds: Set<string>;
      }
    >();

    const ensureGroup = (
      platformId: string,
      name: string,
    ): {
      platformId: string;
      name: string;
      rowMarketplaceIds: Set<string>;
      registeredLinkIds: Set<string>;
    } => {
      const key = platformId || `unknown:${name}`;
      const existing = groups.get(key);
      if (existing) return existing;
      const created = {
        platformId: platformId || key,
        name,
        rowMarketplaceIds: new Set<string>(),
        registeredLinkIds: new Set<string>(),
      };
      groups.set(key, created);
      return created;
    };

    for (const doc of rowDocs) {
      const platformId = this.platformIdOf(doc);
      const platform = doc.platformMarketplaceId as
        | { name?: string; slug?: string }
        | undefined;
      const name = String(platform?.name ?? doc.storeName ?? platformId);
      const group = ensureGroup(platformId, name);
      group.rowMarketplaceIds.add(String(doc._id));
    }

    for (const rawId of rowMarketplaceIds) {
      const hasDoc = rowDocs.some((doc) => String(doc._id) === rawId);
      if (!hasDoc) {
        const group = ensureGroup(`slug:${rawId.toLowerCase()}`, rawId);
        group.rowMarketplaceIds.add(rawId);
      }
    }

    for (const link of registeredLinks) {
      const platformId = this.platformIdOf(link);
      const platform = link.platformMarketplaceId as
        | { name?: string; slug?: string }
        | undefined;
      const name = String(platform?.name ?? link.storeName ?? platformId);
      const group = ensureGroup(platformId, name);
      group.registeredLinkIds.add(String(link._id));
    }

    return Array.from(groups.values())
      .filter((g) => g.rowMarketplaceIds.size > 0)
      .map((g) => ({
        platformId: g.platformId,
        name: g.name,
        rowMarketplaceIds: Array.from(g.rowMarketplaceIds),
        registeredLinkIds: Array.from(g.registeredLinkIds),
      }));
  }

  private groupToTarget(
    group: {
      platformId: string;
      name: string;
      rowMarketplaceIds: string[];
      registeredLinkIds: string[];
    },
    preferredId?: string,
  ): MarketplaceTarget {
    const matchKeys = Array.from(
      new Set([...group.rowMarketplaceIds, ...group.registeredLinkIds]),
    );
    const id =
      preferredId && matchKeys.includes(preferredId)
        ? preferredId
        : (group.registeredLinkIds[0] ??
          group.rowMarketplaceIds[0] ??
          group.platformId);
    return { id, name: group.name, matchKeys };
  }

  private async resolveMarketplaceTargets(
    query: StateWiseExportDto,
    ctx: ReportContext,
  ): Promise<MarketplaceTarget[]> {
    const groups = await this.buildPlatformGroups(ctx, query);
    if (!groups.length) return [];

    const single = String(query.marketplace ?? '').trim();
    if (single) {
      const selected = await this.marketplaceModel
        .findOne({ _id: single, sellerId: { $in: ctx.sellerAliases } })
        .lean()
        .exec();
      let platformId = selected ? this.platformIdOf(selected) : '';
      if (
        selected &&
        !ctx.gstScopeIds.includes(String(selected.gstId ?? '')) &&
        platformId
      ) {
        const corrected = await this.marketplaceModel
          .findOne({
            sellerId: { $in: ctx.sellerAliases },
            platformMarketplaceId: platformId,
            gstId: { $in: ctx.gstScopeIds },
          })
          .lean()
          .exec();
        if (corrected) platformId = this.platformIdOf(corrected);
      }
      const matched = groups.filter(
        (g) =>
          (platformId && g.platformId === platformId) ||
          g.rowMarketplaceIds.includes(single) ||
          g.registeredLinkIds.includes(single),
      );
      if (matched.length) return [this.groupToTarget(matched[0], single)];
      this.logger.warn(
        `Marketplace ${single} has no import rows for GSTIN ${ctx.gstin}`,
      );
      return [];
    }

    const idsFromQuery = String(query.marketplaceIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (idsFromQuery.length) {
      const selectedDocs = await this.marketplaceModel
        .find({
          _id: { $in: idsFromQuery },
          sellerId: { $in: ctx.sellerAliases },
        })
        .lean()
        .exec();
      const platformIds = new Set(
        selectedDocs.map((doc) => this.platformIdOf(doc)).filter(Boolean),
      );
      return groups
        .filter(
          (g) =>
            platformIds.has(g.platformId) ||
            g.registeredLinkIds.some((id) => idsFromQuery.includes(id)),
        )
        .map((g) => {
          const preferred =
            idsFromQuery.find((id) => g.registeredLinkIds.includes(id)) ??
            g.registeredLinkIds[0];
          return this.groupToTarget(g, preferred);
        });
    }

    return groups.map((g) => this.groupToTarget(g));
  }

  private normalizeState(value: unknown): string {
    const s = String(value ?? '').trim();
    return s || 'Unknown';
  }

  private numberOf(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  private roundMoney(value: number): number {
    return Number((Number.isFinite(value) ? value : 0).toFixed(2));
  }

  private isReturnImportRow(row: {
    documentType?: string;
    meeshoIsGrossSale?: boolean;
    myntraTransactionType?: string;
  }): boolean {
    if (row.meeshoIsGrossSale === false) return true;
    if (String(row.myntraTransactionType ?? '').toUpperCase() === 'RETURN') {
      return true;
    }
    const documentType = String(row.documentType ?? '').toUpperCase();
    return /RETURN|RTO/.test(documentType);
  }

  private emptyFinance(): SkuFinanceMetrics {
    return { ...EMPTY_FINANCE };
  }

  private finalizeFinance(metrics: SkuFinanceMetrics): SkuFinanceMetrics {
    const netPcs = metrics.salesQty - metrics.returnQty;
    const netSales = metrics.grossSales - metrics.returnAmount;
    const cost = this.roundMoney(metrics.cost);
    const commission = this.roundMoney(metrics.commission);
    const profit = netSales - commission - cost;
    const returnPercent =
      metrics.grossSales > 0
        ? (metrics.returnAmount / metrics.grossSales) * 100
        : metrics.salesQty > 0
          ? (metrics.returnQty / metrics.salesQty) * 100
          : 0;
    return {
      salesQty: this.roundMoney(metrics.salesQty),
      returnQty: this.roundMoney(metrics.returnQty),
      netPcs: this.roundMoney(netPcs),
      grossSales: this.roundMoney(metrics.grossSales),
      returnAmount: this.roundMoney(metrics.returnAmount),
      netSales: this.roundMoney(netSales),
      bankPayout: this.roundMoney(metrics.bankPayout),
      commission,
      cost,
      profit: this.roundMoney(profit),
      returnPercent: this.roundMoney(returnPercent),
    };
  }

  private async loadSkuFinanceMetrics(
    ctx: ReportContext,
    query: StateWiseExportDto,
    skuGrouping: 'master_sku' | 'marketplace_sku',
    masterByMarketplaceSku: Map<string, string>,
  ): Promise<Map<string, SkuFinanceMetrics>> {
    const finance = new Map<string, SkuFinanceMetrics>();
    const ensure = (key: string) => {
      const existing = finance.get(key);
      if (existing) return existing;
      const created = this.emptyFinance();
      finance.set(key, created);
      return created;
    };
    const resolveKey = (marketplaceSku: string) => {
      const sku = marketplaceSku.trim();
      if (!sku) return skuGrouping === 'master_sku' ? 'UNMAPPED' : 'N/A';
      if (skuGrouping === 'marketplace_sku') return sku;
      return masterByMarketplaceSku.get(sku) ?? 'UNMAPPED';
    };

    const salesFilter = await this.buildSalesFilter(ctx, query);
    const targets = await this.resolveMarketplaceTargets(query, ctx);
    const matchKeys = targets.flatMap((target) => target.matchKeys);
    const selectedMarketplace =
      Boolean(String(query.marketplace ?? '').trim()) ||
      Boolean(String(query.marketplaceIds ?? '').trim());
    if (selectedMarketplace && matchKeys.length) {
      salesFilter.marketplace = { $in: matchKeys };
    }
    const selectedNames = new Set(
      targets.map((target) => target.name.trim().toLowerCase()),
    );
    const includeFlipkart =
      !selectedMarketplace || selectedNames.has('flipkart');
    const includeMeesho = !selectedMarketplace || selectedNames.has('meesho');
    const importRows = await this.rowModel
      .find(salesFilter)
      .select({
        skuID: 1,
        quantity: 1,
        returnQty: 1,
        invoiceAmount: 1,
        meeshoReturnInvoiceAmount: 1,
        documentType: 1,
        meeshoIsGrossSale: 1,
        myntraTransactionType: 1,
      })
      .lean()
      .exec();

    for (const row of importRows) {
      const key = resolveKey(String(row.skuID ?? ''));
      const bucket = ensure(key);
      const isReturn = this.isReturnImportRow(row);
      if (isReturn) {
        bucket.returnQty += Math.abs(
          this.numberOf(row.returnQty || row.quantity),
        );
        bucket.returnAmount += Math.abs(
          this.numberOf(row.meeshoReturnInvoiceAmount || row.invoiceAmount),
        );
      } else {
        bucket.salesQty += this.numberOf(row.quantity);
        bucket.grossSales += this.numberOf(row.invoiceAmount);
      }
    }

    const paymentMatch: Record<string, unknown> = {
      sellerId: { $in: ctx.sellerAliases },
      ...(ctx.gstin ? { gstin: ctx.gstin } : {}),
    };
    if (query.fromDate || query.toDate) {
      const paymentDate: Record<string, string> = {};
      if (query.fromDate) paymentDate.$gte = query.fromDate;
      if (query.toDate) paymentDate.$lte = query.toDate;
      paymentMatch.paymentDate = paymentDate;
    }

    const flipkartRows = includeFlipkart
      ? await this.flipkartPaymentModel
          .find(paymentMatch)
          .select({
            sellerSku: 1,
            bankSettlementValue: 1,
            commission: 1,
          })
          .lean()
          .exec()
      : [];
    for (const row of flipkartRows) {
      const key = resolveKey(String(row.sellerSku ?? ''));
      const bucket = ensure(key);
      bucket.bankPayout += this.numberOf(row.bankSettlementValue);
      bucket.commission += Math.abs(this.numberOf(row.commission));
    }

    const meeshoSellerIds = ctx.sellerAliases
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const meeshoMatch: Record<string, unknown> = {
      sellerId: {
        $in:
          meeshoSellerIds.length > 0
            ? [...meeshoSellerIds, ...ctx.sellerAliases]
            : ctx.sellerAliases,
      },
      ...(ctx.gstin ? { gstin: ctx.gstin } : {}),
    };
    if (query.fromDate || query.toDate) {
      const range: Record<string, Date> = {};
      if (query.fromDate) {
        const start = new Date(query.fromDate);
        if (!Number.isNaN(start.getTime())) range.$gte = start;
      }
      if (query.toDate) {
        const end = new Date(query.toDate);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          range.$lte = end;
        }
      }
      if (Object.keys(range).length) meeshoMatch.paymentDate = range;
    }

    const meeshoRows = includeMeesho
      ? await this.meeshoOrderPaymentsModel
          .find(meeshoMatch)
          .select({
            supplierSku: 1,
            finalSettlementAmount: 1,
            meeshoCommissionInclGst: 1,
          })
          .lean()
          .exec()
      : [];
    for (const row of meeshoRows) {
      const key = resolveKey(String(row.supplierSku ?? ''));
      const bucket = ensure(key);
      bucket.bankPayout += this.numberOf(row.finalSettlementAmount);
      bucket.commission += Math.abs(this.numberOf(row.meeshoCommissionInclGst));
    }

    const finalized = new Map<string, SkuFinanceMetrics>();
    for (const [key, metrics] of finance) {
      finalized.set(key, this.finalizeFinance(metrics));
    }
    return finalized;
  }

  private gstRateForRow(row: Partial<ImportRow>): number {
    const igst = Number(row.igstRate ?? 0);
    const cgst = Number(row.cgstRate ?? 0);
    const sgst = Number(row.sgstRate ?? 0);
    const total = igst > 0 ? igst : cgst + sgst;
    return Number.isFinite(total) ? total : 0;
  }

  private buildMasterSkuMap(
    mappings: Array<{
      marketplaceSku?: string | null;
      masterSku?: string | null;
    }>,
  ): Map<string, string> {
    const out = new Map<string, string>();
    for (const item of mappings) {
      const marketplaceSku = String(item.marketplaceSku ?? '').trim();
      if (!marketplaceSku) continue;
      const masterSku = String(item.masterSku ?? '').trim();
      if (masterSku) {
        out.set(marketplaceSku, masterSku);
      }
    }
    return out;
  }

  private async aggregateForMarketplace(
    ctx: ReportContext,
    target: MarketplaceTarget,
    query: StateWiseExportDto,
  ): Promise<StateGroup[]> {
    const skuGrouping = this.resolveSkuGrouping(query);
    const salesFilter = await this.buildSalesFilter(ctx, query);
    const match = {
      ...salesFilter,
      marketplace: { $in: target.matchKeys },
    };
    const rows = await this.rowModel
      .find(match)
      .select({
        stateName: 1,
        skuID: 1,
        igstRate: 1,
        cgstRate: 1,
        sgstRate: 1,
        igstAmount: 1,
        cgstAmount: 1,
        sgstAmount: 1,
        taxableAmount: 1,
        invoiceAmount: 1,
        quantity: 1,
      })
      .lean()
      .exec();

    if (!rows.length) return [];

    const skuSet = new Set<string>();
    for (const row of rows) {
      const sku = String(row.skuID ?? '').trim();
      if (sku) skuSet.add(sku);
    }
    const skuList = Array.from(skuSet);

    const mappings = skuList.length
      ? await this.skuMasterMappingModel
          .find({
            sellerId: { $in: ctx.sellerAliases },
            ...(ctx.gstin ? { gstin: ctx.gstin } : {}),
            marketplace: { $in: target.matchKeys },
            marketplaceSku: { $in: skuList },
          })
          .select({ marketplaceSku: 1, masterSku: 1 })
          .lean()
          .exec()
      : [];

    const masterByMarketplaceSku = this.buildMasterSkuMap(mappings);
    const stateSkuMap = new Map<string, SkuDetailRow>();

    for (const row of rows) {
      const stateName = this.normalizeState(row.stateName);
      const marketplaceSku = String(row.skuID ?? '').trim() || 'N/A';
      const masterSku =
        masterByMarketplaceSku.get(marketplaceSku) ?? 'UNMAPPED';
      const skuLabel =
        skuGrouping === 'marketplace_sku' ? marketplaceSku : masterSku;
      const gstRate = this.gstRateForRow(row);
      const key = `${stateName}__${skuLabel}__${gstRate}`;
      const existing = stateSkuMap.get(key) ?? {
        label: skuLabel,
        gstRate,
        qty: 0,
        taxableValue: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        invoiceAmount: 0,
      };

      existing.qty += this.numberOf(row.quantity);
      existing.taxableValue += this.numberOf(row.taxableAmount);
      existing.igst += this.numberOf(row.igstAmount);
      existing.cgst += this.numberOf(row.cgstAmount);
      existing.sgst += this.numberOf(row.sgstAmount);
      existing.invoiceAmount += this.numberOf(row.invoiceAmount);
      stateSkuMap.set(key, existing);
    }

    const stateGroups = new Map<string, StateGroup>();
    for (const [key, skuRow] of stateSkuMap.entries()) {
      const stateName = key.split('__')[0] ?? 'Unknown';
      const group = stateGroups.get(stateName) ?? {
        stateName,
        skus: [],
        qty: 0,
        taxableValue: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        invoiceAmount: 0,
      };
      group.skus.push(skuRow);
      group.qty += skuRow.qty;
      group.taxableValue += skuRow.taxableValue;
      group.igst += skuRow.igst;
      group.cgst += skuRow.cgst;
      group.sgst += skuRow.sgst;
      group.invoiceAmount += skuRow.invoiceAmount;
      stateGroups.set(stateName, group);
    }

    return Array.from(stateGroups.values())
      .map((group) => ({
        ...group,
        skus: group.skus.sort((a, b) => {
          if (a.label !== b.label) return a.label.localeCompare(b.label);
          return a.gstRate - b.gstRate;
        }),
      }))
      .sort((a, b) => a.stateName.localeCompare(b.stateName));
  }

  private aggregateMasterSkuTotals(groups: StateGroup[]): SkuDetailRow[] {
    const totals = new Map<string, SkuDetailRow>();
    for (const group of groups) {
      for (const sku of group.skus) {
        const key = `${sku.label}__${sku.gstRate}`;
        const existing = totals.get(key) ?? {
          label: sku.label,
          gstRate: sku.gstRate,
          qty: 0,
          taxableValue: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          invoiceAmount: 0,
        };
        existing.qty += sku.qty;
        existing.taxableValue += sku.taxableValue;
        existing.igst += sku.igst;
        existing.cgst += sku.cgst;
        existing.sgst += sku.sgst;
        existing.invoiceAmount += sku.invoiceAmount;
        totals.set(key, existing);
      }
    }
    return Array.from(totals.values()).sort((a, b) => {
      if (a.label !== b.label) return a.label.localeCompare(b.label);
      return a.gstRate - b.gstRate;
    });
  }

  private async buildReportData(query: StateWiseExportDto) {
    const ctx = await this.resolveContext(query);
    const targets = await this.resolveMarketplaceTargets(query, ctx);
    const skuGrouping = this.resolveSkuGrouping(query);

    const marketplaces: Array<{
      id: string;
      name: string;
      rowCount: number;
      stateGroups: StateGroup[];
      masterTotals: SkuDetailRow[];
    }> = [];

    for (const target of targets) {
      const stateGroups = await this.aggregateForMarketplace(
        ctx,
        target,
        query,
      );
      const skuCount = stateGroups.reduce((sum, g) => sum + g.skus.length, 0);
      marketplaces.push({
        id: target.id,
        name: target.name,
        rowCount: skuCount,
        stateGroups,
        masterTotals: this.aggregateMasterSkuTotals(stateGroups),
      });
    }

    const totalRows = marketplaces.reduce((sum, mp) => sum + mp.rowCount, 0);
    return { ctx, marketplaces, totalRows, skuGrouping };
  }

  private assertHasData(totalRows: number, ctx: ReportContext) {
    if (totalRows > 0) return;
    this.logger.warn(
      `State+SKU report empty for seller=${ctx.sellerId} gstin=${ctx.gstin}`,
    );
    throw new BadRequestException(NO_DATA_MESSAGE);
  }

  async getPreview(query: StateWiseExportDto) {
    const { marketplaces, totalRows, skuGrouping } =
      await this.buildReportData(query);
    return {
      success: true,
      data: {
        sheetCount: marketplaces.length,
        totalRows,
        skuGrouping,
        reportMonth: query.reportMonth,
        marketplaces: marketplaces.map((mp) => ({
          id: mp.id,
          name: mp.name,
          rowCount: mp.rowCount,
          stateCount: mp.stateGroups.length,
        })),
        message: totalRows === 0 ? NO_DATA_MESSAGE : undefined,
      },
    };
  }

  /**
   * Seller analytics: roll up imported sales against master SKUs,
   * including marketplace SKU mappings from SKU Master.
   */
  async getSkuWiseAnalytics(query: StateWiseExportDto) {
    const skuGrouping = this.resolveSkuGrouping(query);
    const { ctx, marketplaces, totalRows } = await this.buildReportData(query);

    const metricByKey = new Map<
      string,
      {
        key: string;
        qty: number;
        taxableValue: number;
        igst: number;
        cgst: number;
        sgst: number;
        invoiceAmount: number;
        gstRates: Set<number>;
      }
    >();

    for (const mp of marketplaces) {
      for (const row of mp.masterTotals) {
        const key = row.label || 'UNMAPPED';
        const existing = metricByKey.get(key) ?? {
          key,
          qty: 0,
          taxableValue: 0,
          igst: 0,
          cgst: 0,
          sgst: 0,
          invoiceAmount: 0,
          gstRates: new Set<number>(),
        };
        existing.qty += row.qty;
        existing.taxableValue += row.taxableValue;
        existing.igst += row.igst;
        existing.cgst += row.cgst;
        existing.sgst += row.sgst;
        existing.invoiceAmount += row.invoiceAmount;
        existing.gstRates.add(row.gstRate);
        metricByKey.set(key, existing);
      }
    }

    const mappings = await this.skuMasterMappingModel
      .find({
        sellerId: { $in: ctx.sellerAliases },
        ...(ctx.gstin ? { gstin: ctx.gstin } : {}),
      })
      .select({
        marketplace: 1,
        marketplaceSku: 1,
        masterSku: 1,
        rate: 1,
        productName: 1,
        category: 1,
        brand: 1,
        status: 1,
      })
      .lean()
      .exec();

    const masterByMarketplaceSku = this.buildMasterSkuMap(mappings);
    const financeByKey = await this.loadSkuFinanceMetrics(
      ctx,
      query,
      skuGrouping,
      masterByMarketplaceSku,
    );

    type AnalyticsRow = {
      rowKey: string;
      masterSku: string;
      marketplaceSku: string | null;
      status: 'MAPPED' | 'UNMAPPED';
      productName: string | null;
      category: string | null;
      brand: string | null;
      rates: number[];
      marketplaceSkuCount: number;
      marketplaceSkus: SkuMasterGroup['marketplaceSkus'];
      qty: number;
      taxableValue: number;
      igst: number;
      cgst: number;
      sgst: number;
      invoiceAmount: number;
      netPcs: number;
      netSales: number;
      bankPayout: number;
      commission: number;
      cost: number;
      profit: number;
      returnPercent: number;
    };

    const attachFinance = (
      row: Omit<
        AnalyticsRow,
        | 'netPcs'
        | 'netSales'
        | 'bankPayout'
        | 'commission'
        | 'cost'
        | 'profit'
        | 'returnPercent'
      >,
      financeKey: string,
    ): AnalyticsRow => {
      const finance = financeByKey.get(financeKey) ?? this.emptyFinance();
      return {
        ...row,
        netPcs: finance.netPcs,
        netSales: finance.netSales,
        bankPayout: finance.bankPayout,
        commission: finance.commission,
        cost: finance.cost,
        profit: finance.profit,
        returnPercent: finance.returnPercent,
      };
    };

    let rows: AnalyticsRow[] = [];

    if (skuGrouping === 'marketplace_sku') {
      const bySku = new Map<string, AnalyticsRow>();
      for (const item of mappings) {
        const marketplaceSku =
          String(item.marketplaceSku ?? '').trim() || 'N/A';
        const masterSku = String(item.masterSku ?? '').trim() || 'UNMAPPED';
        const rowKey = `${String(item.marketplace ?? '')}::${marketplaceSku}`;
        const metrics = metricByKey.get(marketplaceSku);
        const existing = bySku.get(rowKey);
        const mapping = {
          marketplace: String(item.marketplace ?? ''),
          marketplaceSku,
          rate: typeof item.rate === 'number' ? item.rate : null,
          productName: item.productName,
        };
        if (existing) {
          existing.marketplaceSkus.push(mapping);
          existing.marketplaceSkuCount = existing.marketplaceSkus.length;
          continue;
        }
        bySku.set(
          rowKey,
          attachFinance(
            {
              rowKey,
              masterSku,
              marketplaceSku,
              status: masterSku === 'UNMAPPED' ? 'UNMAPPED' : 'MAPPED',
              productName: item.productName ?? null,
              category: item.category ?? null,
              brand: item.brand ?? null,
              rates:
                typeof item.rate === 'number'
                  ? [item.rate]
                  : Array.from(metrics?.gstRates ?? []).sort((a, b) => a - b),
              marketplaceSkuCount: 1,
              marketplaceSkus: [mapping],
              qty: this.roundMoney(metrics?.qty ?? 0),
              taxableValue: this.roundMoney(metrics?.taxableValue ?? 0),
              igst: this.roundMoney(metrics?.igst ?? 0),
              cgst: this.roundMoney(metrics?.cgst ?? 0),
              sgst: this.roundMoney(metrics?.sgst ?? 0),
              invoiceAmount: this.roundMoney(metrics?.invoiceAmount ?? 0),
            },
            marketplaceSku,
          ),
        );
      }
      for (const [sku] of metricByKey) {
        const hasRow = Array.from(bySku.values()).some(
          (row) => row.marketplaceSku === sku,
        );
        if (hasRow) continue;
        const masterSku = masterByMarketplaceSku.get(sku) ?? 'UNMAPPED';
        const rowKey = `::${sku}`;
        const metrics = metricByKey.get(sku);
        bySku.set(
          rowKey,
          attachFinance(
            {
              rowKey,
              masterSku,
              marketplaceSku: sku,
              status: masterSku === 'UNMAPPED' ? 'UNMAPPED' : 'MAPPED',
              productName: null,
              category: null,
              brand: null,
              rates: Array.from(metrics?.gstRates ?? []).sort((a, b) => a - b),
              marketplaceSkuCount: 1,
              marketplaceSkus: [
                {
                  marketplace: '',
                  marketplaceSku: sku,
                  rate: null,
                },
              ],
              qty: this.roundMoney(metrics?.qty ?? 0),
              taxableValue: this.roundMoney(metrics?.taxableValue ?? 0),
              igst: this.roundMoney(metrics?.igst ?? 0),
              cgst: this.roundMoney(metrics?.cgst ?? 0),
              sgst: this.roundMoney(metrics?.sgst ?? 0),
              invoiceAmount: this.roundMoney(metrics?.invoiceAmount ?? 0),
            },
            sku,
          ),
        );
      }
      rows = Array.from(bySku.values());
    } else {
      const byMaster = new Map<string, SkuMasterGroup>();
      for (const item of mappings) {
        const masterSku = String(item.masterSku ?? '').trim() || 'UNMAPPED';
        const group: SkuMasterGroup = byMaster.get(masterSku) ?? {
          masterSku,
          status: masterSku === 'UNMAPPED' ? 'UNMAPPED' : 'MAPPED',
          productName: item.productName ?? undefined,
          category: item.category ?? undefined,
          brand: item.brand ?? undefined,
          rates: new Set<number>(),
          marketplaceSkus: [],
        };
        if (!group.productName && item.productName) {
          group.productName = item.productName;
        }
        if (!group.category && item.category) {
          group.category = item.category ?? undefined;
        }
        if (!group.brand && item.brand) group.brand = item.brand ?? undefined;
        if (typeof item.rate === 'number') group.rates.add(item.rate);
        group.marketplaceSkus.push({
          marketplace: String(item.marketplace ?? ''),
          marketplaceSku: String(item.marketplaceSku ?? ''),
          rate: typeof item.rate === 'number' ? item.rate : null,
          productName: item.productName,
        });
        byMaster.set(masterSku, group);
      }

      for (const [key] of metricByKey) {
        if (!byMaster.has(key)) {
          byMaster.set(key, {
            masterSku: key,
            status: key === 'UNMAPPED' ? 'UNMAPPED' : 'MAPPED',
            rates: new Set<number>(),
            marketplaceSkus: [],
          });
        }
      }

      rows = Array.from(byMaster.values()).map((group) => {
        const metrics = metricByKey.get(group.masterSku);
        return attachFinance(
          {
            rowKey: group.masterSku,
            masterSku: group.masterSku,
            marketplaceSku: null,
            status: group.status,
            productName: group.productName ?? null,
            category: group.category ?? null,
            brand: group.brand ?? null,
            rates: Array.from(
              new Set([
                ...Array.from(group.rates),
                ...(metrics ? Array.from(metrics.gstRates) : []),
              ]),
            ).sort((a, b) => a - b),
            marketplaceSkuCount: group.marketplaceSkus.length,
            marketplaceSkus: group.marketplaceSkus.sort((a, b) =>
              a.marketplaceSku.localeCompare(b.marketplaceSku),
            ),
            qty: this.roundMoney(metrics?.qty ?? 0),
            taxableValue: this.roundMoney(metrics?.taxableValue ?? 0),
            igst: this.roundMoney(metrics?.igst ?? 0),
            cgst: this.roundMoney(metrics?.cgst ?? 0),
            sgst: this.roundMoney(metrics?.sgst ?? 0),
            invoiceAmount: this.roundMoney(metrics?.invoiceAmount ?? 0),
          },
          group.masterSku,
        );
      });
    }

    rows.sort((a, b) => {
      if (a.masterSku === 'UNMAPPED') return 1;
      if (b.masterSku === 'UNMAPPED') return -1;
      return (
        b.netSales - a.netSales ||
        b.invoiceAmount - a.invoiceAmount ||
        a.masterSku.localeCompare(b.masterSku)
      );
    });

    const summary = {
      masterSkuCount: new Set(
        rows.filter((r) => r.masterSku !== 'UNMAPPED').map((r) => r.masterSku),
      ).size,
      unmappedCount: rows.filter((r) => r.masterSku === 'UNMAPPED').length,
      marketplaceSkuCount: rows.reduce(
        (sum, r) => sum + r.marketplaceSkuCount,
        0,
      ),
      qty: this.roundMoney(rows.reduce((sum, r) => sum + r.qty, 0)),
      taxableValue: this.roundMoney(
        rows.reduce((sum, r) => sum + r.taxableValue, 0),
      ),
      invoiceAmount: this.roundMoney(
        rows.reduce((sum, r) => sum + r.invoiceAmount, 0),
      ),
      netSales: this.roundMoney(rows.reduce((sum, r) => sum + r.netSales, 0)),
      netPcs: this.roundMoney(rows.reduce((sum, r) => sum + r.netPcs, 0)),
      totalRows,
    };

    return {
      success: true,
      data: {
        gstin: ctx.gstin || 'ALL',
        skuGrouping,
        summary,
        rows,
      },
    };
  }

  private styleSheetHeader(sheet: ExcelJS.Worksheet) {
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF003F5C' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  private addDetailRow(sheet: ExcelJS.Worksheet, row: SkuDetailRow) {
    const detailRow = sheet.addRow([
      row.label,
      this.formatGstRate(row.gstRate),
      row.qty,
      row.taxableValue,
      row.igst,
      row.cgst,
      row.sgst,
      row.invoiceAmount,
    ]);
    // Keep SKU labels right-aligned for easier visual scanning.
    detailRow.getCell(1).alignment = {
      horizontal: 'right',
      vertical: 'middle',
    };
  }

  private addStateHeaderRow(sheet: ExcelJS.Worksheet, group: StateGroup) {
    const stateRow = sheet.addRow([
      group.stateName.toUpperCase(),
      '',
      group.qty,
      group.taxableValue,
      group.igst,
      group.cgst,
      group.sgst,
      group.invoiceAmount,
    ]);
    stateRow.font = { bold: true };
  }

  private formatSheetNumbers(sheet: ExcelJS.Worksheet) {
    const currencyCols = [4, 5, 6, 7, 8];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      sheet.getRow(r).getCell(3).numFmt = '#,##0';
      for (const c of currencyCols) {
        const cell = sheet.getRow(r).getCell(c);
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0.00';
        }
      }
    }
  }

  private writeSheet(
    sheet: ExcelJS.Worksheet,
    stateGroups: StateGroup[],
    masterTotals: SkuDetailRow[],
    skuGrouping: 'master_sku' | 'marketplace_sku',
  ) {
    sheet.addRow([...HEADERS]);
    this.styleSheetHeader(sheet);

    for (const group of stateGroups) {
      this.addStateHeaderRow(sheet, group);
      for (const sku of group.skus) {
        this.addDetailRow(sheet, sku);
      }
    }

    if (masterTotals.length) {
      sheet.addRow([]);
      const sectionTitle = sheet.addRow([
        skuGrouping === 'marketplace_sku'
          ? 'MARKETPLACE SKU SUMMARY (ALL STATES)'
          : 'MASTER SKU SUMMARY (ALL STATES)',
      ]);
      sectionTitle.font = { bold: true };
      const summaryHeaders = [
        skuGrouping === 'marketplace_sku' ? 'MARKETPLACE SKU' : 'MASTER SKU',
        ...HEADERS.slice(1),
      ];
      const summaryHeader = sheet.addRow(summaryHeaders);
      summaryHeader.font = { bold: true };

      const grand = {
        qty: 0,
        taxableValue: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        invoiceAmount: 0,
      };
      for (const row of masterTotals) {
        this.addDetailRow(sheet, row);
        grand.qty += row.qty;
        grand.taxableValue += row.taxableValue;
        grand.igst += row.igst;
        grand.cgst += row.cgst;
        grand.sgst += row.sgst;
        grand.invoiceAmount += row.invoiceAmount;
      }
      const totalRow = sheet.addRow([
        'TOTAL',
        '',
        grand.qty,
        grand.taxableValue,
        grand.igst,
        grand.cgst,
        grand.sgst,
        grand.invoiceAmount,
      ]);
      totalRow.font = { bold: true };
    }

    sheet.columns = [
      { width: 32 },
      { width: 12 },
      { width: 10 },
      { width: 16 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 18 },
    ];
    this.formatSheetNumbers(sheet);
  }

  async generateWorkbook(query: StateWiseExportDto): Promise<{
    buffer: Buffer;
    sheetCount: number;
    totalRows: number;
    filename: string;
  }> {
    const { ctx, marketplaces, totalRows, skuGrouping } =
      await this.buildReportData(query);

    if (!marketplaces.length) {
      throw new BadRequestException(
        'No marketplaces found for this seller. Connect a marketplace first.',
      );
    }
    this.assertHasData(totalRows, ctx);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EcommReco';
    workbook.created = new Date();

    const usedSheetNames = new Set<string>();
    for (const mp of marketplaces) {
      let sheetName = this.sanitizeSheetName(mp.name);
      let suffix = 1;
      while (usedSheetNames.has(sheetName)) {
        sheetName = this.sanitizeSheetName(`${mp.name} ${suffix}`);
        suffix += 1;
      }
      usedSheetNames.add(sheetName);
      const sheet = workbook.addWorksheet(sheetName);
      this.writeSheet(sheet, mp.stateGroups, mp.masterTotals, skuGrouping);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const gstSlug = ctx.gstin.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15);
    const monthSlug = query.reportMonth
      ? `-${String(query.reportMonth).replace(/[^0-9-]/g, '')}`
      : '';
    const filename = `state-sku-wise-gst-${gstSlug}${monthSlug}-${Date.now()}.xlsx`;

    return {
      buffer,
      sheetCount: marketplaces.length,
      totalRows,
      filename,
    };
  }

  private escapeCsvValue(value: unknown): string {
    const str = String(value ?? '');
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  async generateCsv(query: StateWiseExportDto): Promise<{
    buffer: Buffer;
    totalRows: number;
    filename: string;
  }> {
    const { ctx, marketplaces, totalRows } = await this.buildReportData(query);

    if (!marketplaces.length) {
      throw new BadRequestException(
        'No marketplaces found for this seller. Connect a marketplace first.',
      );
    }
    this.assertHasData(totalRows, ctx);

    const headers = ['Marketplace', ...HEADERS];
    const lines = [headers.join(',')];

    for (const mp of marketplaces) {
      for (const group of mp.stateGroups) {
        lines.push(
          [
            mp.name,
            group.stateName.toUpperCase(),
            '',
            group.qty,
            group.taxableValue,
            group.igst,
            group.cgst,
            group.sgst,
            group.invoiceAmount,
          ]
            .map((value) => this.escapeCsvValue(value))
            .join(','),
        );
        for (const sku of group.skus) {
          lines.push(
            [
              mp.name,
              sku.label,
              this.formatGstRate(sku.gstRate),
              sku.qty,
              sku.taxableValue,
              sku.igst,
              sku.cgst,
              sku.sgst,
              sku.invoiceAmount,
            ]
              .map((value) => this.escapeCsvValue(value))
              .join(','),
          );
        }
      }
    }

    const gstSlug = ctx.gstin.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15);
    const monthSlug = query.reportMonth
      ? `-${String(query.reportMonth).replace(/[^0-9-]/g, '')}`
      : '';
    const filename = `state-sku-wise-gst-${gstSlug}${monthSlug}-${Date.now()}.csv`;

    return {
      buffer: Buffer.from(lines.join('\n'), 'utf-8'),
      totalRows,
      filename,
    };
  }
}
