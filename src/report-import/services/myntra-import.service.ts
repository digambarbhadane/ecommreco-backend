import { Injectable, Optional } from '@nestjs/common';
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

@Injectable()
export class MyntraImportService {
  constructor(
    private readonly parser: FileParserService,
    private readonly mapping: MappingService,
    @Optional()
    @InjectModel(ImportRow.name)
    private readonly rowModel?: Model<ImportRowDocument>,
  ) {}

  parseFiles(files: {
    gstrReportPackedFile?: { buffer: Buffer; originalname: string };
    mDirectOrdersReportFile?: { buffer: Buffer; originalname: string };
    salesRevenuePackedB2cFile?: { buffer: Buffer; originalname: string };
    gstrReportRtoFile?: { buffer: Buffer; originalname: string };
    gstrReportRtFile?: { buffer: Buffer; originalname: string };
    mDirectReturnsReportFile?: { buffer: Buffer; originalname: string };
  }) {
    const empty: ParsedMyntraFile = { rows: [], headers: [] };
    const parse = (
      file: { buffer: Buffer; originalname: string } | undefined,
      kind:
        | 'gstrReportPacked'
        | 'mDirectOrders'
        | 'salesRevenueB2c'
        | 'gstrReportRto'
        | 'gstrReportRt'
        | 'mDirectReturns',
    ) => (file ? this.parser.parseMyntraWorkbook(file.buffer, kind) : empty);

    return {
      gstrReportPacked: parse(files.gstrReportPackedFile, 'gstrReportPacked'),
      mDirectOrders: parse(files.mDirectOrdersReportFile, 'mDirectOrders'),
      salesRevenueB2c: parse(
        files.salesRevenuePackedB2cFile,
        'salesRevenueB2c',
      ),
      gstrReportRto: parse(files.gstrReportRtoFile, 'gstrReportRto'),
      gstrReportRt: parse(files.gstrReportRtFile, 'gstrReportRt'),
      mDirectReturns: parse(files.mDirectReturnsReportFile, 'mDirectReturns'),
    };
  }

