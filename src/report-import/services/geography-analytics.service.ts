import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import ExcelJS from 'exceljs';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import {
  Marketplace,
  MarketplaceDocument,
} from '../../marketplaces/schemas/marketplace.schema';
import { Gst, GstDocument } from '../../gsts/schemas/gst.schema';
import {
  SkuMasterMapping,
  SkuMasterMappingDocument,
} from '../../sku-master/schemas/sku-master-mapping.schema';
import { ValidationService } from './validation.service';
import { buildCustomerIndianStateCodeExpr } from '../../common/gst/gst-state.util';
import {
  GeographyAnalyticsDto,
  type GeographyMetric,
} from '../dto/geography-analytics.dto';
import {
  INDIA_STATE_CATALOG,
  UNMAPPED_STATE_CODE,
  catalogIsoForCode,
  catalogNameForCode,
} from '../utils/india-state-catalog';

type StateMetrics = {
  stateCode: string;
  stateName: string;
  isoCode: string;
  sales: number;
  orders: number;
  unitsSold: number;
  returnValue: number;
  returnUnits: number;
  netSales: number;
  profit: number;
  aov: number;
  returnRate: number;
  contribution: number;
  previousSales: number;
  trendPercent: number | null;
};

type CacheEntry<T> = { expiresAt: number; value: T };

const CACHE_TTL_MS = 90_000;
const RETURN_DOC_REGEX = 'RETURN|RTO';

const DEFINITIONS = {
  dateBasis: 'Order / sales invoice date (invoiceDate on imported sales rows).',
  sales: 'Sum of invoice amount on eligible sales rows.',
  netSales: 'Gross sales minus return invoice amounts, matching EcommReco sales-vs-return rules.',
  profit: 'Net sales after returns. Marketplace fees are not allocated to states.',
  orders: 'Count of distinct sales order IDs.',
  units: 'Sum of sales quantities.',
  returnRate: 'Returned units / sold units.',
  aov: 'Gross sales / distinct sales orders.',
};

type GeoOverviewResult = {
  success: true;
  data: {
    dateBasis: string;
    definitions: typeof DEFINITIONS;
    filters: {
      fromDate: string;
      toDate: string;
      previousFrom: string;
      previousTo: string;
      marketplace: string;
      metric: GeographyMetric;
    };
    summary: {
      sales: number;
      orders: number;
      unitsSold: number;
      netSales: number;
      profit: number;
      aov: number;
      returnValue: number;
      returnRate: number;
      coveragePercent: number;
      unmappedPercent: number;
    };
    states: StateMetrics[];
    topStates: StateMetrics[];
  };
};

@Injectable()
export class GeographyAnalyticsService {
  private readonly logger = new Logger(GeographyAnalyticsService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(Gst.name)
    private readonly gstModel: Model<GstDocument>,
    @InjectModel(SkuMasterMapping.name)
    private readonly skuMasterMappingModel: Model<SkuMasterMappingDocument>,
    private readonly validationService: ValidationService,
  ) {}

