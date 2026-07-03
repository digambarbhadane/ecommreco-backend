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
import { ValidationService } from './validation.service';
import { StateWiseExportDto } from '../dto/state-wise-export.dto';
import {
  buildStateWiseSalesMatch,
  StateWiseAggregatedRow,
} from '../utils/state-wise-report.aggregation';
import {
  aggregateStateWiseRows,
  sellerStateKeysFromRegistration,
} from '../utils/state-wise-gst-split.util';

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
export class StateWiseReportService {
  private readonly logger = new Logger(StateWiseReportService.name);

  constructor(
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(Gst.name)
    private readonly gstModel: Model<GstDocument>,
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

  private async resolveContext(query: StateWiseExportDto): Promise<ReportContext> {
    const sellerId = String(query.sellerId ?? '').trim();
    const gstin = String(query.gstin ?? '').trim().toUpperCase();
    if (!sellerId || !gstin) {
      throw new BadRequestException('sellerId and gstin are required');
    }
    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const gstScopeIds = await this.resolveGstScopeIds(gstin, sellerAliases);
    return { sellerId, gstin, sellerAliases, gstScopeIds };
  }

  private async resolveGstScopeIds(
    gstin: string,
    sellerAliases: string[],
  ): Promise<string[]> {
    const normalizedGstin = String(gstin ?? '').trim().toUpperCase();
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

  private async buildSalesFilter(ctx: ReportContext): Promise<Record<string, unknown>> {
    return buildStateWiseSalesMatch({
      sellerId: { $in: ctx.sellerAliases },
      gstin: ctx.gstin,
    });
  }

  private async buildPlatformGroups(ctx: ReportContext): Promise<
    Array<{
      platformId: string;
      name: string;
      rowMarketplaceIds: string[];
      registeredLinkIds: string[];
    }>
  > {
    const salesFilter = await this.buildSalesFilter(ctx);
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
        gstId: { $in: ctx.gstScopeIds },
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
        : group.registeredLinkIds[0] ??
          group.rowMarketplaceIds[0] ??
          group.platformId;
    return { id, name: group.name, matchKeys };
  }

  private async resolveMarketplaceTargets(
    query: StateWiseExportDto,
    ctx: ReportContext,
  ): Promise<MarketplaceTarget[]> {
    const groups = await this.buildPlatformGroups(ctx);
    if (!groups.length) {
      return [];
    }

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
        if (corrected) {
          platformId = this.platformIdOf(corrected);
        }
      }

      const matched = groups.filter(
        (g) =>
          (platformId && g.platformId === platformId) ||
          g.rowMarketplaceIds.includes(single) ||
          g.registeredLinkIds.includes(single),
      );

      if (matched.length) {
        return [this.groupToTarget(matched[0], single)];
      }

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
        .find({ _id: { $in: idsFromQuery }, sellerId: { $in: ctx.sellerAliases } })
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

  private async resolveSellerStateKeysForGstin(
    ctx: ReportContext,
  ): Promise<Set<string>> {
    const gstRecord = await this.gstModel
      .findOne({
        gstNumber: ctx.gstin,
        sellerId: { $in: ctx.sellerAliases },
      })
      .select('state gstNumber')
      .lean()
      .exec();

    return sellerStateKeysFromRegistration(
      gstRecord?.state,
      gstRecord?.gstNumber ?? ctx.gstin,
    );
  }

  private async aggregateForMarketplace(
    ctx: ReportContext,
    target: MarketplaceTarget,
  ): Promise<StateWiseAggregatedRow[]> {
    const salesFilter = await this.buildSalesFilter(ctx);
    const match = {
      ...salesFilter,
      marketplace: { $in: target.matchKeys },
    };

    const sellerStateKeys = await this.resolveSellerStateKeysForGstin(ctx);
    if (sellerStateKeys.size === 0) {
      this.logger.warn(
        `State-wise report: no seller registration state resolved for GSTIN ${ctx.gstin}`,
      );
    }

    const rows = await this.rowModel
      .find(match)
      .select({
        stateName: 1,
        igstRate: 1,
        cgstRate: 1,
        sgstRate: 1,
        igstAmount: 1,
        cgstAmount: 1,
        sgstAmount: 1,
        taxableAmount: 1,
        invoiceAmount: 1,
        quantity: 1,
        returnQty: 1,
        meeshoIsGrossSale: 1,
      })
      .lean()
      .exec();

    return aggregateStateWiseRows(rows, sellerStateKeys);
  }

  private async buildReportData(query: StateWiseExportDto) {
    const ctx = await this.resolveContext(query);
    const targets = await this.resolveMarketplaceTargets(query, ctx);

    this.logger.debug(
      `State-wise report seller=${ctx.sellerId} gstin=${ctx.gstin} marketplace=${query.marketplace ?? 'all'} targets=${targets.length}`,
    );

    const marketplaces: Array<{
      id: string;
      name: string;
      rowCount: number;
      rows: StateWiseAggregatedRow[];
    }> = [];

    for (const target of targets) {
      const rows = await this.aggregateForMarketplace(ctx, target);
      this.logger.debug(
        `Marketplace ${target.name} matchKeys=${target.matchKeys.length} aggregatedRows=${rows.length}`,
      );
      marketplaces.push({
        id: target.id,
        name: target.name,
        rowCount: rows.length,
        rows,
      });
    }

    const totalRows = marketplaces.reduce((sum, mp) => sum + mp.rowCount, 0);
    return { ctx, marketplaces, totalRows };
  }

  private assertHasData(totalRows: number, ctx: ReportContext) {
    if (totalRows > 0) return;
    this.logger.warn(
      `State-wise report empty for seller=${ctx.sellerId} gstin=${ctx.gstin}`,
    );
    throw new BadRequestException(NO_DATA_MESSAGE);
  }

  async getPreview(query: StateWiseExportDto) {
    const { marketplaces, totalRows } = await this.buildReportData(query);

    return {
      success: true,
      data: {
        sheetCount: marketplaces.length,
        totalRows,
        marketplaces: marketplaces.map((mp) => ({
          id: mp.id,
          name: mp.name,
          rowCount: mp.rowCount,
        })),
        message: totalRows === 0 ? NO_DATA_MESSAGE : undefined,
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

  private writeSheet(sheet: ExcelJS.Worksheet, rows: StateWiseAggregatedRow[]) {
    sheet.addRow([...HEADERS]);
    this.styleSheetHeader(sheet);

    let totalQty = 0;
    let totalTaxable = 0;
    let totalIgst = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalInvoice = 0;

    for (const row of rows) {
      sheet.addRow([
        row.stateName,
        this.formatGstRate(row.gstRate),
        row.qty,
        row.taxableValue,
        row.igst,
        row.cgst,
        row.sgst,
        row.invoiceAmount,
      ]);
      totalQty += row.qty;
      totalTaxable += row.taxableValue;
      totalIgst += row.igst;
      totalCgst += row.cgst;
      totalSgst += row.sgst;
      totalInvoice += row.invoiceAmount;
    }

    if (rows.length) {
      const totalRow = sheet.addRow([
        'TOTAL',
        '',
        totalQty,
        totalTaxable,
        totalIgst,
        totalCgst,
        totalSgst,
        totalInvoice,
      ]);
      totalRow.font = { bold: true };
    }

    sheet.columns = [
      { width: 28 },
      { width: 12 },
      { width: 10 },
      { width: 16 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 18 },
    ];

    const currencyCols = [4, 5, 6, 7, 8];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      for (const c of currencyCols) {
        const cell = sheet.getRow(r).getCell(c);
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0.00';
        }
      }
      sheet.getRow(r).getCell(3).numFmt = '#,##0';
    }
  }

  async generateWorkbook(query: StateWiseExportDto): Promise<{
    buffer: Buffer;
    sheetCount: number;
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
      this.writeSheet(sheet, mp.rows);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const gstSlug = ctx.gstin.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15);
    const filename = `state-wise-gst-${gstSlug}-${Date.now()}.xlsx`;

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
      for (const row of mp.rows) {
        lines.push(
          [
            mp.name,
            row.stateName,
            this.formatGstRate(row.gstRate),
            row.qty,
            row.taxableValue,
            row.igst,
            row.cgst,
            row.sgst,
            row.invoiceAmount,
          ]
            .map((value) => this.escapeCsvValue(value))
            .join(','),
        );
      }
    }

    const gstSlug = ctx.gstin.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15);
    const filename = `state-wise-gst-${gstSlug}-${Date.now()}.csv`;

    return {
      buffer: Buffer.from(lines.join('\n'), 'utf-8'),
      totalRows,
      filename,
    };
  }
}