  private normalizeOrderKey(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Number.isInteger(raw) ? String(raw) : String(raw).replace(/\.0+$/, '');
    }
    let value = String(raw).trim();
    if (!value) return '';
    value = value.replace(/^['"]+|['"]+$/g, '').replace(/\s+/g, '');
    value = value.replace(/\.0+$/, '');
    return value.toUpperCase();
  }

  private collectOrderKeys(row: ParsedSheetRow, aliases: readonly string[]): string[] {
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

  private mergeDefined<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
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

  private negateUnmatchedReturnAmounts(row: NormalizedImportRow): void {
    const negate = (value?: number) =>
      value === undefined || value === null ? undefined : -Math.abs(value);
    if (row.quantity !== undefined && row.quantity !== null && row.quantity > 0) {
      row.quantity = -Math.abs(row.quantity);
    }
    if (row.invoiceAmount !== undefined && row.invoiceAmount !== null && row.invoiceAmount > 0) {
      row.invoiceAmount = negate(row.invoiceAmount);
    }
    if (row.taxableAmount !== undefined && row.taxableAmount !== null && row.taxableAmount > 0) {
      row.taxableAmount = negate(row.taxableAmount);
    }
    if (row.igstAmount !== undefined && row.igstAmount !== null && row.igstAmount > 0) {
      row.igstAmount = negate(row.igstAmount);
    }
    if (row.cgstAmount !== undefined && row.cgstAmount !== null && row.cgstAmount > 0) {
      row.cgstAmount = negate(row.cgstAmount);
    }
    if (row.sgstAmount !== undefined && row.sgstAmount !== null && row.sgstAmount > 0) {
      row.sgstAmount = negate(row.sgstAmount);
    }
    if (row.gstAmount !== undefined && row.gstAmount !== null && row.gstAmount > 0) {
      row.gstAmount = negate(row.gstAmount);
    }
  }

  private mergeMdirectReturnFields(
    target: NormalizedImportRow,
    mDirectReturnsRow: ParsedSheetRow | undefined,
    returnsHeaderMap: ReturnType<MappingService['buildMyntraMdirectReturnsHeaderMap']>,
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
      const orderKey = this.normalizeOrderKey(doc.orderID);
      if (!orderKey || map.has(orderKey)) continue;
      map.set(orderKey, {
        _id: String(doc._id),
        reportMonth: doc.reportMonth,
        ...this.toSaleSnapshot(doc as NormalizedImportRow),
      });
    }
    return map;
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
    let matchedCurrent: CurrentSaleEntry | undefined;
    for (const key of orderKeys) {
      const hit = currentSales.get(key);
      if (hit) {
        matchedCurrent = hit;
        break;
      }
    }

    if (matchedCurrent) {
      const sale = matchedCurrent.snapshot;
      Object.assign(returnRow, this.negateSaleAmounts(sale));
      returnRow.myntraReturnMatchStatus = 'MATCHED_CURRENT_MONTH';
      returnRow.linkedSaleRowId = undefined;
      returnRow.saleReferenceMonth = undefined;
      rows[matchedCurrent.rowIndex].myntraIsReturned = true;
      return;
    }

    let matchedHistorical: HistoricalSaleEntry | undefined;
    for (const key of orderKeys) {
      const hit = priorMonthSales.get(key);
      if (hit) {
        matchedHistorical = hit;
        break;
      }
    }

    if (matchedHistorical) {
      Object.assign(returnRow, this.negateSaleAmounts(matchedHistorical));
      returnRow.myntraReturnMatchStatus = 'MATCHED_PREVIOUS_MONTH';
      returnRow.linkedSaleRowId = matchedHistorical._id;
      returnRow.saleReferenceMonth = matchedHistorical.reportMonth;
      if (!historicalSaleIdsToMarkReturned.includes(matchedHistorical._id)) {
        historicalSaleIdsToMarkReturned.push(matchedHistorical._id);
      }
      return;
    }

    let matchedSameMonthDb: HistoricalSaleEntry | undefined;
    for (const key of orderKeys) {
      const hit = sameMonthDbSales.get(key);
      if (hit) {
        matchedSameMonthDb = hit;
        break;
      }
    }

    if (matchedSameMonthDb) {
      Object.assign(returnRow, this.negateSaleAmounts(matchedSameMonthDb));
      returnRow.myntraReturnMatchStatus = 'MATCHED_PREVIOUS_MONTH';
      returnRow.linkedSaleRowId = matchedSameMonthDb._id;
      returnRow.saleReferenceMonth = matchedSameMonthDb.reportMonth;
      if (!historicalSaleIdsToMarkReturned.includes(matchedSameMonthDb._id)) {
        historicalSaleIdsToMarkReturned.push(matchedSameMonthDb._id);
      }
      return;
    }

    for (const key of orderKeys) {
      const gstrRow = gstrByOrder.get(key);
      if (!gstrRow) continue;
      const gstrMapped = this.mapping.mapMyntraGstrRow(gstrRow);
      Object.assign(returnRow, this.negateSaleAmounts(this.toSaleSnapshot(gstrMapped)));
      break;
    }

    returnRow.myntraReturnMatchStatus = 'UNMATCHED_RETURN';
    returnRow.linkedSaleRowId = undefined;
    returnRow.saleReferenceMonth = undefined;
    this.negateUnmatchedReturnAmounts(returnRow);
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

        const orderKeys = this.collectOrderKeys(gstrRow, MYNTRA_GSTR_ORDER_ID_ALIASES);
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
          MYNTRA_GSTR_ORDER_ID_ALIASES,
        );
        if (salesRow) {
          const fromSales = this.mapping.mapRowFast(
            salesRow,
            'sales',
            salesHeaderMap,
          );
          Object.assign(mapped, this.mergeDefined(mapped, fromSales));
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
          Object.assign(mapped, this.mergeDefined(mapped, fromMdirect));
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
        for (const key of orderKeys) {
          currentSales.set(key, {
            rowIndex,
            snapshot: this.toSaleSnapshot(mapped),
          });
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

    const rtoRows = parsed.gstrReportRto.rows;
    for (let i = 0; i < rtoRows.length; i += 1) {
      const rtoRow = rtoRows[i];
      try {
        const mapped = this.mapping.mapRowFast(rtoRow, 'sales', rtoHeaderMap);
        mapped.documentType = 'RTO Return';
        mapped.typeOfReturn = 'RTO Return';
        mapped.myntraTransactionType = 'RETURN';
        mapped.invoiceDate = undefined;

        const orderKeys = this.resolveOrderKeys(
          rtoRow,
          MYNTRA_GSTR_RTO_ORDER_ID_ALIASES,
          mapped.orderID,
        );
        if (!mapped.orderID && orderKeys[0]) mapped.orderID = orderKeys[0];

        const dedupeKey = orderKeys.join('|') || `rto:${rtoRow.__rowNumber}`;
        if (processedRtoKeys.has(dedupeKey)) continue;
        processedRtoKeys.add(dedupeKey);

        const mDirectReturnsRow = this.lookupRowByOrderKeys(
          mDirectReturnsByOrder,
          rtoRow,
          MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES,
        );
        this.mergeMdirectReturnFields(mapped, mDirectReturnsRow, returnsHeaderMap);
        mapped.documentType = 'RTO Return';
        mapped.typeOfReturn = 'RTO Return';
        mapped.myntraTransactionType = 'RETURN';

        this.applyReturnMatch(
          mapped,
          orderKeys,
          currentSales,
          gstrByOrder,
          priorMonthSales,
          sameMonthDbSales,
          rows,
          historicalSaleIdsToMarkReturned,
        );

        rows.push({
          ...mapped,
          __sheetName: rtoRow.__sheetName,
          __rowNumber: rtoRow.__rowNumber,
        });
      } catch {
        errors.push({
          sheetName: rtoRow.__sheetName,
          rowNumber: rtoRow.__rowNumber,
          error: 'Failed to normalize GSTR RTO return row',
        });
      }
      if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    }

    const rtRows = parsed.gstrReportRt.rows;
    for (let i = 0; i < rtRows.length; i += 1) {
      const rtRow = rtRows[i];
      try {
        const mapped = this.mapping.mapRowFast(rtRow, 'sales', rtHeaderMap);
        mapped.documentType = 'Customer Return';
        mapped.typeOfReturn = 'Customer Return';
        mapped.myntraTransactionType = 'RETURN';
        mapped.invoiceDate = undefined;

        const orderKeys = this.resolveOrderKeys(
          rtRow,
          MYNTRA_GSTR_RT_ORDER_ID_ALIASES,
          mapped.orderID,
        );
        if (!mapped.orderID && orderKeys[0]) mapped.orderID = orderKeys[0];

        const dedupeKey = orderKeys.join('|') || `rt:${rtRow.__rowNumber}`;
        if (processedRtKeys.has(dedupeKey)) continue;
        processedRtKeys.add(dedupeKey);

        const mDirectReturnsRow = this.lookupRowByOrderKeys(
          mDirectReturnsByOrder,
          rtRow,
          MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES,
        );
        this.mergeMdirectReturnFields(mapped, mDirectReturnsRow, returnsHeaderMap);
        mapped.documentType = 'Customer Return';
        mapped.typeOfReturn = 'Customer Return';
        mapped.myntraTransactionType = 'RETURN';

        this.applyReturnMatch(
          mapped,
          orderKeys,
          currentSales,
          gstrByOrder,
          priorMonthSales,
          sameMonthDbSales,
          rows,
          historicalSaleIdsToMarkReturned,
        );

        rows.push({
          ...mapped,
          __sheetName: rtRow.__sheetName,
          __rowNumber: rtRow.__rowNumber,
        });
      } catch {
        errors.push({
          sheetName: rtRow.__sheetName,
          rowNumber: rtRow.__rowNumber,
          error: 'Failed to normalize GSTR RT return row',
        });
      }
      if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    }

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