  async getOverview(
    query: GeographyAnalyticsDto,
    actor?: { id?: string; role?: string },
  ) {
    const ctx = await this.resolveContext(query, actor);
    const cacheKey = `overview:${JSON.stringify({
      seller: [...ctx.sellerAliases].sort(),
      gstin: ctx.gstin,
      marketplace: query.marketplace ?? '',
      fromDate: ctx.fromDate,
      toDate: ctx.toDate,
      metric: query.metric ?? 'sales',
    })}`;
    const cached = this.readCache<GeoOverviewResult>(cacheKey);
    if (cached) return cached;

    const match = await this.buildMatch(ctx, query);
    const current = await this.aggregateStates(match);
    const previousMatch = await this.buildMatch(ctx, query, ctx.previousFrom, ctx.previousTo);
    const previous = await this.aggregateStates(previousMatch);
    const prevByCode = new Map(previous.map((row) => [row.stateCode, row]));

    const mappedSales = current
      .filter((row) => row.stateCode !== UNMAPPED_STATE_CODE)
      .reduce((sum, row) => sum + row.sales, 0);
    const totalSales = current.reduce((sum, row) => sum + row.sales, 0);
    const totalOrders = current.reduce((sum, row) => sum + row.orders, 0);
    const totalUnits = current.reduce((sum, row) => sum + row.unitsSold, 0);
    const totalReturnValue = current.reduce((sum, row) => sum + row.returnValue, 0);
    const totalReturnUnits = current.reduce((sum, row) => sum + row.returnUnits, 0);
    const totalNet = current.reduce((sum, row) => sum + row.netSales, 0);

    const byCode = new Map(current.map((row) => [row.stateCode, row]));
    const states: StateMetrics[] = INDIA_STATE_CATALOG.map((entry) => {
      const row = byCode.get(entry.gstCode);
      return this.toStateMetrics(
        entry.gstCode,
        row,
        prevByCode.get(entry.gstCode),
        totalSales,
      );
    });
    const unmapped = byCode.get(UNMAPPED_STATE_CODE);
    if (unmapped && (unmapped.sales > 0 || unmapped.returnValue > 0 || unmapped.orders > 0)) {
      states.push(
        this.toStateMetrics(
          UNMAPPED_STATE_CODE,
          unmapped,
          prevByCode.get(UNMAPPED_STATE_CODE),
          totalSales,
        ),
      );
    }

    const metric = (query.metric ?? 'sales') as GeographyMetric;
    const ranked = [...states]
      .filter((row) => row.stateCode !== UNMAPPED_STATE_CODE)
      .sort((a, b) => this.metricValue(b, metric) - this.metricValue(a, metric));

    const payload: GeoOverviewResult = {
      success: true,
      data: {
        dateBasis: DEFINITIONS.dateBasis,
        definitions: DEFINITIONS,
        filters: {
          fromDate: ctx.fromDate,
          toDate: ctx.toDate,
          previousFrom: ctx.previousFrom,
          previousTo: ctx.previousTo,
          marketplace: query.marketplace ?? '',
          metric,
        },
        summary: {
          sales: this.round(totalSales),
          orders: totalOrders,
          unitsSold: this.round(totalUnits),
          netSales: this.round(totalNet),
          profit: this.round(totalNet),
          aov: totalOrders > 0 ? this.round(totalSales / totalOrders) : 0,
          returnValue: this.round(totalReturnValue),
          returnRate:
            totalUnits > 0 ? this.round((totalReturnUnits / totalUnits) * 100) : 0,
          coveragePercent:
            totalSales > 0 ? this.round((mappedSales / totalSales) * 100) : 100,
          unmappedPercent:
            totalSales > 0
              ? this.round(((totalSales - mappedSales) / totalSales) * 100)
              : 0,
        },
        states,
        topStates: ranked.slice(0, 8),
      },
    };
    this.writeCache(cacheKey, payload);
    return payload;
  }

  async getStateDetail(
    stateCodeParam: string,
    query: GeographyAnalyticsDto,
    actor?: { id?: string; role?: string },
  ) {
    const ctx = await this.resolveContext(query, actor);
    const stateCode = this.normalizeRequestedState(stateCodeParam);
    if (!stateCode) {
      throw new BadRequestException('A valid Indian state code is required');
    }
    const match = await this.buildMatch(ctx, query);
    match.stateCode = stateCode;

    const [states, trend, marketplaceMix, products] = await Promise.all([
      this.aggregateStates(await this.buildMatch(ctx, query)),
      this.aggregateTrend(match),
      this.aggregateMarketplace(match, ctx),
      this.aggregateProducts(match, ctx),
    ]);
    const state =
      states.find((row) => row.stateCode === stateCode) ??
      this.emptyRaw(stateCode);
    const totalSales = states.reduce((sum, row) => sum + row.sales, 0);
    const summary = this.toStateMetrics(stateCode, state, undefined, totalSales);
    return {
      success: true,
      data: {
        dateBasis: DEFINITIONS.dateBasis,
        definitions: DEFINITIONS,
        state: summary,
        salesTrend: trend,
        marketplaceBreakdown: marketplaceMix,
        topProducts: products.products,
        topCategories: products.categories,
      },
    };
  }

