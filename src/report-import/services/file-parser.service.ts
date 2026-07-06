import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { amazonImportMapping } from '../config/importMappings/amazon.mapping';
import { flipkartImportMapping } from '../config/importMappings/flipkart.mapping';
import {
  enrichRowsWithForwardFilledGstin,
  extractGstinsFromRows,
  headerMatchesAnyExcelColumn,
  parseGstinFromCell,
} from '../config/importMappings/gst-column.util';
import { ParsedSheetRow } from './mapping.service';
import {
  MEESHO_PAYMENT_HEADER_ALIASES,
  MEESHO_PAYMENT_HEADER_ROW_INDEX,
  MEESHO_PAYMENT_SHEET_NAMES,
} from '../config/importMappings/meesho-payment.mapping';
import {
  FLIPKART_PAYMENT_HEADER_ALIASES,
  FLIPKART_PAYMENT_SHEET_NAMES,
} from '../config/importMappings/flipkart-payment.mapping';
import {
  FLIPKART_RETURN_HEADER_ALIASES,
  FLIPKART_RETURN_SHEET_NAMES,
} from '../config/importMappings/flipkart-return.mapping';
import {
  AMAZON_RETURN_HEADER_ALIASES,
  AMAZON_RETURN_SHEET_NAMES,
} from '../config/importMappings/amazon-return.mapping';
import {
  cellLooksLikeDataValue,
  headerAliasMatchesCell,
  normalizeHeader,
  rowLooksLikeHeaderRow,
} from '../utils/header.util';
import { runParseInWorkerThread } from '../utils/parse-worker.runner';

type ParsedWorkbook = {
  salesRows: ParsedSheetRow[];
  cashbackRows: ParsedSheetRow[];
  headers: Record<'Sales Report' | 'Cash Back Report', string[]>;
  /** GSTIN values read by column index (fallback when row objects miss keys). */
  gstinValues: string[];
};

type ParsedSingleSheetWorkbook = {
  rows: ParsedSheetRow[];
  headers: string[];
};

export type MeeshoFileKind =
  | 'tcsSales'
  | 'tcsSalesReturn'
  | 'orderReport'
  | 'returnInTransit'
  | 'returnOutForDelivery'
  | 'returnDeliveryComplete';

export type MyntraFileKind =
  | 'gstrReportPacked'
  | 'mDirectOrders'
  | 'salesRevenueB2c'
  | 'gstrReportRto'
  | 'gstrReportRt'
  | 'mDirectReturns';

const MEESHO_RETURN_LIFECYCLE_HEADER_ALIASES = [
  'order number',
  'sub order num',
  'sub order no',
  'type of return',
  'return type',
  'sub type',
  'qty',
  'return qty',
  'return reason',
  'reason for return',
  'detailed return reason',
  'detailed return',
];

/** Meesho return lifecycle exports place column headers on Excel row 8 (0-based index 7). */
const MEESHO_RETURN_LIFECYCLE_HEADER_ROW_INDEX = 7;

const MEESHO_RETURN_LIFECYCLE_FILE_KINDS: MeeshoFileKind[] = [
  'returnInTransit',
  'returnOutForDelivery',
  'returnDeliveryComplete',
];

const MEESHO_FILE_HEADER_ALIASES: Record<MeeshoFileKind, string[]> = {
  tcsSales: [
    'gstin',
    'sub order num',
    'sub_order_num',
    'hsn code',
    'total invoice value',
    'total taxable sale value',
    'gst rate',
    'tax amount',
    'order date',
    'end customer state new',
  ],
  tcsSalesReturn: [
    'sub order num',
    'sub_order_num',
    'sub order no',
    'cancel return date',
    'return invoice date',
    'type of return',
    'return type',
  ],
  orderReport: [
    'sub order no',
    'sub order num',
    'sku',
    'status',
    'order status',
    'live order status',
    'reason for credit entry',
  ],
  returnInTransit: MEESHO_RETURN_LIFECYCLE_HEADER_ALIASES,
  returnOutForDelivery: MEESHO_RETURN_LIFECYCLE_HEADER_ALIASES,
  returnDeliveryComplete: MEESHO_RETURN_LIFECYCLE_HEADER_ALIASES,
};

const MYNTRA_FILE_HEADER_ALIASES: Record<MyntraFileKind, string[]> = {
  gstrReportPacked: [
    'seller_gstin',
    'seller gstin',
    'gst no',
    'order_id',
    'order id',
    'payment_method',
    'payment mode',
    'seller_type',
    'fulfilment type',
    'fulfillment type',
    'quantity',
    'seller_price',
    'invoice amount',
    'base_value',
    'taxable amount',
    'taxable value',
    'igst_rate',
    'igst rate',
    'igst_amt',
    'igst amount',
    'igst tax',
    'cgst_rate',
    'cgst rate',
    'cgst_amt',
    'cgst amount',
    'cgst tax',
    'sgst_rate',
    'sgst rate',
    'sgst_amt',
    'sgst amount',
    'sgst tax',
    'pincode',
    'customer_delivery_state',
    'customer_delivery_state_code',
    'state name',
    'order_packed_date',
    'order packed date',
    'packed date',
  ],
  mDirectOrders: [
    'order_release_id',
    'order release id',
    'order id',
    'seller_sku_code',
    'seller sku code',
    'sku id',
  ],
  salesRevenueB2c: [
    'sale_order_code',
    'sale order code',
    'order id',
    'hsn',
    'invoice_number',
    'invoice number',
    'invoice no',
    'packing_date',
    'packing date',
    'invoice date',
    'order_created_date',
    'order created date',
  ],
  gstrReportRto: [
    'tax_seller_gstin',
    'tax seller gstin',
    'seller_gstin',
    'gst no',
    'order_id',
    'order id',
    'order_cancel_date',
    'order cancel date',
    'cancel date',
  ],
  gstrReportRt: [
    'tax_seller_gstin',
    'tax seller gstin',
    'seller_gstin',
    'gst no',
    'packet_id',
    'packet id',
    'shipment_id',
    'shipment id',
    'order id',
    'fr_refunded_date',
    'fr refunded date',
    'refunded date',
  ],
  mDirectReturns: [
    'order_release_id',
    'order release id',
    'order_id',
    'order id',
    'order number',
    'store order id',
    'return_mode',
    'return mode',
    'return reason',
    'return_reason',
    'detailed return reason',
    'return type',
    'return status',
  ],
};

