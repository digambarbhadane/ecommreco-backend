import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  getRowCell,
  MYNTRA_GSTR_ORDER_ID_ALIASES,
  MYNTRA_GSTR_RTO_ORDER_ID_ALIASES,
  MYNTRA_GSTR_RT_ORDER_ID_ALIASES,
  MYNTRA_MDIRECT_ORDER_ID_ALIASES,
  MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES,
  MYNTRA_SALES_ORDER_ID_ALIASES,
  MappingService,
  NormalizedImportRow,
  ParsedSheetRow,
} from './mapping.service';
import { FileParserService } from './file-parser.service';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import { yieldToEventLoop } from '../utils/import-performance.util';
import { normalizeHeader as normalizeHeaderUtil } from '../utils/header.util';

type ParsedMyntraFile = {
  rows: ParsedSheetRow[];
  headers: string[];
};

export type MyntraReturnMatchStatus =
  | 'MATCHED_CURRENT_MONTH'
  | 'MATCHED_PREVIOUS_MONTH'
  | 'UNMATCHED_RETURN';

export type MyntraBuildContext = {
  sellerIds: string[];
  gstin: string;
  marketplaceId: string;
  reportMonth: string;
};

export type MyntraBuildResult = {
  rows: Array<
    NormalizedImportRow & {
      __sheetName: string;
      __rowNumber: number;
    }
  >;
  errors: Array<{
    sheetName: string;
    rowNumber: number;
    error: string;
  }>;
  joinIssues?: {
    missingOrderIdInGstr?: number;
    missingInMdirect?: number;
    missingInGstr?: number;
    missingInSales?: number;
  };
  /** Prior-month sale row ids to flag as returned after insert. */
  historicalSaleIdsToMarkReturned: string[];
};

type SaleSnapshot = {
  orderID?: string;
  skuID?: string;
  hsnCode?: string;
  paymentMode?: string;
  fulfilmentType?: string;
  quantity?: number;
  invoiceAmount?: number;
  taxableAmount?: number;
  igstRate?: number;
  igstAmount?: number;
  cgstRate?: number;
  cgstAmount?: number;
  sgstRate?: number;
  sgstAmount?: number;
  gstTransactionType?: 'intra' | 'inter';
  invoiceNo?: string;
  invoiceDate?: string;
  order_packed_date?: string;
  pincode?: string;
  stateName?: string;
  customerStateCode?: string;
  sellerGSTIN?: string;
};

type HistoricalSaleEntry = SaleSnapshot & {
  _id: string;
  reportMonth?: string;
};

type CurrentSaleEntry = {
  rowIndex: number;
  snapshot: SaleSnapshot;
};

type ReturnProcessingStats = {
  totalRows: number;
  matchedCurrent: number;
  matchedPrevious: number;
  unmatched: number;
  finalQty: number;
  finalTaxable: number;
  finalIgst: number;
  finalCgst: number;
  finalSgst: number;
  finalInvoice: number;
};

const MYNTRA_PREFERRED_RETURN_ORDER_ID_ALIASES = [
  'order_id',
  'Order ID',
  'Order Id',
  'order_release_id',
  'sale_order_code',
  'Sale_Order_Code',
] as const;

@Injectable()
export class MyntraImportService {
  private readonly logger = new Logger(MyntraImportService.name);

  constructor(
    private readonly parser: FileParserService,
    private readonly mapping: MappingService,
    @Optional()
    @InjectModel(ImportRow.name)
    private readonly rowModel?: Model<ImportRowDocument>,
  ) {}

  async parseFiles(files: {
    gstrReportPackedFile?: { buffer: Buffer; originalname: string };
    mDirectOrdersReportFile?: { buffer: Buffer; originalname: string };
    salesRevenuePackedB2cFile?: { buffer: Buffer; originalname: string };
    gstrReportRtoFile?: { buffer: Buffer; originalname: string };
    gstrReportRtFile?: { buffer: Buffer; originalname: string };
    mDirectReturnsReportFile?: { buffer: Buffer; originalname: string };
  }) {
    const empty: ParsedMyntraFile = { rows: [], headers: [] };
    const yieldToEventLoop = () =>
      new Promise<void>((resolve) => setImmediate(resolve));
    const parse = async (
      file: { buffer: Buffer; originalname: string } | undefined,
      kind:
        | 'gstrReportPacked'
        | 'mDirectOrders'
        | 'salesRevenueB2c'
        | 'gstrReportRto'
        | 'gstrReportRt'
        | 'mDirectReturns',
    ) => {
      if (!file) return empty;
      await yieldToEventLoop();
      return this.parser.parseMyntraWorkbook(file.buffer, kind);
    };

    return {
      gstrReportPacked: await parse(
        files.gstrReportPackedFile,
        'gstrReportPacked',
      ),
      mDirectOrders: await parse(
        files.mDirectOrdersReportFile,
        'mDirectOrders',
      ),
      salesRevenueB2c: await parse(
        files.salesRevenuePackedB2cFile,
        'salesRevenueB2c',
      ),
      gstrReportRto: await parse(files.gstrReportRtoFile, 'gstrReportRto'),
      gstrReportRt: await parse(files.gstrReportRtFile, 'gstrReportRt'),
      mDirectReturns: await parse(
        files.mDirectReturnsReportFile,
        'mDirectReturns',
      ),
    };
  }