  async exportCsv(
    query: GeographyAnalyticsDto,
    actor?: { id?: string; role?: string },
  ) {
    const overview = await this.getOverview(query, actor);
    const rows = overview.data.states.filter(
      (row) => row.stateCode !== UNMAPPED_STATE_CODE || row.sales > 0,
    );
    const header = [
      'Rank',
      'State',
      'State Code',
      'ISO',
      'Sales',
      'Orders',
      'Units',
      'Net Sales',
      'Profit',
      'Return Value',
      'Return Rate %',
      'AOV',
      'Contribution %',
      'Trend %',
    ];
    const ranked = [...rows].sort((a, b) => b.sales - a.sales);
    const lines = ranked.map((row, index) =>
      [
        index + 1,
        row.stateName,
        row.stateCode,
        row.isoCode,
        row.sales,
        row.orders,
        row.unitsSold,
        row.netSales,
        row.profit,
        row.returnValue,
        row.returnRate,
        row.aov,
        row.contribution,
        row.trendPercent ?? '',
      ]
        .map((value) => this.csv(value))
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const filename = `india-sales-map-${ctxStamp(query)}.csv`;
    return {
      buffer: Buffer.from(csv, 'utf8'),
      filename,
      rowCount: ranked.length,
    };
  }

  async exportXlsx(
    query: GeographyAnalyticsDto,
    actor?: { id?: string; role?: string },
  ) {
    const overview = await this.getOverview(query, actor);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('State sales');
    sheet.addRow([
      'Rank',
      'State',
      'State Code',
      'ISO',
      'Sales',
      'Orders',
      'Units',
      'Net Sales',
      'Profit',
      'Return Value',
      'Return Rate %',
      'AOV',
      'Contribution %',
      'Trend %',
    ]);
    const ranked = [...overview.data.states]
      .filter((row) => row.stateCode !== UNMAPPED_STATE_CODE || row.sales > 0)
      .sort((a, b) => b.sales - a.sales);
    ranked.forEach((row, index) => {
      sheet.addRow([
        index + 1,
        row.stateName,
        row.stateCode,
        row.isoCode,
        row.sales,
        row.orders,
        row.unitsSold,
        row.netSales,
        row.profit,
        row.returnValue,
        row.returnRate,
        row.aov,
        row.contribution,
        row.trendPercent,
      ]);
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      filename: `india-sales-map-${ctxStamp(query)}.xlsx`,
      rowCount: ranked.length,
    };
  }

  private metricValue(row: StateMetrics, metric: GeographyMetric): number {
    switch (metric) {
      case 'orders':
        return row.orders;
      case 'units':
        return row.unitsSold;
      case 'netSales':
        return row.netSales;
      case 'profit':
        return row.profit;
      case 'aov':
        return row.aov;
      case 'returnValue':
        return row.returnValue;
      case 'returnRate':
        return row.returnRate;
      default:
        return row.sales;
    }
  }

  private toStateMetrics(
    stateCode: string,
    current: ReturnType<GeographyAnalyticsService['emptyRaw']> | undefined,
    previous: ReturnType<GeographyAnalyticsService['emptyRaw']> | undefined,
    totalSales: number,
  ): StateMetrics {
    const row = current ?? this.emptyRaw(stateCode);
    const prevSales = previous?.sales ?? 0;
    const trendPercent =
      prevSales > 0 ? this.round(((row.sales - prevSales) / prevSales) * 100) : null;
    const aov = row.orders > 0 ? this.round(row.sales / row.orders) : 0;
    const returnRate =
      row.unitsSold > 0 ? this.round((row.returnUnits / row.unitsSold) * 100) : 0;
    return {
      stateCode,
      stateName: catalogNameForCode(stateCode),
      isoCode: catalogIsoForCode(stateCode),
      sales: this.round(row.sales),
      orders: row.orders,
      unitsSold: this.round(row.unitsSold),
      returnValue: this.round(row.returnValue),
      returnUnits: this.round(row.returnUnits),
      netSales: this.round(row.netSales),
      profit: this.round(row.netSales),
      aov,
      returnRate,
      contribution: totalSales > 0 ? this.round((row.sales / totalSales) * 100) : 0,
      previousSales: this.round(prevSales),
      trendPercent,
    };
  }

  private emptyRaw(stateCode: string) {
    return {
      stateCode,
      sales: 0,
      orders: 0,
      unitsSold: 0,
      returnValue: 0,
      returnUnits: 0,
      netSales: 0,
    };
  }

  private async aggregateStates(match: Record<string, unknown>) {
    const rows = await this.rowModel
      .aggregate<{
        _id: string;
        sales: number;
        orders: number;
        unitsSold: number;
        returnValue: number;
        returnUnits: number;
      }>([
        { $match: this.stripVirtual(match) },
        ...this.stateCodeStages(),
        ...(match.stateCode
          ? [{ $match: { stateCode: match.stateCode } }]
          : []),
        {
          $group: {
            _id: '$stateCode',
            sales: {
              $sum: {
                $cond: ['$isReturn', 0, { $ifNull: ['$invoiceAmount', 0] }],
              },
            },
            returnValue: {
              $sum: {
                $cond: [
                  '$isReturn',
                  {
                    $abs: {
                      $ifNull: [
                        '$meeshoReturnInvoiceAmount',
                        { $ifNull: ['$invoiceAmount', 0] },
                      ],
                    },
                  },
                  0,
                ],
              },
            },
            unitsSold: {
              $sum: {
                $cond: ['$isReturn', 0, { $ifNull: ['$quantity', 0] }],
              },
            },
            returnUnits: {
              $sum: {
                $cond: [
                  '$isReturn',
                  {
                    $abs: {
                      $ifNull: ['$returnQty', { $ifNull: ['$quantity', 0] }],
                    },
                  },
                  0,
                ],
              },
            },
            orderIds: {
              $addToSet: {
                $cond: [
                  {
                    $and: [
                      { $not: ['$isReturn'] },
                      { $ne: [{ $ifNull: ['$orderID', ''] }, ''] },
                    ],
                  },
                  '$orderID',
                  '$$REMOVE',
                ],
              },
            },
          },
        },
        {
          $project: {
            sales: 1,
            returnValue: 1,
            unitsSold: 1,
            returnUnits: 1,
            orders: { $size: '$orderIds' },
          },
        },
      ])
      .allowDiskUse(true)
      .exec();

    return rows.map((row) => ({
      stateCode: String(row._id || UNMAPPED_STATE_CODE),
      sales: Number(row.sales ?? 0),
      orders: Number(row.orders ?? 0),
      unitsSold: Number(row.unitsSold ?? 0),
      returnValue: Number(row.returnValue ?? 0),
      returnUnits: Number(row.returnUnits ?? 0),
      netSales: Number(row.sales ?? 0) - Number(row.returnValue ?? 0),
    }));
  }

  private async aggregateTrend(match: Record<string, unknown>) {
    const rows = await this.rowModel
      .aggregate<{ _id: string; sales: number }>([
        { $match: this.stripVirtual(match) },
        ...this.stateCodeStages(),
        ...(match.stateCode ? [{ $match: { stateCode: match.stateCode } }] : []),
        {
          $group: {
            _id: { $substr: [{ $ifNull: ['$invoiceDate', ''] }, 0, 7] },
            sales: {
              $sum: {
                $cond: ['$isReturn', 0, { $ifNull: ['$invoiceAmount', 0] }],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .allowDiskUse(true)
      .exec();
    return rows
      .filter((row) => row._id)
      .map((row) => ({
        month: row._id,
        sales: this.round(Number(row.sales ?? 0)),
      }));
  }

  private async aggregateMarketplace(
    match: Record<string, unknown>,
    ctx: Awaited<ReturnType<GeographyAnalyticsService['resolveContext']>>,
  ) {
    const rows = await this.rowModel
      .aggregate<{ _id: string; sales: number }>([
        { $match: this.stripVirtual(match) },
        ...this.stateCodeStages(),
        ...(match.stateCode ? [{ $match: { stateCode: match.stateCode } }] : []),
        {
          $group: {
            _id: '$marketplace',
            sales: {
              $sum: {
                $cond: ['$isReturn', 0, { $ifNull: ['$invoiceAmount', 0] }],
              },
            },
          },
        },
      ])
      .allowDiskUse(true)
      .exec();
    const names = await this.marketplaceNames(ctx.sellerAliases);
    return rows
      .map((row) => ({
        marketplaceId: String(row._id ?? ''),
        name: names.get(String(row._id ?? '')) ?? String(row._id ?? 'Marketplace'),
        sales: this.round(Number(row.sales ?? 0)),
      }))
      .sort((a, b) => b.sales - a.sales);
  }

  private async aggregateProducts(
    match: Record<string, unknown>,
    ctx: Awaited<ReturnType<GeographyAnalyticsService['resolveContext']>>,
  ) {
    const rows = await this.rowModel
      .aggregate<{
        _id: string;
        sales: number;
        units: number;
        orders: number;
        returnUnits: number;
      }>([
        { $match: this.stripVirtual(match) },
        ...this.stateCodeStages(),
        ...(match.stateCode ? [{ $match: { stateCode: match.stateCode } }] : []),
        {
          $group: {
            _id: { $ifNull: ['$skuID', 'Unknown'] },
            sales: {
              $sum: {
                $cond: ['$isReturn', 0, { $ifNull: ['$invoiceAmount', 0] }],
              },
            },
            units: {
              $sum: {
                $cond: ['$isReturn', 0, { $ifNull: ['$quantity', 0] }],
              },
            },
            returnUnits: {
              $sum: {
                $cond: [
                  '$isReturn',
                  {
                    $abs: {
                      $ifNull: ['$returnQty', { $ifNull: ['$quantity', 0] }],
                    },
                  },
                  0,
                ],
              },
            },
            orderIds: {
              $addToSet: {
                $cond: [
                  {
                    $and: [
                      { $not: ['$isReturn'] },
                      { $ne: [{ $ifNull: ['$orderID', ''] }, ''] },
                    ],
                  },
                  '$orderID',
                  '$$REMOVE',
                ],
              },
            },
          },
        },
        {
          $project: {
            sales: 1,
            units: 1,
            returnUnits: 1,
            orders: { $size: '$orderIds' },
          },
        },
        { $sort: { sales: -1 } },
        { $limit: 8 },
      ])
      .allowDiskUse(true)
      .exec();

    const skus = rows.map((row) => String(row._id)).filter(Boolean);
    const mappings = skus.length
      ? await this.skuMasterMappingModel
          .find({
            sellerId: { $in: ctx.sellerAliases },
            ...(ctx.gstin ? { gstin: ctx.gstin } : {}),
            marketplaceSku: { $in: skus },
          })
          .select({ marketplaceSku: 1, productName: 1, category: 1, masterSku: 1 })
          .lean()
          .exec()
      : [];
    const bySku = new Map(
      mappings.map((item) => [String(item.marketplaceSku), item]),
    );
    const products = rows.map((row) => {
      const sku = String(row._id);
      const mapping = bySku.get(sku);
      const units = Number(row.units ?? 0);
      const returnUnits = Number(row.returnUnits ?? 0);
      return {
        sku,
        product: mapping?.productName || mapping?.masterSku || sku,
        category: mapping?.category || 'Uncategorised',
        units: this.round(units),
        sales: this.round(Number(row.sales ?? 0)),
        orders: Number(row.orders ?? 0),
        returnRate: units > 0 ? this.round((returnUnits / units) * 100) : 0,
      };
    });
    const categoryMap = new Map<string, number>();
    for (const product of products) {
      categoryMap.set(
        product.category,
        (categoryMap.get(product.category) ?? 0) + product.sales,
      );
    }
    const categories = Array.from(categoryMap.entries())
      .map(([category, sales]) => ({ category, sales: this.round(sales) }))
      .sort((a, b) => b.sales - a.sales);
    return { products, categories };
  }

  private stateCodeStages() {
    const knownCodes = INDIA_STATE_CATALOG.map((item) => item.gstCode);
    return [
      {
        $addFields: {
          resolvedGstCode: buildCustomerIndianStateCodeExpr(
            '$customerStateCode',
            '$stateName',
          ),
          isReturn: {
            $or: [
              { $eq: ['$meeshoIsGrossSale', false] },
              { $eq: ['$myntraTransactionType', 'RETURN'] },
              {
                $regexMatch: {
                  input: { $toUpper: { $ifNull: ['$documentType', ''] } },
                  regex: RETURN_DOC_REGEX,
                },
              },
            ],
          },
        },
      },
      {
        $addFields: {
          stateCode: {
            $switch: {
              branches: [
                {
                  case: {
                    $or: [
                      { $eq: ['$resolvedGstCode', ''] },
                      { $eq: ['$resolvedGstCode', null] },
                    ],
                  },
                  then: UNMAPPED_STATE_CODE,
                },
                {
                  case: { $in: ['$resolvedGstCode', ['25', '26']] },
                  then: '26',
                },
                { case: { $eq: ['$resolvedGstCode', '37'] }, then: '28' },
                {
                  case: { $in: ['$resolvedGstCode', knownCodes] },
                  then: '$resolvedGstCode',
                },
              ],
              default: UNMAPPED_STATE_CODE,
            },
          },
        },
      },
    ];
  }

  private stripVirtual(match: Record<string, unknown>) {
    const next = { ...match };
    delete next.stateCode;
    return next;
  }

  private async buildMatch(
    ctx: Awaited<ReturnType<GeographyAnalyticsService['resolveContext']>>,
    query: GeographyAnalyticsDto,
    fromDate = ctx.fromDate,
    toDate = ctx.toDate,
  ) {
    const match: Record<string, unknown> = {
      sellerId: { $in: ctx.sellerAliases },
    };
    if (ctx.gstin) match.gstin = ctx.gstin;
    if (fromDate || toDate) {
      const invoiceDate: Record<string, string> = {};
      if (fromDate) invoiceDate.$gte = fromDate;
      if (toDate) invoiceDate.$lte = toDate;
      match.invoiceDate = invoiceDate;
    }
    if (ctx.marketplaceKeys.length) {
      match.marketplace = { $in: ctx.marketplaceKeys };
    }
    return match;
  }

  private async resolveContext(
    query: GeographyAnalyticsDto,
    actor?: { id?: string; role?: string },
  ) {
    const requestedSeller = String(query.sellerId ?? '').trim();
    if (!requestedSeller) {
      throw new BadRequestException('sellerId is required');
    }
    const actorId = String(actor?.id ?? '').trim();
    const sellerId =
      actor?.role === 'seller' && actorId ? actorId : requestedSeller;
    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const gstin = String(query.gstin ?? '').trim().toUpperCase();
    const range = this.defaultRange(query.fromDate, query.toDate);
    const previous = this.previousRange(range.fromDate, range.toDate);
    const marketplaceKeys = await this.resolveMarketplaceKeys(
      sellerAliases,
      query.marketplace,
      gstin,
    );
    return {
      sellerId,
      sellerAliases,
      gstin,
      ...range,
      ...previous,
      marketplaceKeys,
    };
  }

  private defaultRange(fromDate?: string, toDate?: string) {
    if (fromDate && toDate) {
      return { fromDate, toDate };
    }
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      fromDate: fromDate || this.iso(start),
      toDate: toDate || this.iso(end),
    };
  }

  private previousRange(fromDate: string, toDate: string) {
    const from = new Date(`${fromDate}T00:00:00`);
    const to = new Date(`${toDate}T00:00:00`);
    const days = Math.max(
      1,
      Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1,
    );
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - (days - 1));
    return {
      previousFrom: this.iso(prevFrom),
      previousTo: this.iso(prevTo),
    };
  }

  private async resolveMarketplaceKeys(
    sellerAliases: string[],
    marketplace?: string,
    gstin?: string,
  ) {
    const selected = String(marketplace ?? '').trim();
    if (!selected) return [];
    const gstScopeIds = gstin
      ? await this.gstScopeIds(gstin, sellerAliases)
      : [];
    const doc = await this.marketplaceModel
      .findOne({
        _id: selected,
        sellerId: { $in: sellerAliases },
        ...(gstScopeIds.length ? { gstId: { $in: gstScopeIds } } : {}),
      })
      .lean()
      .exec();
    if (!doc) return [selected];
    return Array.from(new Set([String(doc._id), selected]));
  }

  private async gstScopeIds(gstin: string, sellerAliases: string[]) {
    const scope = new Set<string>([gstin]);
    const gst = await this.gstModel
      .findOne({ gstNumber: gstin, sellerId: { $in: sellerAliases } })
      .select('_id')
      .lean()
      .exec();
    if (gst?._id) scope.add(String(gst._id));
    return Array.from(scope);
  }

  private async marketplaceNames(sellerAliases: string[]) {
    const docs = await this.marketplaceModel
      .find({ sellerId: { $in: sellerAliases } })
      .populate<{ platformMarketplaceId?: { name?: string } }>(
        'platformMarketplaceId',
        'name',
      )
      .select('storeName platformMarketplaceId')
      .lean()
      .exec();
    const map = new Map<string, string>();
    for (const doc of docs) {
      const platform = doc.platformMarketplaceId as { name?: string } | undefined;
      map.set(
        String(doc._id),
        String(platform?.name ?? doc.storeName ?? doc._id),
      );
    }
    return map;
  }

  private normalizeRequestedState(value: string) {
    const raw = String(value ?? '').trim().toUpperCase();
    if (!raw) return '';
    if (raw === UNMAPPED_STATE_CODE) return UNMAPPED_STATE_CODE;
    const byIso = INDIA_STATE_CATALOG.find((item) => item.isoCode === raw);
    if (byIso) return byIso.gstCode;
    const padded = raw.padStart(2, '0');
    if (INDIA_STATE_CATALOG.some((item) => item.gstCode === padded)) return padded;
    if (padded === '25') return '26';
    if (padded === '37') return '28';
    return '';
  }

  private iso(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private round(value: number) {
    return Number((Number.isFinite(value) ? value : 0).toFixed(2));
  }

  private csv(value: unknown) {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  private readCache<T>(key: string): T | undefined {
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return hit.value;
  }

  private writeCache<T>(key: string, value: T) {
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  }
}

function ctxStamp(query: GeographyAnalyticsDto) {
  return `${query.fromDate ?? 'month'}_${query.toDate ?? 'today'}`.replace(
    /[^0-9A-Za-z_-]/g,
    '',
  );
}