@Injectable()
export class FileParserService {
  parseFlipkartWorkbook(buffer: Buffer): ParsedWorkbook {
    // cellText omitted: sheet_to_json (used by parseSheetRowsFast) handles
    // formatting internally, so pre-generating cell.w for every cell is waste.
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
    });

    const salesSheet = this.findFlipkartSheet(workbook, [
      'sales report',
      'sales',
    ]);
    const cashbackSheet = this.findFlipkartSheet(workbook, [
      'cash back report',
      'cashback report',
      'cash back',
    ]);

    const sales = salesSheet.sheet;
    const cashback = cashbackSheet.sheet;

    const salesHeaderRowIndex = this.detectHeaderRowIndex(
      sales,
      'Sales Report',
    );
    const cashbackHeaderRowIndex = this.detectHeaderRowIndex(
      cashback,
      'Cash Back Report',
    );
    const gstColumns = flipkartImportMapping.gstin.excelColumns;
    // parseSheetRowsFast uses sheet_to_json (single O(n) pass) instead of
    // sheetToMatrix + per-row getCellValue, cutting parse time by ~10-20x.
    const salesRows = enrichRowsWithForwardFilledGstin(
      this.parseSheetRowsFast(
        sales,
        'Sales Report',
        salesHeaderRowIndex,
        gstColumns,
      ),
      flipkartImportMapping,
      this.extractHeaders(sales, salesHeaderRowIndex, { gstColumns }),
    );
    const cashbackRows = enrichRowsWithForwardFilledGstin(
      this.parseSheetRowsFast(
        cashback,
        'Cash Back Report',
        cashbackHeaderRowIndex,
        gstColumns,
      ),
      flipkartImportMapping,
      this.extractHeaders(cashback, cashbackHeaderRowIndex, { gstColumns }),
    );
    const salesGstins = this.extractGstinByColumnIndex(
      sales,
      salesHeaderRowIndex,
      gstColumns,
    );
    const cashbackGstins = this.extractGstinByColumnIndex(
      cashback,
      cashbackHeaderRowIndex,
      gstColumns,
    );
    const salesHeaders = this.extractHeaders(sales, salesHeaderRowIndex, {
      gstColumns,
    });
    const cashbackHeaders = this.extractHeaders(cashback, cashbackHeaderRowIndex, {
      gstColumns,
    });
    const gstinFromParsedRows = new Set([
      ...salesGstins,
      ...cashbackGstins,
      ...extractGstinsFromRows(salesRows, flipkartImportMapping, salesHeaders)
        .values,
      ...extractGstinsFromRows(
        cashbackRows,
        flipkartImportMapping,
        cashbackHeaders,
      ).values,
    ]);
    const gstinValues = [...gstinFromParsedRows];

    return {
      salesRows,
      cashbackRows,
      headers: {
        'Sales Report': salesHeaders,
        'Cash Back Report': cashbackHeaders,
      },
      gstinValues,
    };
  }

  parseFlipkartPaymentWorkbook(buffer: Buffer): ParsedSingleSheetWorkbook {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
    });
    if (!workbook.SheetNames.length) {
      throw new BadRequestException('Payment workbook does not contain any sheet');
    }

    const resolved = this.resolveFlipkartPaymentSheet(workbook);
    if (!resolved) {
      throw new BadRequestException(
        'Payment workbook must contain an "Orders" sheet or recognizable Flipkart settlement report headers',
      );
    }

    const { sheet, sheetName, headerRowIndex } = resolved;
    const rows = this.parseSheetData(sheet, sheetName, headerRowIndex, []);
    return {
      rows,
      headers: this.resolveHeaders(sheet, headerRowIndex, rows),
    };
  }

  parseFlipkartReturnWorkbook(buffer: Buffer): ParsedSingleSheetWorkbook {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
    });
    if (!workbook.SheetNames.length) {
      throw new BadRequestException('Return workbook does not contain any sheet');
    }

    const resolved = this.resolveFlipkartReturnSheet(workbook);
    if (!resolved) {
      throw new BadRequestException(
        'Return workbook must contain a return report sheet with Order ID and return detail columns',
      );
    }

    const { sheet, sheetName, headerRowIndex } = resolved;
    const rows = this.parseSheetData(sheet, sheetName, headerRowIndex, []);
    return {
      rows,
      headers: this.resolveHeaders(sheet, headerRowIndex, rows),
    };
  }

  parseAmazonReturnWorkbook(buffer: Buffer): ParsedSingleSheetWorkbook {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
    });
    if (!workbook.SheetNames.length) {
      throw new BadRequestException('Return workbook does not contain any sheet');
    }

    const resolved = this.resolveAmazonReturnSheet(workbook);
    if (!resolved) {
      throw new BadRequestException(
        'Return workbook must contain a return report sheet with Return Type column',
      );
    }

    const { sheet, sheetName, headerRowIndex } = resolved;
    const rows = this.parseSheetData(sheet, sheetName, headerRowIndex, []);
    return {
      rows,
      headers: this.resolveHeaders(sheet, headerRowIndex, rows),
    };
  }

  parseMeeshoWorkbook(
    buffer: Buffer,
    fileKind: MeeshoFileKind,
  ): ParsedSingleSheetWorkbook {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
    });
    if (!workbook.SheetNames.length) {
      throw new BadRequestException('Workbook does not contain any sheet');
    }
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const headerRowIndex = this.detectMeeshoHeaderRowIndex(sheet, fileKind);
    const rows = this.parseSheetData(sheet, firstSheetName, headerRowIndex, []);
    return {
      rows,
      headers: this.resolveHeaders(sheet, headerRowIndex, rows),
    };
  }

  parseMeeshoPaymentWorkbook(buffer: Buffer): ParsedSingleSheetWorkbook {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
    });
    if (!workbook.SheetNames.length) {
      throw new BadRequestException('Payment workbook does not contain any sheet');
    }

    const resolved = this.resolveMeeshoPaymentSheet(workbook);
    if (!resolved) {
      throw new BadRequestException(
        'Payment workbook must contain an "Order Payments" sheet or recognizable payment report headers',
      );
    }

    const { sheet, sheetName, headerRowIndex } = resolved;
    const rows = this.parseSheetData(sheet, sheetName, headerRowIndex, []);
    return {
      rows,
      headers: this.resolveHeaders(sheet, headerRowIndex, rows),
    };
  }

  parseMyntraWorkbook(
    buffer: Buffer,
    fileKind: MyntraFileKind,
  ): ParsedSingleSheetWorkbook {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (!workbook.SheetNames.length) {
      throw new BadRequestException('Workbook does not contain any sheet');
    }
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const headerRowIndex = this.detectMyntraHeaderRowIndex(sheet, fileKind);
    const rows = this.parseMyntraSheetData(sheet, firstSheetName, headerRowIndex);
    return {
      rows,
      headers: this.resolveHeaders(sheet, headerRowIndex, rows),
    };
  }

  private parseMyntraSheetData(
    sheet: XLSX.WorkSheet,
    sheetName: string,
    headerRowIndex: number,
  ): ParsedSheetRow[] {
    const fast = this.parseSheetRowsFast(sheet, sheetName, headerRowIndex);
    if (fast.length > 0) {
      return fast;
    }
    return this.parseSheetRows(sheet, sheetName, headerRowIndex, []);
  }

  /** Use fast JSON parse for large sheets; cell-by-cell parse for smaller files. */
  private parseSheetData(
    sheet: XLSX.WorkSheet,
    sheetName: string,
    headerRowIndex: number,
    gstColumnsForDataStart: string[] = [],
  ): ParsedSheetRow[] {
    const range = this.getSheetRange(sheet);
    const estimatedRows = Math.max(0, range.e.r - range.s.r);
    if (estimatedRows > 2500) {
      const fast = this.parseSheetRowsFast(sheet, sheetName, headerRowIndex);
      if (fast.length > 0) {
        return fast;
      }
    }
    return this.parseSheetRows(
      sheet,
      sheetName,
      headerRowIndex,
      gstColumnsForDataStart,
    );
  }

  private resolveHeaders(
    sheet: XLSX.WorkSheet,
    headerRowIndex: number,
    rows: ParsedSheetRow[],
  ): string[] {
    const fromSheet = this.extractHeaders(sheet, headerRowIndex);
    if (fromSheet.length) return fromSheet;
    if (!rows.length) return [];
    return Object.keys(rows[0]).filter(
      (key) => !key.startsWith('__') && String(key).trim().length > 0,
    );
  }

  /** Generic single-sheet parse (fallback). */
  parseSpreadsheetWorkbook(buffer: Buffer): ParsedSingleSheetWorkbook {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellText: true,
    });
    if (!workbook.SheetNames.length) {
      throw new BadRequestException('Workbook does not contain any sheet');
    }
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const headerRowIndex = this.detectAmazonHeaderRowIndex(sheet);
    const rows = this.parseSheetRows(sheet, firstSheetName, headerRowIndex, []);
    return {
      rows,
      headers: this.extractHeaders(sheet, headerRowIndex),
    };
  }

  parseAmazonWorkbook(buffer: Buffer): ParsedSingleSheetWorkbook {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    if (!workbook.SheetNames.length) {
      throw new BadRequestException('Workbook does not contain any sheet');
    }
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const headerRowIndex = this.detectAmazonHeaderRowIndex(sheet);
    const rows = this.parseSheetRowsFast(sheet, firstSheetName, headerRowIndex);
    return {
      rows,
      headers: this.extractHeaders(sheet, headerRowIndex),
    };
  }

  private getSheetRange(sheet: XLSX.WorkSheet): XLSX.Range {
    // Fast path: every worksheet written by XLSX.read has !ref set.
    // Decoding it is O(1); the old key-scan was O(total_cells) and was called
    // once per row in parseSheetRows, causing 20B+ iterations on large files.
    if (sheet['!ref']) {
      return XLSX.utils.decode_range(sheet['!ref']);
    }
    // Fallback for worksheets built in memory without !ref (extremely rare).
    let minR = 0, minC = 0, maxR = 0, maxC = 0;
    let found = false;
    for (const key of Object.keys(sheet)) {
      if (key[0] === '!') continue;
      const { r, c } = XLSX.utils.decode_cell(key);
      if (!found) { minR = r; minC = c; maxR = r; maxC = c; found = true; }
      else { minR = Math.min(minR, r); minC = Math.min(minC, c); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); }
    }
    return found ? { s: { r: minR, c: minC }, e: { r: maxR, c: maxC } } : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  }

  private toAbsoluteRow(sheet: XLSX.WorkSheet, matrixRowIndex: number): number {
    return this.getSheetRange(sheet).s.r + matrixRowIndex;
  }

  private getHeaderColumns(
    sheet: XLSX.WorkSheet,
    absoluteHeaderRow: number,
    options?: { subHeaderRow?: number; gstColumns?: string[] },
  ): Array<{ label: string; col: number }> {
    const range = this.getSheetRange(sheet);
    const columns: Array<{ label: string; col: number }> = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      let label = String(
        this.getCellValue(sheet, absoluteHeaderRow, col) ?? '',
      ).trim();
      const subLabel =
        options?.subHeaderRow != null
          ? String(
              this.getCellValue(sheet, options.subHeaderRow, col) ?? '',
            ).trim()
          : '';
      if (
        subLabel &&
        options?.gstColumns?.length &&
        headerMatchesAnyExcelColumn(subLabel, options.gstColumns)
      ) {
        label = subLabel;
      } else if (!label && subLabel) {
        label = subLabel;
      }
      if (label) columns.push({ label, col });
    }
    return columns;
  }

  private parseSheetRows(
    sheet: XLSX.WorkSheet,
    sheetName: string,
    headerRowIndex: number,
    gstColumnsForDataStart: string[] = [],
  ): ParsedSheetRow[] {
    const matrix = this.sheetToMatrix(sheet);

    if (!matrix.length || headerRowIndex >= matrix.length) {
      return [];
    }

    const absoluteHeaderRow = this.toAbsoluteRow(sheet, headerRowIndex);
    const headerColumns = this.getHeaderColumns(sheet, absoluteHeaderRow);
    if (!headerColumns.length) {
      return [];
    }

    const dataStartRow =
      gstColumnsForDataStart.length > 0
        ? this.resolveDataStartRow(matrix, headerRowIndex, gstColumnsForDataStart)
        : headerRowIndex + 1;

    const parsed: ParsedSheetRow[] = [];
    for (
      let matrixRowIndex = dataStartRow;
      matrixRowIndex < matrix.length;
      matrixRowIndex += 1
    ) {
      const absoluteRow = this.toAbsoluteRow(sheet, matrixRowIndex);
      const cells = matrix[matrixRowIndex];
      if (!Array.isArray(cells)) continue;

      const hasData =
        headerColumns.some(({ col }) => {
          const value = this.getCellValue(sheet, absoluteRow, col);
          return (
            value !== null &&
            value !== undefined &&
            String(value).trim().length > 0
          );
        }) ||
        cells.some(
          (cell) =>
            cell !== null &&
            cell !== undefined &&
            String(cell).trim().length > 0,
        );
      if (!hasData) continue;

      const row: ParsedSheetRow = {
        __sheetName: sheetName,
        __rowNumber: absoluteRow + 1,
      };

      headerColumns.forEach(({ label, col }) => {
        row[label] = this.getCellValue(sheet, absoluteRow, col) ?? null;
      });

      parsed.push(row);
    }

    return parsed;
  }

  private findFlipkartSheet(
    workbook: XLSX.WorkBook,
    aliases: string[],
  ): { name: string; sheet: XLSX.WorkSheet } {
    const normalizedAliases = aliases.map((item) => normalizeHeader(item));
    for (const name of workbook.SheetNames) {
      const norm = normalizeHeader(name);
      const hit = normalizedAliases.some(
        (alias) => norm === alias || norm.includes(alias) || alias.includes(norm),
      );
      if (hit) {
        return { name, sheet: workbook.Sheets[name] };
      }
    }
    throw new BadRequestException(
      `Missing required sheet. Expected one of: ${aliases.join(', ')}. Found: ${workbook.SheetNames.join(', ')}`,
    );
  }

  private getCellObject(
    sheet: XLSX.WorkSheet,
    row: number,
    col: number,
  ): XLSX.CellObject | null | undefined {
    const dense = (sheet as XLSX.WorkSheet & { '!data'?: (XLSX.CellObject | null)[][] })[
      '!data'
    ];
    if (dense) {
      return dense[row]?.[col] ?? null;
    }
    return sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  }

  private getCellValue(
    sheet: XLSX.WorkSheet,
    row: number,
    col: number,
  ): unknown {
    const cell = this.getCellObject(sheet, row, col);
    if (!cell) return null;
    if (cell.t === 'e') {
      if (cell.w != null && String(cell.w).trim() !== '') {
        return cell.w;
      }
      return '#N/A';
    }
    if (cell.w != null && String(cell.w).trim() !== '') {
      return cell.w;
    }
    if (cell.v != null) {
      if (typeof cell.v === 'number') {
        const asText = String(cell.v);
        if (/E[+-]?/i.test(asText)) return null;
        return asText;
      }
      return cell.v;
    }
    return null;
  }

  /**
   * Read only the first N rows for header detection (avoids building a full sheet matrix).
   */
  private sheetPreviewMatrix(
    sheet: XLSX.WorkSheet,
    maxRows = 80,
  ): unknown[][] {
    const range = this.getSheetRange(sheet);
    const startRow = Math.max(0, range.s.r);
    const endRow = Math.min(
      Math.max(startRow, range.e.r),
      startRow + maxRows - 1,
    );
    const startCol = Math.max(0, range.s.c);
    const endCol = Math.max(startCol, range.e.c);
    if (endRow < startRow) {
      return [];
    }
    const clip: XLSX.Range = {
      s: { r: startRow, c: startCol },
      e: { r: endRow, c: endCol },
    };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
      blankrows: true,
      range: clip,
    });
    return rows.filter((row) => Array.isArray(row));
  }

  /**
   * Fast row parse for large sheets (20k+ rows) using sheet_to_json instead of per-cell reads.
   */
  private parseSheetRowsFast(
    sheet: XLSX.WorkSheet,
    sheetName: string,
    headerRowIndex: number,
    gstColumnsForDataStart: string[] = [],
  ): ParsedSheetRow[] {
    // blankrows: true keeps matrix indices in sync with the headerRowIndex that
    // detectHeaderRowIndex computed (which also counts blank rows). Without this,
    // files that have blank rows before the header would start data extraction at
    // the wrong offset.
    const matrixRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
      blankrows: true,
    });
    const dataStartMatrixIndex =
      gstColumnsForDataStart.length > 0
        ? this.resolveDataStartRow(
            matrixRows,
            headerRowIndex,
            gstColumnsForDataStart,
          )
        : headerRowIndex + 1;
    const absoluteHeaderRow = this.toAbsoluteRow(sheet, headerRowIndex);
    const subHeaderRow =
      dataStartMatrixIndex > headerRowIndex + 1
        ? this.toAbsoluteRow(sheet, headerRowIndex + 1)
        : undefined;
    const headerColumns = this.getHeaderColumns(sheet, absoluteHeaderRow, {
      subHeaderRow,
      gstColumns: gstColumnsForDataStart,
    });
    if (!headerColumns.length) {
      return [];
    }
    const parsed: ParsedSheetRow[] = [];

    for (
      let matrixRowIndex = dataStartMatrixIndex;
      matrixRowIndex < matrixRows.length;
      matrixRowIndex += 1
    ) {
      const absoluteRow = this.toAbsoluteRow(sheet, matrixRowIndex);

      const hasData = headerColumns.some(({ col }) => {
        const value = this.getCellValue(sheet, absoluteRow, col);
        return (
          value !== null &&
          value !== undefined &&
          String(value).trim().length > 0
        );
      });
      if (!hasData) continue;

      const row: ParsedSheetRow = {
        __sheetName: sheetName,
        __rowNumber: absoluteHeaderRow + (matrixRowIndex - headerRowIndex) + 1,
      };
      headerColumns.forEach(({ label, col }) => {
        row[label] = this.getCellValue(sheet, absoluteRow, col) ?? null;
      });
      parsed.push(row);
    }

    return parsed;
  }

  /** Build a dense matrix from all populated cells (not limited by a short !ref). */
  private sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
    const range = this.getSheetRange(sheet);
    const matrix: unknown[][] = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const row: unknown[] = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        row.push(this.getCellValue(sheet, r, c));
      }
      matrix.push(row);
    }
    return matrix;
  }

  /** Read GSTIN by sheet column index (not sparse matrix index). */
  private extractGstinByColumnIndex(
    sheet: XLSX.WorkSheet,
    headerRowIndex: number,
    excelColumns: string[],
  ): string[] {
    const range = this.getSheetRange(sheet);
    if (range.e.r < range.s.r) return [];

    // Only preview the first few rows to determine where data rows start.
    const previewForStartRow = this.sheetPreviewMatrix(sheet, headerRowIndex + 4);
    const absoluteHeaderRow = this.toAbsoluteRow(sheet, headerRowIndex);
    const colIndex = this.resolveGstColumnIndexFromSheet(
      sheet,
      absoluteHeaderRow,
      excelColumns,
    );
    const values = new Set<string>();
    const dataStartMatrixRow = this.resolveDataStartRow(
      previewForStartRow,
      headerRowIndex,
      excelColumns,
    );
    const dataStartAbsolute = this.toAbsoluteRow(sheet, dataStartMatrixRow);

    if (colIndex >= 0) {
      let lastGstin = '';
      for (
        let row = dataStartAbsolute - 1;
        row >= absoluteHeaderRow;
        row -= 1
      ) {
        const seed = parseGstinFromCell(this.getCellValue(sheet, row, colIndex));
        if (seed) {
          lastGstin = seed;
          values.add(seed);
          break;
        }
      }
      for (let row = dataStartAbsolute; row <= range.e.r; row += 1) {
        const raw = this.getCellValue(sheet, row, colIndex);
        let gstin = parseGstinFromCell(raw);
        if (!gstin && lastGstin) {
          gstin = lastGstin;
        }
        if (gstin) {
          values.add(gstin);
          lastGstin = gstin;
        }
      }
    }

    if (!values.size) {
      this.scanWorksheetForGstins(sheet, range.s.r).forEach((item) =>
        values.add(item),
      );
    }

    return [...values];
  }

  private scanWorksheetForGstins(
    sheet: XLSX.WorkSheet,
    startAbsoluteRow: number,
  ): string[] {
    const values = new Set<string>();
    const range = this.getSheetRange(sheet);
    const rowStart = Math.max(range.s.r, startAbsoluteRow);
    const rowCap = Math.min(range.e.r, rowStart + 2000);
    for (let row = rowStart; row <= rowCap; row += 1) {
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const gstin = parseGstinFromCell(this.getCellValue(sheet, row, col));
        if (gstin) values.add(gstin);
      }
      if (values.size >= 20) break;
    }
    return [...values];
  }

  /** Resolve GST column using actual sheet coordinates (avoids sparse-array index drift). */
  private resolveGstColumnIndexFromSheet(
    sheet: XLSX.WorkSheet,
    absoluteHeaderRow: number,
    excelColumns: string[],
  ): number {
    const range = this.getSheetRange(sheet);
    const rowsToScan = [
      absoluteHeaderRow,
      absoluteHeaderRow - 1,
      absoluteHeaderRow + 1,
      absoluteHeaderRow + 2,
    ].filter((row) => row >= range.s.r && row <= range.e.r);

    let fallbackCol = -1;

    for (const rowIndex of rowsToScan) {
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const label = String(this.getCellValue(sheet, rowIndex, col) ?? '').trim();
        if (!label) continue;
        if (!headerMatchesAnyExcelColumn(label, excelColumns)) continue;

        const norm = normalizeHeader(label);
        if (norm === 'seller gstin' || norm.includes('seller gstin')) {
          return col;
        }
        if (fallbackCol < 0) {
          fallbackCol = col;
        }
      }
    }
    return fallbackCol;
  }

  private resolveDataStartRow(
    matrix: unknown[][],
    headerRowIndex: number,
    excelColumns: string[],
  ): number {
    let lastHeaderRow = headerRowIndex;
    for (
      let rowIndex = headerRowIndex + 1;
      rowIndex < Math.min(matrix.length, headerRowIndex + 3);
      rowIndex += 1
    ) {
      const row = matrix[rowIndex];
      if (!Array.isArray(row)) break;
      const nonEmpty = row.filter(
        (cell) => cell !== null && cell !== undefined && String(cell).trim(),
      );
      const headerLikeCount = nonEmpty.filter((cell) => {
        const label = String(cell ?? '').trim();
        const norm = normalizeHeader(label);
        return (
          headerMatchesAnyExcelColumn(label, excelColumns) ||
          norm === 'order id' ||
          norm === 'buyer invoice id' ||
          norm === 'buyer invoice date' ||
          norm === 'event type' ||
          norm === 'document type' ||
          norm === 'document sub type' ||
          norm === 'taxable value' ||
          norm === 'sku'
        );
      }).length;
      const looksLikeHeader =
        nonEmpty.length > 0 && headerLikeCount >= Math.min(3, nonEmpty.length);
      const hasGstinValue = row.some((cell) => !!parseGstinFromCell(cell));
      if (looksLikeHeader && !hasGstinValue) {
        lastHeaderRow = rowIndex;
        continue;
      }
      break;
    }
    return lastHeaderRow + 1;
  }

  private extractHeaders(
    sheet: XLSX.WorkSheet,
    headerRowIndex: number,
    options?: { gstColumns?: string[] },
  ): string[] {
    const absoluteHeaderRow = this.toAbsoluteRow(sheet, headerRowIndex);
    let subHeaderRow: number | undefined;
    if (options?.gstColumns?.length) {
      const preview = this.sheetPreviewMatrix(sheet, headerRowIndex + 4);
      const dataStart = this.resolveDataStartRow(
        preview,
        headerRowIndex,
        options.gstColumns,
      );
      if (dataStart > headerRowIndex + 1) {
        subHeaderRow = this.toAbsoluteRow(sheet, headerRowIndex + 1);
      }
    }
    return this.getHeaderColumns(sheet, absoluteHeaderRow, {
      subHeaderRow,
      gstColumns: options?.gstColumns,
    }).map((item) => item.label);
  }

  private detectHeaderRowIndex(
    sheet: XLSX.WorkSheet,
    sheetName: 'Sales Report' | 'Cash Back Report',
  ) {
    const matrix = this.sheetPreviewMatrix(sheet, 80);
    const aliases =
      sheetName === 'Sales Report'
        ? [
            'seller gstin',
            'gst no',
            'gstin',
            'order id',
            'buyer invoice id',
            'buyer invoice date',
            'event type',
            'taxable value',
          ]
        : [
            'seller gstin',
            'gst no',
            'gstin',
            'order id',
            'credit note id',
            'debit note id',
            'document sub type',
            'taxable value',
          ];

    let bestIndex = -1;
    let bestScore = -1;
    const scanLimit = Math.min(matrix.length, 80);

    const scoreRow = (normalizedCells: string[], requireGstHeader: boolean) => {
      const hasGstHeader = normalizedCells.some(
        (cell) =>
          cell === 'seller gstin' ||
          cell.includes('seller gstin') ||
          cell.includes('gst no') ||
          cell === 'gstin',
      );
      if (requireGstHeader && !hasGstHeader) return -1;

      const aliasScore = aliases.reduce(
        (acc, alias) =>
          acc +
          (normalizedCells.some(
            (cell) => cell.includes(alias) || alias.includes(cell),
          )
            ? 1
            : 0),
        0,
      );
      return aliasScore + (hasGstHeader ? 8 : 0);
    };

    for (let i = 0; i < scanLimit; i += 1) {
      const row = matrix[i];
      if (!Array.isArray(row)) continue;
      const normalizedCells = row
        .map((item) =>
          item === null || item === undefined
            ? ''
            : normalizeHeader(String(item)),
        )
        .filter((item) => item.length > 0);
      if (!normalizedCells.length) continue;

      const score = scoreRow(normalizedCells, true);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) {
      for (let i = 0; i < scanLimit; i += 1) {
        const row = matrix[i];
        if (!Array.isArray(row)) continue;
        const normalizedCells = row
          .map((item) =>
            item === null || item === undefined
              ? ''
              : normalizeHeader(String(item)),
          )
          .filter((item) => item.length > 0);
        if (!normalizedCells.length) continue;
        const score = scoreRow(normalizedCells, false);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
    }

    if (bestIndex < 0) {
      throw new BadRequestException(
        `Could not find header row with Seller GSTIN in "${sheetName}". Check that the sheet contains column headers.`,
      );
    }

    return bestIndex;
  }

  private isFlipkartPaymentSheetName(sheetName: string): boolean {
    const normalized = normalizeHeader(sheetName);
    if (
      FLIPKART_PAYMENT_SHEET_NAMES.some(
        (target) => normalizeHeader(target) === normalized,
      )
    ) {
      return true;
    }
    return normalized.includes('order') || normalized.includes('settlement');
  }

  private flipkartPaymentRowHasAnchor(normalizedCells: string[]): boolean {
    const headerLike = normalizedCells.filter((c) => !cellLooksLikeDataValue(c));
    if (!headerLike.length) return false;

    const hasOrderId = headerLike.some(
      (cell) => cell === 'order id' || cell.includes('order id'),
    );
    const hasSettlementField = headerLike.some(
      (cell) =>
        cell.includes('settlement value') ||
        cell.includes('settlement amount') ||
        cell.includes('net settlement') ||
        cell.includes('neft id') ||
        cell.includes('payment date'),
    );
    return hasOrderId && hasSettlementField;
  }

  private scoreFlipkartPaymentHeaderRow(normalizedCells: string[]): number {
    return this.scoreMeeshoHeaderRow(
      normalizedCells,
      [...FLIPKART_PAYMENT_HEADER_ALIASES],
    );
  }

  private detectFlipkartPaymentHeaderRowIndex(sheet: XLSX.WorkSheet): number {
    const matrix = this.sheetPreviewMatrix(sheet, 200);
    let bestIndex = -1;
    let bestScore = -1;
    const scanLimit = Math.min(matrix.length, 200);
    const minRequiredScore = 2;

    for (let i = 0; i < scanLimit; i += 1) {
      const row = matrix[i];
      if (!Array.isArray(row)) continue;
      const normalizedCells = this.normalizePreviewRow(row);
      if (!normalizedCells.length || !rowLooksLikeHeaderRow(normalizedCells)) {
        continue;
      }
      if (!this.flipkartPaymentRowHasAnchor(normalizedCells)) continue;
      const score = this.scoreFlipkartPaymentHeaderRow(normalizedCells);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0 || bestScore < minRequiredScore) {
      return -1;
    }
    return bestIndex;
  }

  private resolveFlipkartPaymentSheet(workbook: XLSX.WorkBook): {
    sheet: XLSX.WorkSheet;
    sheetName: string;
    headerRowIndex: number;
  } | null {
    const namedCandidates = workbook.SheetNames.filter((name) =>
      this.isFlipkartPaymentSheetName(name),
    );
    const scanOrder = [
      ...namedCandidates,
      ...workbook.SheetNames.filter((name) => !namedCandidates.includes(name)),
    ];

    let best:
      | { sheetName: string; sheet: XLSX.WorkSheet; headerRowIndex: number; score: number }
      | null = null;

    for (const sheetName of scanOrder) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const headerRowIndex = this.detectFlipkartPaymentHeaderRowIndex(sheet);
      if (headerRowIndex < 0) continue;

      const matrix = this.sheetPreviewMatrix(sheet, headerRowIndex + 1);
      const row = matrix[headerRowIndex];
      const normalizedCells = Array.isArray(row)
        ? this.normalizePreviewRow(row)
        : [];
      const score =
        (this.isFlipkartPaymentSheetName(sheetName) ? 10 : 0) +
        this.scoreFlipkartPaymentHeaderRow(normalizedCells);

      if (!best || score > best.score) {
        best = { sheetName, sheet, headerRowIndex, score };
      }
    }

    if (!best) return null;
    return {
      sheetName: best.sheetName,
      sheet: best.sheet,
      headerRowIndex: best.headerRowIndex,
    };
  }

  private isFlipkartReturnSheetName(sheetName: string): boolean {
    const normalized = normalizeHeader(sheetName);
    if (
      FLIPKART_RETURN_SHEET_NAMES.some(
        (target) => normalizeHeader(target) === normalized,
      )
    ) {
      return true;
    }
    return normalized.includes('return');
  }

  private flipkartReturnRowHasAnchor(normalizedCells: string[]): boolean {
    const headerLike = normalizedCells.filter((c) => !cellLooksLikeDataValue(c));
    if (!headerLike.length) return false;

    const hasOrderId = headerLike.some(
      (cell) => cell === 'order id' || cell.includes('order id'),
    );
    const hasReturnField = headerLike.some(
      (cell) =>
        cell.includes('return type') ||
        cell.includes('type of return') ||
        cell.includes('return reason') ||
        cell.includes('return sub'),
    );
    return hasOrderId && hasReturnField;
  }

  private scoreFlipkartReturnHeaderRow(normalizedCells: string[]): number {
    return this.scoreMeeshoHeaderRow(
      normalizedCells,
      [...FLIPKART_RETURN_HEADER_ALIASES],
    );
  }

  private detectFlipkartReturnHeaderRowIndex(sheet: XLSX.WorkSheet): number {
    const matrix = this.sheetPreviewMatrix(sheet, 200);
    let bestIndex = -1;
    let bestScore = -1;
    const scanLimit = Math.min(matrix.length, 200);
    const minRequiredScore = 2;

    for (let i = 0; i < scanLimit; i += 1) {
      const row = matrix[i];
      if (!Array.isArray(row)) continue;
      const normalizedCells = this.normalizePreviewRow(row);
      if (!normalizedCells.length || !rowLooksLikeHeaderRow(normalizedCells)) {
        continue;
      }
      if (!this.flipkartReturnRowHasAnchor(normalizedCells)) continue;
      const score = this.scoreFlipkartReturnHeaderRow(normalizedCells);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0 || bestScore < minRequiredScore) {
      return -1;
    }
    return bestIndex;
  }

  private resolveFlipkartReturnSheet(workbook: XLSX.WorkBook): {
    sheet: XLSX.WorkSheet;
    sheetName: string;
    headerRowIndex: number;
  } | null {
    const namedCandidates = workbook.SheetNames.filter((name) =>
      this.isFlipkartReturnSheetName(name),
    );
    const scanOrder = [
      ...namedCandidates,
      ...workbook.SheetNames.filter((name) => !namedCandidates.includes(name)),
    ];

    let best:
      | { sheetName: string; sheet: XLSX.WorkSheet; headerRowIndex: number; score: number }
      | null = null;

    for (const sheetName of scanOrder) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const headerRowIndex = this.detectFlipkartReturnHeaderRowIndex(sheet);
      if (headerRowIndex < 0) continue;

      const matrix = this.sheetPreviewMatrix(sheet, headerRowIndex + 1);
      const row = matrix[headerRowIndex];
      const normalizedCells = Array.isArray(row)
        ? this.normalizePreviewRow(row)
        : [];
      const score =
        (this.isFlipkartReturnSheetName(sheetName) ? 10 : 0) +
        this.scoreFlipkartReturnHeaderRow(normalizedCells);

      if (!best || score > best.score) {
        best = { sheetName, sheet, headerRowIndex, score };
      }
    }

    if (!best) return null;
    return {
      sheetName: best.sheetName,
      sheet: best.sheet,
      headerRowIndex: best.headerRowIndex,
    };
  }

  private isAmazonReturnSheetName(sheetName: string): boolean {
    const normalized = normalizeHeader(sheetName);
    return AMAZON_RETURN_SHEET_NAMES.some(
      (target) => normalizeHeader(target) === normalized,
    );
  }

  private scoreAmazonReturnHeaderRow(normalizedCells: string[]): number {
    return normalizedCells.reduce((score, cell) => {
      if (AMAZON_RETURN_HEADER_ALIASES.some((alias) => cell.includes(alias))) {
        return score + 1;
      }
      return score;
    }, 0);
  }

  private detectAmazonReturnHeaderRowIndex(sheet: XLSX.WorkSheet): number {
    const matrix = this.sheetPreviewMatrix(sheet, 30);
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < matrix.length; i += 1) {
      const row = matrix[i];
      if (!Array.isArray(row)) continue;
      const normalizedCells = this.normalizePreviewRow(row);
      if (!rowLooksLikeHeaderRow(normalizedCells)) continue;
      const score = this.scoreAmazonReturnHeaderRow(normalizedCells);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestScore > 0 ? bestIndex : -1;
  }

  private resolveAmazonReturnSheet(workbook: XLSX.WorkBook): {
    sheet: XLSX.WorkSheet;
    sheetName: string;
    headerRowIndex: number;
  } | null {
    const namedCandidates = workbook.SheetNames.filter((name) =>
      this.isAmazonReturnSheetName(name),
    );
    const scanOrder = [
      ...namedCandidates,
      ...workbook.SheetNames.filter((name) => !namedCandidates.includes(name)),
    ];

    let best:
      | { sheetName: string; sheet: XLSX.WorkSheet; headerRowIndex: number; score: number }
      | null = null;

    for (const sheetName of scanOrder) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const headerRowIndex = this.detectAmazonReturnHeaderRowIndex(sheet);
      if (headerRowIndex < 0) continue;

      const matrix = this.sheetPreviewMatrix(sheet, headerRowIndex + 1);
      const row = matrix[headerRowIndex];
      const normalizedCells = Array.isArray(row)
        ? this.normalizePreviewRow(row)
        : [];
      const score =
        (this.isAmazonReturnSheetName(sheetName) ? 10 : 0) +
        this.scoreAmazonReturnHeaderRow(normalizedCells);

      if (!best || score > best.score) {
        best = { sheetName, sheet, headerRowIndex, score };
      }
    }

    if (!best) return null;
    return {
      sheetName: best.sheetName,
      sheet: best.sheet,
      headerRowIndex: best.headerRowIndex,
    };
  }

  private isMeeshoPaymentSheetName(sheetName: string): boolean {
    const normalized = normalizeHeader(sheetName);
    if (
      MEESHO_PAYMENT_SHEET_NAMES.some(
        (target) => normalizeHeader(target) === normalized,
      )
    ) {
      return true;
    }
    return normalized.includes('order payment') || normalized === 'payments';
  }

  private meeshoPaymentRowHasAnchor(normalizedCells: string[]): boolean {
    const headerLike = normalizedCells.filter((c) => !cellLooksLikeDataValue(c));
    if (!headerLike.length) return false;

    const hasSubOrder = headerLike.some(
      (cell) =>
        cell.includes('sub order') ||
        cell === 'order id' ||
        cell.includes('sub_order'),
    );
    const hasPaymentField = headerLike.some(
      (cell) =>
        cell.includes('final settlement') ||
        cell.includes('payment date') ||
        cell.includes('transaction id') ||
        cell.includes('live order status'),
    );
    return hasSubOrder && hasPaymentField;
  }

  private scoreMeeshoPaymentHeaderRow(normalizedCells: string[]): number {
    return this.scoreMeeshoHeaderRow(
      normalizedCells,
      [...MEESHO_PAYMENT_HEADER_ALIASES],
    );
  }

  private detectMeeshoPaymentHeaderRowIndex(sheet: XLSX.WorkSheet): number {
    const matrix = this.sheetPreviewMatrix(sheet, 200);
    let bestIndex = -1;
    let bestScore = -1;
    const scanLimit = Math.min(matrix.length, 200);
    const minRequiredScore = 2;

    for (let i = 0; i < scanLimit; i += 1) {
      const row = matrix[i];
      if (!Array.isArray(row)) continue;
      const normalizedCells = this.normalizePreviewRow(row);
      if (!normalizedCells.length || !rowLooksLikeHeaderRow(normalizedCells)) {
        continue;
      }
      if (!this.meeshoPaymentRowHasAnchor(normalizedCells)) continue;
      const score = this.scoreMeeshoPaymentHeaderRow(normalizedCells);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0 || bestScore < minRequiredScore) {
      return -1;
    }
    return bestIndex;
  }

  private resolveMeeshoPaymentSheet(
    workbook: XLSX.WorkBook,
  ): { sheetName: string; sheet: XLSX.WorkSheet; headerRowIndex: number } | null {
    const namedSheets = workbook.SheetNames.filter((name) =>
      this.isMeeshoPaymentSheetName(name),
    );
    const sheetOrder = [
      ...namedSheets,
      ...workbook.SheetNames.filter((name) => !namedSheets.includes(name)),
    ];

    let best:
      | { sheetName: string; sheet: XLSX.WorkSheet; headerRowIndex: number; score: number }
      | null = null;

    for (const sheetName of sheetOrder) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      let headerRowIndex = this.detectMeeshoPaymentHeaderRowIndex(sheet);
      if (headerRowIndex < 0 && this.isMeeshoPaymentSheetName(sheetName)) {
        headerRowIndex = MEESHO_PAYMENT_HEADER_ROW_INDEX;
      }
      if (headerRowIndex < 0) continue;

      const matrix = this.sheetPreviewMatrix(sheet, headerRowIndex + 1);
      const row = matrix[headerRowIndex];
      const normalizedCells = Array.isArray(row)
        ? this.normalizePreviewRow(row)
        : [];
      const score =
        (this.isMeeshoPaymentSheetName(sheetName) ? 10 : 0) +
        this.scoreMeeshoPaymentHeaderRow(normalizedCells);

      if (!best || score > best.score) {
        best = { sheetName, sheet, headerRowIndex, score };
      }
    }

    if (!best) return null;
    return {
      sheetName: best.sheetName,
      sheet: best.sheet,
      headerRowIndex: best.headerRowIndex,
    };
  }

  private meeshoRowHasAnchor(
    fileKind: MeeshoFileKind,
    normalizedCells: string[],
  ): boolean {
    const headerLike = normalizedCells.filter((c) => !cellLooksLikeDataValue(c));
    if (!headerLike.length) return false;

    if (fileKind === 'tcsSales') {
      return headerLike.some(
        (cell) =>
          cell === 'gstin' ||
          cell.includes('sub order') ||
          cell.includes('sub order num'),
      );
    }
    if (fileKind === 'tcsSalesReturn') {
      return headerLike.some(
        (cell) =>
          cell.includes('sub order') || cell.includes('cancel return'),
      );
    }
    if (fileKind === 'orderReport') {
      return headerLike.some(
        (cell) =>
          cell.includes('sub order') ||
          cell.includes('status') ||
          cell.includes('sku') ||
          cell.includes('reason for credit'),
      );
    }
    if (MEESHO_RETURN_LIFECYCLE_FILE_KINDS.includes(fileKind)) {
      return headerLike.some(
        (cell) =>
          cell.includes('order number') ||
          cell.includes('sub order') ||
          cell.includes('type of return') ||
          cell.includes('return type') ||
          cell.includes('return reason') ||
          cell.includes('reason for return') ||
          cell.includes('detailed return') ||
          cell.includes('sub type'),
      );
    }
    return headerLike.some(
      (cell) =>
        cell.includes('order number') ||
        cell.includes('sub order') ||
        cell.includes('type of return') ||
        cell.includes('return type') ||
        cell.includes('return reason') ||
        cell.includes('reason for return') ||
        cell.includes('detailed return') ||
        cell.includes('sub type'),
    );
  }

  private scoreMeeshoHeaderRow(
    normalizedCells: string[],
    aliases: string[],
  ): number {
    const headerLike = normalizedCells.filter((c) => !cellLooksLikeDataValue(c));
    return aliases.reduce(
      (acc, alias) =>
        acc +
        (headerLike.some((cell) => headerAliasMatchesCell(cell, alias)) ? 1 : 0),
      0,
    );
  }

  private meeshoLifecycleReportLabel(fileKind: MeeshoFileKind): string {
    if (fileKind === 'returnInTransit') return 'Return In-Transit Report';
    if (fileKind === 'returnOutForDelivery') return 'Return Out for Delivery Report';
    if (fileKind === 'returnDeliveryComplete') return 'Return Delivery Complete Report';
    return 'Return Report';
  }

  private detectMeeshoHeaderRowIndex(
    sheet: XLSX.WorkSheet,
    fileKind: MeeshoFileKind,
  ): number {
    // Meesho exports often include seller metadata in the first several rows.
    const matrix = this.sheetPreviewMatrix(sheet, 200);
    const aliases = MEESHO_FILE_HEADER_ALIASES[fileKind];
    let bestIndex = -1;
    let bestScore = -1;
    const scanLimit = Math.min(matrix.length, 200);
    const minRequiredScore = 1;

    const evaluateRow = (rowIndex: number): number => {
      const row = matrix[rowIndex];
      if (!Array.isArray(row)) return -1;
      const normalizedCells = this.normalizePreviewRow(row);
      if (!normalizedCells.length || !rowLooksLikeHeaderRow(normalizedCells)) {
        return -1;
      }
      if (!this.meeshoRowHasAnchor(fileKind, normalizedCells)) return -1;
      return this.scoreMeeshoHeaderRow(normalizedCells, aliases);
    };

    if (MEESHO_RETURN_LIFECYCLE_FILE_KINDS.includes(fileKind)) {
      const label = this.meeshoLifecycleReportLabel(fileKind);
      if (matrix.length <= MEESHO_RETURN_LIFECYCLE_HEADER_ROW_INDEX) {
        throw new BadRequestException(
          `Meesho ${label} is too short — expected column headers on row 8.`,
        );
      }
      const fixedRowScore = evaluateRow(MEESHO_RETURN_LIFECYCLE_HEADER_ROW_INDEX);
      if (fixedRowScore >= minRequiredScore) {
        return MEESHO_RETURN_LIFECYCLE_HEADER_ROW_INDEX;
      }
      throw new BadRequestException(
        `Could not find expected column headers on row 8 in Meesho ${label}. Check column names in the file.`,
      );
    }

    for (let i = 0; i < scanLimit; i += 1) {
      const score = evaluateRow(i);
      if (score < 0) continue;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0 || bestScore < minRequiredScore) {
      const label =
        fileKind === 'tcsSales'
          ? 'TCS Sales Report'
          : fileKind === 'tcsSalesReturn'
            ? 'TCS Sales Return Report'
            : fileKind === 'orderReport'
              ? 'Order Report'
              : this.meeshoLifecycleReportLabel(fileKind);
      throw new BadRequestException(
        `Could not find header row in Meesho ${label}. Check column names in the file.`,
      );
    }

    return bestIndex;
  }

  private normalizePreviewRow(row: unknown[]): string[] {
    return row
      .map((item) =>
        item === null || item === undefined ? '' : normalizeHeader(String(item)),
      )
      .filter((item) => item.length > 0);
  }

  private myntraRowHasAnchor(
    fileKind: MyntraFileKind,
    normalizedCells: string[],
  ): boolean {
    const headerLike = normalizedCells.filter((c) => !cellLooksLikeDataValue(c));
    if (!headerLike.length) return false;

    if (fileKind === 'mDirectOrders') {
      return headerLike.some(
        (cell) =>
          cell.includes('order release') || cell.includes('order release id'),
      );
    }
    if (fileKind === 'mDirectReturns') {
      return headerLike.some(
        (cell) =>
          cell.includes('order id') ||
          cell.includes('order number') ||
          cell.includes('store order') ||
          cell.includes('return reason') ||
          cell.includes('return mode') ||
          cell.includes('return type'),
      );
    }
    if (fileKind === 'salesRevenueB2c') {
      return headerLike.some(
        (cell) =>
          cell.includes('sale order') ||
          cell.includes('invoice number') ||
          cell.includes('packing date') ||
          cell.includes('hsn'),
      );
    }
    if (fileKind === 'gstrReportRt') {
      return headerLike.some(
        (cell) =>
          cell.includes('packet') ||
          cell.includes('shipment') ||
          cell.includes('tax seller') ||
          cell.includes('fr refunded'),
      );
    }
    if (fileKind === 'gstrReportRto') {
      return headerLike.some(
        (cell) => cell.includes('tax seller') || cell.includes('order id'),
      );
    }
    return headerLike.some(
      (cell) =>
        cell.includes('seller gstin') ||
        cell.includes('order id'),
    );
  }

  private scoreMyntraHeaderRow(
    normalizedCells: string[],
    aliases: string[],
  ): number {
    const headerLike = normalizedCells.filter((c) => !cellLooksLikeDataValue(c));
    return aliases.reduce(
      (acc, alias) =>
        acc +
        (headerLike.some((cell) => headerAliasMatchesCell(cell, alias)) ? 1 : 0),
      0,
    );
  }

  private detectMyntraHeaderRowIndex(
    sheet: XLSX.WorkSheet,
    fileKind: MyntraFileKind,
  ): number {
    const matrix = this.sheetPreviewMatrix(sheet, 200);
    const aliases = MYNTRA_FILE_HEADER_ALIASES[fileKind];
    let bestIndex = -1;
    let bestScore = -1;
    const scanLimit = Math.min(matrix.length, 200);
    const minRequiredScore =
      fileKind === 'mDirectReturns'
        ? 1
        : fileKind === 'mDirectOrders'
          ? 2
          : 1;

    const evaluateRow = (rowIndex: number): number => {
      const row = matrix[rowIndex];
      if (!Array.isArray(row)) return -1;
      const normalizedCells = this.normalizePreviewRow(row);
      if (!normalizedCells.length || !rowLooksLikeHeaderRow(normalizedCells)) {
        return -1;
      }
      if (!this.myntraRowHasAnchor(fileKind, normalizedCells)) return -1;
      return this.scoreMyntraHeaderRow(normalizedCells, aliases);
    };

    for (let i = 0; i < scanLimit; i += 1) {
      const score = evaluateRow(i);
      if (score < 0) continue;
      if (score > bestScore || (score === bestScore && bestIndex < 0)) {
        bestScore = score;
        bestIndex = i;
      } else if (score === bestScore && i < bestIndex) {
        bestIndex = i;
      }
    }

    if (bestIndex > 0) {
      const firstScore = evaluateRow(0);
      if (firstScore >= minRequiredScore) {
        return 0;
      }
    }

    if (bestIndex < 0 || bestScore < minRequiredScore) {
      const label =
        fileKind === 'gstrReportPacked'
          ? 'GSTR Report Packed'
          : fileKind === 'mDirectOrders'
            ? 'MDirect Orders Report'
            : fileKind === 'salesRevenueB2c'
              ? 'Sales Revenue Packed B2C'
              : fileKind === 'gstrReportRto'
                ? 'GSTR Report RTO'
                : fileKind === 'gstrReportRt'
                  ? 'GSTR Report RT'
                  : 'MDirect Returns Report';
      throw new BadRequestException(
        `Could not find header row in Myntra ${label}. Check column names in the file.`,
      );
    }

    return bestIndex;
  }

  private detectAmazonHeaderRowIndex(sheet: XLSX.WorkSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: true,
    });
    const aliases = [
      'seller gstin',
      'order id',
      'sku',
      'transaction type',
      'payment method',
      'invoice amount',
      'invoice number',
      'invoice date',
    ];

    let bestIndex = 0;
    let bestScore = -1;
    const scanLimit = Math.min(rows.length, 40);
    for (let i = 0; i < scanLimit; i += 1) {
      const row = Array.isArray(rows[i]) ? rows[i] : [];
      const normalizedCells = row
        .map((item) => {
          if (
            typeof item === 'string' ||
            typeof item === 'number' ||
            typeof item === 'boolean'
          ) {
            return normalizeHeader(String(item));
          }
          return '';
        })
        .filter((item) => item.length > 0);
      if (!normalizedCells.length) continue;
      const score = aliases.reduce(
        (acc, alias) =>
          acc +
          (normalizedCells.some(
            (cell) => cell.includes(alias) || alias.includes(cell),
          )
            ? 1
            : 0),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  /** Runs the same parse logic off the main thread so API requests stay responsive. */
  parseFlipkartWorkbookInWorker(buffer: Buffer): Promise<ParsedWorkbook> {
    return runParseInWorkerThread<ParsedWorkbook>('flipkart', buffer);
  }

  parseAmazonWorkbookInWorker(buffer: Buffer): Promise<ParsedSingleSheetWorkbook> {
    return runParseInWorkerThread<ParsedSingleSheetWorkbook>('amazon', buffer);
  }
}