  private normalizeOrderKey(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Number.isInteger(raw)
        ? String(raw)
        : String(raw).replace(/\.0+$/, '');
    }
    let value = String(raw).trim();
    if (!value) return '';
    value = value.replace(/^['"]+|['"]+$/g, '').replace(/\s+/g, '');
    value = value.replace(/\.0+$/, '');
    return value.toUpperCase();
  }

  private isUuidLike(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    );
  }

  private getExactRowCell(row: ParsedSheetRow, alias: string): unknown {
    const target = normalizeHeaderUtil(alias);
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith('__')) continue;
      if (normalizeHeaderUtil(key) === target) {
        return value;
      }
    }
    return undefined;
  }

  private resolvePreferredReturnOrderId(
    row: ParsedSheetRow,
    mappedOrderID?: string,
    orderAliases?: readonly string[],
  ): string | undefined {
    const aliases = orderAliases?.length
      ? orderAliases
      : MYNTRA_PREFERRED_RETURN_ORDER_ID_ALIASES;
    for (const alias of aliases) {
      const raw = this.getExactRowCell(row, alias);
      const key = this.normalizeOrderKey(raw);
      if (!key) continue;
      if (this.isUuidLike(key)) continue;
      return key;
    }

    const fallback = this.normalizeOrderKey(mappedOrderID);
    if (!fallback || this.isUuidLike(fallback)) return undefined;
    return fallback;
  }

  private collectOrderKeys(
    row: ParsedSheetRow,
    aliases: readonly string[],
  ): string[] {
    const keys = new Set<string>();
    for (const alias of aliases) {
      const key = this.normalizeOrderKey(getRowCell(row, alias));
      if (key) keys.add(key);
    }
    return [...keys];
  }

  private resolveOrderKeys(
    row: ParsedSheetRow,
    aliases: readonly string[],
    mappedOrderID?: string,
  ): string[] {
    const keys = new Set(this.collectOrderKeys(row, aliases));
    const mappedKey = this.normalizeOrderKey(mappedOrderID);
    if (mappedKey) keys.add(mappedKey);
    return [...keys];
  }

  private indexByOrderId(
    rows: ParsedSheetRow[],
    ...aliasGroups: readonly (readonly string[])[]
  ): Map<string, ParsedSheetRow> {
    const index = new Map<string, ParsedSheetRow>();
    for (const row of rows) {
      const aliases = aliasGroups.flat();
      for (const key of this.collectOrderKeys(row, aliases)) {
        if (!index.has(key)) index.set(key, row);
      }
    }
    return index;
  }

  private lookupRowByOrderKeys(
    index: Map<string, ParsedSheetRow>,
    row: ParsedSheetRow,
    aliases: readonly string[],
  ): ParsedSheetRow | undefined {
    for (const key of this.collectOrderKeys(row, aliases)) {
      const hit = index.get(key);
      if (hit) return hit;
    }
    return undefined;
  }

  private mergeDefined<T extends Record<string, unknown>>(
    base: T,
    patch: Partial<T>,
  ): T {
    const out = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && value !== null && value !== '') {
        (out as Record<string, unknown>)[key] = value;
      }
    }
    return out;
  }

  private toSaleSnapshot(row: NormalizedImportRow): SaleSnapshot {
    return {
      orderID: row.orderID,
      skuID: row.skuID,
      hsnCode: row.hsnCode,
      paymentMode: row.paymentMode,
      fulfilmentType: row.fulfilmentType,
      quantity: row.quantity,
      invoiceAmount: row.invoiceAmount,
      taxableAmount: row.taxableAmount,
      igstRate: row.igstRate,
      igstAmount: row.igstAmount,
      cgstRate: row.cgstRate,
      cgstAmount: row.cgstAmount,
      sgstRate: row.sgstRate,
      sgstAmount: row.sgstAmount,
      gstTransactionType: row.gstTransactionType,
      invoiceNo: row.invoiceNo,
      invoiceDate: row.invoiceDate,
      order_packed_date: row.order_packed_date,
      pincode: row.pincode,
      stateName: row.stateName,
      customerStateCode: row.customerStateCode,
      sellerGSTIN: row.sellerGSTIN,
    };
  }

  private negateSaleAmounts(sale: SaleSnapshot): Partial<NormalizedImportRow> {
    const negate = (value?: number) =>
      value === undefined || value === null ? undefined : -Math.abs(value);
    const qty =
      sale.quantity === undefined || sale.quantity === null
        ? undefined
        : -Math.abs(sale.quantity);
    return {
      quantity: qty,
      invoiceAmount: negate(sale.invoiceAmount),
      taxableAmount: negate(sale.taxableAmount),
      igstAmount: negate(sale.igstAmount),
      cgstAmount: negate(sale.cgstAmount),
      sgstAmount: negate(sale.sgstAmount),
      igstRate: sale.igstRate,
      cgstRate: sale.cgstRate,
      sgstRate: sale.sgstRate,
      gstTransactionType: sale.gstTransactionType,
      paymentMode: sale.paymentMode,
      fulfilmentType: sale.fulfilmentType,
      skuID: sale.skuID,
      hsnCode: sale.hsnCode,
      invoiceNo: sale.invoiceNo,
      pincode: sale.pincode,
      stateName: sale.stateName,
      customerStateCode: sale.customerStateCode,
      sellerGSTIN: sale.sellerGSTIN,
    };
  }

  private applyMatchedSaleAmounts(
    returnRow: NormalizedImportRow,
    sale: SaleSnapshot,
  ): void {
    const existingIgst = returnRow.igstAmount;
    const existingCgst = returnRow.cgstAmount;
    const existingSgst = returnRow.sgstAmount;
    const existingIgstRate = returnRow.igstRate;
    const existingCgstRate = returnRow.cgstRate;
    const existingSgstRate = returnRow.sgstRate;
    const fromSale = this.negateSaleAmounts(sale);
    Object.assign(returnRow, this.mergeDefined(returnRow, fromSale));

    // Keep return-file tax when matched sale has missing/zero tax.
    const keepExistingOrSale = (
      existing?: number,
      matched?: number,
    ): number | undefined => {
      if (matched === undefined || matched === null || matched === 0)
        return existing;
      return matched;
    };
    returnRow.igstAmount = keepExistingOrSale(
      existingIgst,
      fromSale.igstAmount,
    );
    returnRow.cgstAmount = keepExistingOrSale(
      existingCgst,
      fromSale.cgstAmount,
    );
    returnRow.sgstAmount = keepExistingOrSale(
      existingSgst,
      fromSale.sgstAmount,
    );
    returnRow.igstRate = existingIgstRate ?? fromSale.igstRate;
    returnRow.cgstRate = existingCgstRate ?? fromSale.cgstRate;
    returnRow.sgstRate = existingSgstRate ?? fromSale.sgstRate;
    // Keep transaction type aligned with final GST breakup so summary aggregation
    // does not zero-out the wrong bucket (IGST vs CGST/SGST).
    if (
      sale.gstTransactionType === 'intra' ||
      sale.gstTransactionType === 'inter'
    ) {
      returnRow.gstTransactionType = sale.gstTransactionType;
    } else {
      const finalIgst = Number(returnRow.igstAmount ?? 0);
      const finalCgst = Number(returnRow.cgstAmount ?? 0);
      const finalSgst = Number(returnRow.sgstAmount ?? 0);
      if (finalIgst !== 0) {
        returnRow.gstTransactionType = 'inter';
      } else if (finalCgst !== 0 || finalSgst !== 0) {
        returnRow.gstTransactionType = 'intra';
      }
    }

    this.negateUnmatchedReturnAmounts(returnRow);
  }

  private negateUnmatchedReturnAmounts(row: NormalizedImportRow): void {
    const negate = (value?: number) =>
      value === undefined || value === null ? undefined : -Math.abs(value);
    if (
      row.quantity !== undefined &&
      row.quantity !== null &&
      row.quantity > 0
    ) {
      row.quantity = -Math.abs(row.quantity);
    }
    if (
      row.invoiceAmount !== undefined &&
      row.invoiceAmount !== null &&
      row.invoiceAmount > 0
    ) {
      row.invoiceAmount = negate(row.invoiceAmount);
    }
    if (
      row.taxableAmount !== undefined &&
      row.taxableAmount !== null &&
      row.taxableAmount > 0
    ) {
      row.taxableAmount = negate(row.taxableAmount);
    }
    if (
      row.igstAmount !== undefined &&
      row.igstAmount !== null &&
      row.igstAmount > 0
    ) {
      row.igstAmount = negate(row.igstAmount);
    }
    if (
      row.cgstAmount !== undefined &&
      row.cgstAmount !== null &&
      row.cgstAmount > 0
    ) {
      row.cgstAmount = negate(row.cgstAmount);
    }
    if (
      row.sgstAmount !== undefined &&
      row.sgstAmount !== null &&
      row.sgstAmount > 0
    ) {
      row.sgstAmount = negate(row.sgstAmount);
    }
    if (
      row.gstAmount !== undefined &&
      row.gstAmount !== null &&
      row.gstAmount > 0
    ) {
      row.gstAmount = negate(row.gstAmount);
    }
  }

  private mergeMdirectReturnFields(
    target: NormalizedImportRow,
    mDirectReturnsRow: ParsedSheetRow | undefined,
    returnsHeaderMap: ReturnType<
      MappingService['buildMyntraMdirectReturnsHeaderMap']
    >,
  ): void {
    if (!mDirectReturnsRow) return;
    const fromReturns = this.mapping.mapRowFast(
      mDirectReturnsRow,
      'sales',
      returnsHeaderMap,
    );
    const {
      documentType: _documentType,
      myntraTransactionType: _myntraTransactionType,
      reportType: _reportType,
      typeOfReturn: _typeOfReturn,
      myntraReturnMatchStatus: _myntraReturnMatchStatus,
      orderID: _orderID,
      ...returnFields
    } = fromReturns;
    Object.assign(target, this.mergeDefined(target, returnFields));
  }

  private async loadPriorMonthSalesMap(
    context: MyntraBuildContext,
  ): Promise<Map<string, HistoricalSaleEntry>> {
    return this.loadDbSalesMap(context, 'prior');
  }

  /** Same-month sales already in DB (re-upload) — used only for return matching. */
  private async loadSameMonthDbSalesMap(
    context: MyntraBuildContext,
  ): Promise<Map<string, HistoricalSaleEntry>> {
    return this.loadDbSalesMap(context, 'same');
  }

  private async loadDbSalesMap(
    context: MyntraBuildContext,
    scope: 'prior' | 'same',
  ): Promise<Map<string, HistoricalSaleEntry>> {
    const map = new Map<string, HistoricalSaleEntry>();
    if (!this.rowModel || !context.reportMonth) return map;

    const reportMonthFilter =
      scope === 'prior'
        ? { reportMonth: { $lt: context.reportMonth } }
        : { reportMonth: context.reportMonth };

    const sales = await this.rowModel
      .find({
        sellerId: { $in: context.sellerIds },
        gstin: context.gstin,
        marketplace: context.marketplaceId,
        documentType: 'SALE',
        ...reportMonthFilter,
      })
      .select({
        orderID: 1,
        reportMonth: 1,
        skuID: 1,
        hsnCode: 1,
        paymentMode: 1,
        fulfilmentType: 1,
        quantity: 1,
        invoiceAmount: 1,
        taxableAmount: 1,
        igstRate: 1,
        igstAmount: 1,
        cgstRate: 1,
        cgstAmount: 1,
        sgstRate: 1,
        sgstAmount: 1,
        gstTransactionType: 1,
        invoiceNo: 1,
        invoiceDate: 1,
        order_packed_date: 1,
        pincode: 1,
        stateName: 1,
        customerStateCode: 1,
        sellerGSTIN: 1,
      })
      .sort({ reportMonth: -1 })
      .lean()
      .exec();

    for (const doc of sales) {
      const entry: HistoricalSaleEntry = {
        _id: String(doc._id),
        reportMonth: doc.reportMonth,
        ...this.toSaleSnapshot(doc as NormalizedImportRow),
      };
      this.registerHistoricalSaleLookup(map, entry);
    }
    return map;
  }

  private registerHistoricalSaleLookup(
    map: Map<string, HistoricalSaleEntry>,
    entry: HistoricalSaleEntry,
  ): void {
    const orderKey = this.normalizeOrderKey(entry.orderID);
    if (orderKey && !map.has(orderKey)) {
      map.set(orderKey, entry);
    }

    const invoiceKey = this.normalizeOrderKey(entry.invoiceNo);
    if (invoiceKey && !map.has(invoiceKey)) {
      map.set(invoiceKey, entry);
    }
  }

  private buildReturnLookupKeys(
    orderKeys: string[],
    invoiceNo?: string,
  ): string[] {
    const keys = new Set(orderKeys);
    const invoiceKey = this.normalizeOrderKey(invoiceNo);
    if (invoiceKey) keys.add(invoiceKey);
    return [...keys];
  }

  private applyReturnMatch(
    returnRow: NormalizedImportRow,
    orderKeys: string[],
    currentSales: Map<string, CurrentSaleEntry>,
    gstrByOrder: Map<string, ParsedSheetRow>,
    priorMonthSales: Map<string, HistoricalSaleEntry>,
    sameMonthDbSales: Map<string, HistoricalSaleEntry>,
    rows: NormalizedImportRow[],
    historicalSaleIdsToMarkReturned: string[],
  ): void {
    const lookupKeys = this.buildReturnLookupKeys(
      orderKeys,
      returnRow.invoiceNo,
    );

    let matchedCurrent: CurrentSaleEntry | undefined;
    for (const key of lookupKeys) {
      const hit = currentSales.get(key);
      if (hit) {
        matchedCurrent = hit;
        break;
      }
    }

    if (matchedCurrent) {
      const sale = matchedCurrent.snapshot;
      this.applyMatchedSaleAmounts(returnRow, sale);
      // Keep Order Wise Payments grouped under the original GSTR Order Id for RTO.
      if (sale.orderID && returnRow.documentType !== 'Customer Return') {
        returnRow.orderID = sale.orderID;
      }
      returnRow.myntraReturnMatchStatus = 'MATCHED_CURRENT_MONTH';
      returnRow.linkedSaleRowId = undefined;
      returnRow.saleReferenceMonth = undefined;
      rows[matchedCurrent.rowIndex].myntraIsReturned = true;
      return;
    }

    let matchedHistorical: HistoricalSaleEntry | undefined;
    for (const key of lookupKeys) {
      const hit = priorMonthSales.get(key);
      if (hit) {
        matchedHistorical = hit;
        break;
      }
    }

    if (matchedHistorical) {
      this.applyMatchedSaleAmounts(returnRow, matchedHistorical);
      if (matchedHistorical.orderID && returnRow.documentType !== 'Customer Return') {
        returnRow.orderID = matchedHistorical.orderID;
      }
      if (returnRow.documentType === 'RTO Return') {
        this.logger.log(
          JSON.stringify({
            tag: 'MATCHED_PREVIOUS_MONTH_ORIGINAL_SALE',
            orderId: matchedHistorical.orderID ?? null,
            packetId:
              (matchedHistorical as Record<string, unknown>).packetID ?? null,
            invoiceNumber: matchedHistorical.invoiceNo ?? null,
            saleMonth: matchedHistorical.reportMonth ?? null,
            originalTaxable: matchedHistorical.taxableAmount ?? null,
            originalIgst:
              (matchedHistorical as Record<string, unknown>).igst ??
              matchedHistorical.igstAmount ??
              null,
            originalCgst:
              (matchedHistorical as Record<string, unknown>).cgst ??
              matchedHistorical.cgstAmount ??
              null,
            originalSgst:
              (matchedHistorical as Record<string, unknown>).sgst ??
              matchedHistorical.sgstAmount ??
              null,
            originalInvoiceAmount: matchedHistorical.invoiceAmount ?? null,
            originalIgstAmount: matchedHistorical.igstAmount ?? null,
            originalCgstAmount: matchedHistorical.cgstAmount ?? null,
            originalSgstAmount: matchedHistorical.sgstAmount ?? null,
            finalTaxable: returnRow.taxableAmount ?? null,
            finalIgst: returnRow.igstAmount ?? null,
            finalCgst: returnRow.cgstAmount ?? null,
            finalSgst: returnRow.sgstAmount ?? null,
            finalInvoiceAmount: returnRow.invoiceAmount ?? null,
            finalGstTransactionType: returnRow.gstTransactionType ?? null,
          }),
        );
        this.logger.log(
          `[Myntra PriorMonth RTO Match] order=${returnRow.orderID ?? ''}, sourceMonth=${matchedHistorical.reportMonth ?? ''}, originalIgst=${matchedHistorical.igstAmount ?? 0}, originalCgst=${matchedHistorical.cgstAmount ?? 0}, originalSgst=${matchedHistorical.sgstAmount ?? 0}, finalIgst=${returnRow.igstAmount ?? 0}, finalCgst=${returnRow.cgstAmount ?? 0}, finalSgst=${returnRow.sgstAmount ?? 0}`,
        );
      }
      returnRow.myntraReturnMatchStatus = 'MATCHED_PREVIOUS_MONTH';
      returnRow.linkedSaleRowId = matchedHistorical._id;
      returnRow.saleReferenceMonth = matchedHistorical.reportMonth;
      if (!historicalSaleIdsToMarkReturned.includes(matchedHistorical._id)) {
        historicalSaleIdsToMarkReturned.push(matchedHistorical._id);
      }
      return;
    }

    let matchedSameMonthDb: HistoricalSaleEntry | undefined;
    for (const key of lookupKeys) {
      const hit = sameMonthDbSales.get(key);
      if (hit) {
        matchedSameMonthDb = hit;
        break;
      }
    }

    if (matchedSameMonthDb) {
      this.applyMatchedSaleAmounts(returnRow, matchedSameMonthDb);
      if (matchedSameMonthDb.orderID && returnRow.documentType !== 'Customer Return') {
        returnRow.orderID = matchedSameMonthDb.orderID;
      }
      returnRow.myntraReturnMatchStatus = 'MATCHED_PREVIOUS_MONTH';
      returnRow.linkedSaleRowId = matchedSameMonthDb._id;
      returnRow.saleReferenceMonth = matchedSameMonthDb.reportMonth;
      if (!historicalSaleIdsToMarkReturned.includes(matchedSameMonthDb._id)) {
        historicalSaleIdsToMarkReturned.push(matchedSameMonthDb._id);
      }
      return;
    }

    for (const key of lookupKeys) {
      const gstrRow = gstrByOrder.get(key);
      if (!gstrRow) continue;
      const gstrMapped = this.mapping.mapMyntraGstrRow(gstrRow);
      const snapshot = this.negateSaleAmounts(this.toSaleSnapshot(gstrMapped));
      if (returnRow.documentType === 'Customer Return') {
        delete snapshot.orderID;
      }
      Object.assign(
        returnRow,
        this.mergeDefined(
          returnRow,
          snapshot,
        ),
      );
      this.negateUnmatchedReturnAmounts(returnRow);
      break;
    }

    returnRow.myntraReturnMatchStatus = 'UNMATCHED_RETURN';
    returnRow.linkedSaleRowId = undefined;
    returnRow.saleReferenceMonth = undefined;
    this.negateUnmatchedReturnAmounts(returnRow);
  }

  private getPriorMonthBounds(reportMonth: string): {
    start: string;
    end: string;
  } {
    const [year, month] = reportMonth.split('-').map(Number);
    if (!year || !month) {
      return { start: '', end: '' };
    }
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 0, 23, 59, 59, 999));
    const toIso = (d: Date) => d.toISOString();
    return { start: toIso(start), end: toIso(end) };
  }

  private async processReturnRows(params: {
    rowsToProcess: ParsedSheetRow[];
    headerMap: ReturnType<MappingService['buildMyntraGstrRtoHeaderMap']>;
    orderAliases: readonly string[];
    documentType: 'RTO Return' | 'Customer Return';
    processedKeys: Set<string>;
    dedupePrefix: 'rto' | 'rt';
    currentSales: Map<string, CurrentSaleEntry>;
    gstrByOrder: Map<string, ParsedSheetRow>;
    priorMonthSales: Map<string, HistoricalSaleEntry>;
    sameMonthDbSales: Map<string, HistoricalSaleEntry>;
    mDirectReturnsByOrder: Map<string, ParsedSheetRow>;
    returnsHeaderMap: ReturnType<
      MappingService['buildMyntraMdirectReturnsHeaderMap']
    >;
    targetRows: MyntraBuildResult['rows'];
    targetErrors: MyntraBuildResult['errors'];
    historicalSaleIdsToMarkReturned: string[];
  }): Promise<ReturnProcessingStats> {
    const stats: ReturnProcessingStats = {
      totalRows: params.rowsToProcess.length,
      matchedCurrent: 0,
      matchedPrevious: 0,
      unmatched: 0,
      finalQty: 0,
      finalTaxable: 0,
      finalIgst: 0,
      finalCgst: 0,
      finalSgst: 0,
      finalInvoice: 0,
    };

    for (let i = 0; i < params.rowsToProcess.length; i += 1) {
      const sourceRow = params.rowsToProcess[i];
      try {
        const mapped = this.mapping.mapRowFast(
          sourceRow,
          'sales',
          params.headerMap,
        );
        this.mapping.enrichMyntraGstrReturnGstFields(
          mapped,
          sourceRow,
          params.dedupePrefix === 'rt' ? 'rt' : 'rto',
        );
        mapped.documentType = params.documentType;
        mapped.typeOfReturn = params.documentType;
        mapped.myntraTransactionType = 'RETURN';
        mapped.invoiceDate = undefined;

        const preferredOrderId = this.resolvePreferredReturnOrderId(
          sourceRow,
          mapped.orderID,
          params.orderAliases,
        );
        if (preferredOrderId) {
          mapped.orderID = preferredOrderId;
        }

        const orderKeys = this.resolveOrderKeys(
          sourceRow,
          params.orderAliases,
          mapped.orderID,
        );
        if (!mapped.orderID && orderKeys[0]) mapped.orderID = orderKeys[0];

        const dedupeKey = `${params.dedupePrefix}:${sourceRow.__sheetName}:${sourceRow.__rowNumber}`;
        if (params.processedKeys.has(dedupeKey)) continue;
        params.processedKeys.add(dedupeKey);

        const mDirectReturnsRow = this.lookupRowByOrderKeys(
          params.mDirectReturnsByOrder,
          sourceRow,
          MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES,
        );
        this.mergeMdirectReturnFields(
          mapped,
          mDirectReturnsRow,
          params.returnsHeaderMap,
        );
        mapped.documentType = params.documentType;
        mapped.typeOfReturn = params.documentType;
        mapped.myntraTransactionType = 'RETURN';

        this.applyReturnMatch(
          mapped,
          orderKeys,
          params.currentSales,
          params.gstrByOrder,
          params.priorMonthSales,
          params.sameMonthDbSales,
          params.targetRows,
          params.historicalSaleIdsToMarkReturned,
        );

        if (mapped.myntraReturnMatchStatus === 'MATCHED_CURRENT_MONTH') {
          stats.matchedCurrent += 1;
        } else if (
          mapped.myntraReturnMatchStatus === 'MATCHED_PREVIOUS_MONTH'
        ) {
          stats.matchedPrevious += 1;
        } else {
          stats.unmatched += 1;
        }
        stats.finalQty += Number(mapped.quantity ?? 0);
        stats.finalTaxable += Number(mapped.taxableAmount ?? 0);
        stats.finalIgst += Number(mapped.igstAmount ?? 0);
        stats.finalCgst += Number(mapped.cgstAmount ?? 0);
        stats.finalSgst += Number(mapped.sgstAmount ?? 0);
        stats.finalInvoice += Number(mapped.invoiceAmount ?? 0);
        if (
          params.documentType === 'RTO Return' &&
          mapped.myntraReturnMatchStatus === 'MATCHED_PREVIOUS_MONTH'
        ) {
          this.logger.log(
            `BEFORE_SAVE_PRIOR_RTO ${JSON.stringify({
              orderId: mapped.orderID ?? null,
              invoiceNo: mapped.invoiceNo ?? null,
              saleReferenceMonth: mapped.saleReferenceMonth ?? null,
              taxableValue: mapped.taxableAmount ?? 0,
              igst: mapped.igstAmount ?? 0,
              cgst: mapped.cgstAmount ?? 0,
              sgst: mapped.sgstAmount ?? 0,
              invoiceAmount: mapped.invoiceAmount ?? 0,
              gstTransactionType: mapped.gstTransactionType ?? null,
            })}`,
          );
        }

        params.targetRows.push({
          ...mapped,
          __sheetName: sourceRow.__sheetName,
          __rowNumber: sourceRow.__rowNumber,
        });
      } catch {
        params.targetErrors.push({
          sheetName: sourceRow.__sheetName,
          rowNumber: sourceRow.__rowNumber,
          error: `Failed to normalize Myntra ${params.documentType} row`,
        });
      }
      if (i > 0 && i % 2000 === 0) {
        await yieldToEventLoop();
      }
    }
    return stats;
  }

  async buildNormalizedRows(
    parsed: {
      gstrReportPacked: ParsedMyntraFile;
      mDirectOrders: ParsedMyntraFile;
      salesRevenueB2c: ParsedMyntraFile;
      gstrReportRto: ParsedMyntraFile;
      gstrReportRt: ParsedMyntraFile;
      mDirectReturns: ParsedMyntraFile;
    },
    context: MyntraBuildContext,
  ): Promise<MyntraBuildResult> {
    const rows: MyntraBuildResult['rows'] = [];
    const errors: MyntraBuildResult['errors'] = [];
    const historicalSaleIdsToMarkReturned: string[] = [];
    const [priorMonthSales, sameMonthDbSales] = await Promise.all([
      this.loadPriorMonthSalesMap(context),
      this.loadSameMonthDbSalesMap(context),
    ]);
    const priorMonthBounds = this.getPriorMonthBounds(context.reportMonth);

    const gstrByOrder = this.indexByOrderId(
      parsed.gstrReportPacked.rows,
      MYNTRA_GSTR_ORDER_ID_ALIASES,
      MYNTRA_SALES_ORDER_ID_ALIASES,
    );
    const salesByOrder = this.indexByOrderId(
      parsed.salesRevenueB2c.rows,
      MYNTRA_SALES_ORDER_ID_ALIASES,
    );
    const mDirectByOrder = this.indexByOrderId(
      parsed.mDirectOrders.rows,
      MYNTRA_MDIRECT_ORDER_ID_ALIASES,
    );
    const mDirectReturnsByOrder = this.indexByOrderId(
      parsed.mDirectReturns.rows,
      MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES,
    );

    const gstrHeaderMap = this.mapping.buildMyntraGstrHeaderMap(
      parsed.gstrReportPacked.headers,
    );
    const salesHeaderMap = this.mapping.buildMyntraSalesHeaderMap(
      parsed.salesRevenueB2c.headers,
    );
    const mdirectHeaderMap = this.mapping.buildMyntraMdirectHeaderMap(
      parsed.mDirectOrders.headers,
    );
    const rtoHeaderMap = this.mapping.buildMyntraGstrRtoHeaderMap(
      parsed.gstrReportRto.headers,
    );
    const rtHeaderMap = this.mapping.buildMyntraGstrRtHeaderMap(
      parsed.gstrReportRt.headers,
    );
    const returnsHeaderMap = this.mapping.buildMyntraMdirectReturnsHeaderMap(
      parsed.mDirectReturns.headers,
    );

    const currentSales = new Map<string, CurrentSaleEntry>();
    const processedSaleKeys = new Set<string>();
    const processedRtoKeys = new Set<string>();
    const processedRtKeys = new Set<string>();

    let missingOrderIdInGstr = 0;
    let missingInSales = 0;

    const gstrRows = parsed.gstrReportPacked.rows;
    for (let i = 0; i < gstrRows.length; i += 1) {
      const gstrRow = gstrRows[i];
      try {
        const mapped = this.mapping.mapRowFast(gstrRow, 'sales', gstrHeaderMap);
        mapped.documentType = 'SALE';
        mapped.myntraTransactionType = 'SALE';

        const orderKeys = this.collectOrderKeys(
          gstrRow,
          MYNTRA_GSTR_ORDER_ID_ALIASES,
        );
        const primaryKey = orderKeys[0];
        if (!primaryKey) {
          missingOrderIdInGstr += 1;
          continue;
        }
        if (processedSaleKeys.has(primaryKey)) continue;
        processedSaleKeys.add(primaryKey);

        const salesRow = this.lookupRowByOrderKeys(
          salesByOrder,
          gstrRow,
          [
            ...MYNTRA_GSTR_ORDER_ID_ALIASES,
            ...MYNTRA_SALES_ORDER_ID_ALIASES,
            'order_release_id',
          ],
        );
        if (salesRow) {
          const fromSales = this.mapping.mapRowFast(
            salesRow,
            'sales',
            salesHeaderMap,
          );
          const { orderID: _saleOrderId, ...salesFields } = fromSales;
          Object.assign(mapped, this.mergeDefined(mapped, salesFields));
        } else {
          missingInSales += 1;
        }

        const mDirectRow = this.lookupRowByOrderKeys(
          mDirectByOrder,
          gstrRow,
          MYNTRA_MDIRECT_ORDER_ID_ALIASES,
        );
        if (mDirectRow) {
          const fromMdirect = this.mapping.mapRowFast(
            mDirectRow,
            'sales',
            mdirectHeaderMap,
          );
          const { orderID: _mDirectOrderId, ...mDirectFields } = fromMdirect;
          Object.assign(mapped, this.mergeDefined(mapped, mDirectFields));
        }

        if (!mapped.orderID) mapped.orderID = primaryKey;
        if (!mapped.invoiceDate && mapped.order_packed_date) {
          mapped.invoiceDate = mapped.order_packed_date;
        }

        const rowIndex = rows.length;
        rows.push({
          ...mapped,
          __sheetName: gstrRow.__sheetName,
          __rowNumber: gstrRow.__rowNumber,
        });
        const saleEntry: CurrentSaleEntry = {
          rowIndex,
          snapshot: this.toSaleSnapshot(mapped),
        };
        for (const key of orderKeys) {
          currentSales.set(key, saleEntry);
        }
        // Invoice lookup lets RTO/RT rows that carry a different order_id
        // (but the same invoice) resolve to the original GSTR Order Id.
        const invoiceKey = this.normalizeOrderKey(mapped.invoiceNo);
        if (invoiceKey && !currentSales.has(invoiceKey)) {
          currentSales.set(invoiceKey, saleEntry);
        }
      } catch {
        errors.push({
          sheetName: gstrRow.__sheetName,
          rowNumber: gstrRow.__rowNumber,
          error: 'Failed to normalize GSTR Packed sale row',
        });
      }
      if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    }

    const rtoStats = await this.processReturnRows({
      rowsToProcess: parsed.gstrReportRto.rows,
      headerMap: rtoHeaderMap,
      orderAliases: MYNTRA_GSTR_RTO_ORDER_ID_ALIASES,
      documentType: 'RTO Return',
      processedKeys: processedRtoKeys,
      dedupePrefix: 'rto',
      currentSales,
      gstrByOrder,
      priorMonthSales,
      sameMonthDbSales,
      mDirectReturnsByOrder,
      returnsHeaderMap,
      targetRows: rows,
      targetErrors: errors,
      historicalSaleIdsToMarkReturned,
    });

    const rtStats = await this.processReturnRows({
      rowsToProcess: parsed.gstrReportRt.rows,
      headerMap: rtHeaderMap,
      orderAliases: MYNTRA_GSTR_RT_ORDER_ID_ALIASES,
      documentType: 'Customer Return',
      processedKeys: processedRtKeys,
      dedupePrefix: 'rt',
      currentSales,
      gstrByOrder,
      priorMonthSales,
      sameMonthDbSales,
      mDirectReturnsByOrder,
      returnsHeaderMap,
      targetRows: rows,
      targetErrors: errors,
      historicalSaleIdsToMarkReturned,
    });

    this.logger.log(
      `[Myntra PriorMonth Debug] reportMonth=${context.reportMonth}, priorStart=${priorMonthBounds.start}, priorEnd=${priorMonthBounds.end}, priorSalesFound=${priorMonthSales.size}, sameMonthSalesFound=${sameMonthDbSales.size}, rtoRows=${rtoStats.totalRows}, rtoMatchedCurrent=${rtoStats.matchedCurrent}, rtoMatchedPrevious=${rtoStats.matchedPrevious}, rtoUnmatched=${rtoStats.unmatched}, rtoFinalQty=${rtoStats.finalQty}, rtoFinalTaxable=${rtoStats.finalTaxable}, rtoFinalIgst=${rtoStats.finalIgst}, rtoFinalCgst=${rtoStats.finalCgst}, rtoFinalSgst=${rtoStats.finalSgst}, rtoFinalInvoice=${rtoStats.finalInvoice}, rtRows=${rtStats.totalRows}, rtMatchedCurrent=${rtStats.matchedCurrent}, rtMatchedPrevious=${rtStats.matchedPrevious}, rtUnmatched=${rtStats.unmatched}, rtFinalQty=${rtStats.finalQty}, rtFinalTaxable=${rtStats.finalTaxable}, rtFinalIgst=${rtStats.finalIgst}, rtFinalCgst=${rtStats.finalCgst}, rtFinalSgst=${rtStats.finalSgst}, rtFinalInvoice=${rtStats.finalInvoice}, matchedReturnTotal=${rtoStats.matchedCurrent + rtoStats.matchedPrevious + rtStats.matchedCurrent + rtStats.matchedPrevious}, finalRows=${rows.length}`,
    );

    const joinIssues =
      missingOrderIdInGstr || missingInSales
        ? {
            missingOrderIdInGstr,
            missingInSales,
          }
        : undefined;

    return {
      rows,
      errors,
      joinIssues,
      historicalSaleIdsToMarkReturned,
    };
  }
}
