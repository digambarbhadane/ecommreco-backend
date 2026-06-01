import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { flipkartImportMapping } from '../config/importMappings/flipkart.mapping';
import {
  headerMatchesAnyExcelColumn,
  isValidGstinFormat,
  normalizeGstinValue,
} from '../config/importMappings/gst-column.util';
import { ParsedSheetRow } from './mapping.service';
import { normalizeHeader } from '../utils/header.util';

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

@Injectable()
export class FileParserService {
  parseFlipkartWorkbook(buffer: Buffer): ParsedWorkbook {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellText: true,
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
    const salesRows = this.parseSheetRows(
      sales,
      'Sales Report',
      salesHeaderRowIndex,
    );
    const cashbackRows = this.parseSheetRows(
      cashback,
      'Cash Back Report',
      cashbackHeaderRowIndex,
    );
    const gstColumns = flipkartImportMapping.gstin.excelColumns;
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
    const gstinValues = Array.from(new Set([...salesGstins, ...cashbackGstins]));

    // eslint-disable-next-line no-console
    console.log(
      `[GST_DEBUG_v2] sheets=${salesSheet.name}|${cashbackSheet.name} salesHdr=${salesHeaderRowIndex} cashbackHdr=${cashbackHeaderRowIndex} salesRows=${salesRows.length} cashbackRows=${cashbackRows.length} gstinValues=${gstinValues.join('|') || '(none)'}`,
    );

    return {
      salesRows,
      cashbackRows,
      headers: {
        'Sales Report': this.extractHeaders(sales, salesHeaderRowIndex),
        'Cash Back Report': this.extractHeaders(
          cashback,
          cashbackHeaderRowIndex,
        ),
      },
      gstinValues,
    };
  }

  parseMeeshoWorkbook(buffer: Buffer): ParsedSingleSheetWorkbook {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    if (!workbook.SheetNames.length) {
      throw new BadRequestException('Workbook does not contain any sheet');
    }
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const headerRowIndex = this.detectMeeshoHeaderRowIndex(sheet);
    const rows = this.parseSheetRows(sheet, firstSheetName, headerRowIndex);
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
    const rows = this.parseSheetRows(sheet, firstSheetName, headerRowIndex);
    return {
      rows,
      headers: this.extractHeaders(sheet, headerRowIndex),
    };
  }

  private parseSheetRows(
    sheet: XLSX.WorkSheet,
    sheetName: string,
    headerRowIndex: number,
  ): ParsedSheetRow[] {
    const matrix = this.sheetToMatrix(sheet);

    if (!matrix.length || headerRowIndex >= matrix.length) {
      return [];
    }

    const headerCells = matrix[headerRowIndex];
    if (!Array.isArray(headerCells)) {
      return [];
    }

    const headers = headerCells.map((cell, index) => {
      const label = String(cell ?? '').trim();
      return label || `__EMPTY_${index}`;
    });

    const dataStartRow = this.resolveDataStartRow(
      matrix,
      headerRowIndex,
      flipkartImportMapping.gstin.excelColumns,
    );

    const parsed: ParsedSheetRow[] = [];
    for (let rowIndex = dataStartRow; rowIndex < matrix.length; rowIndex += 1) {
      const cells = matrix[rowIndex];
      if (!Array.isArray(cells)) continue;

      const hasData = cells.some(
        (cell) =>
          cell !== null &&
          cell !== undefined &&
          String(cell).trim().length > 0,
      );
      if (!hasData) continue;

      const row: ParsedSheetRow = {
        __sheetName: sheetName,
        __rowNumber: rowIndex + 1,
      };

      headers.forEach((header, colIndex) => {
        if (header.startsWith('__EMPTY_')) return;
        row[header] =
          this.getCellValue(sheet, rowIndex, colIndex) ?? cells[colIndex] ?? null;
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

  private getCellValue(
    sheet: XLSX.WorkSheet,
    row: number,
    col: number,
  ): unknown {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
    if (!cell) return null;
    if (cell.w != null && String(cell.w).trim() !== '') {
      return cell.w;
    }
    return cell.v ?? null;
  }

  private sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: true,
    });
  }

  /** Read GSTIN by column index; falls back to scanning the sheet for 15-char GSTINs. */
  private extractGstinByColumnIndex(
    sheet: XLSX.WorkSheet,
    headerRowIndex: number,
    excelColumns: string[],
  ): string[] {
    const matrix = this.sheetToMatrix(sheet);
    if (!matrix.length) return [];

    const colIndex = this.resolveGstColumnIndex(matrix, headerRowIndex, excelColumns);
    const values = new Set<string>();
    const dataStartRow = this.resolveDataStartRow(
      matrix,
      headerRowIndex,
      excelColumns,
    );
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const maxRow = range.e.r;

    if (colIndex >= 0) {
      for (let rowIndex = dataStartRow; rowIndex <= maxRow; rowIndex += 1) {
        const gstin = normalizeGstinValue(
          this.getCellValue(sheet, rowIndex, colIndex),
        );
        if (gstin && isValidGstinFormat(gstin)) {
          values.add(gstin);
        }
      }
    }

    if (!values.size) {
      this.scanWorksheetForGstins(sheet, headerRowIndex).forEach((item) =>
        values.add(item),
      );
    }

    return [...values];
  }

  private scanWorksheetForGstins(
    sheet: XLSX.WorkSheet,
    afterHeaderRow: number,
  ): string[] {
    const values = new Set<string>();
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    for (let row = afterHeaderRow + 1; row <= range.e.r; row += 1) {
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const gstin = normalizeGstinValue(this.getCellValue(sheet, row, col));
        if (gstin && isValidGstinFormat(gstin)) {
          values.add(gstin);
        }
      }
    }
    return [...values];
  }

  private resolveGstColumnIndex(
    matrix: unknown[][],
    headerRowIndex: number,
    excelColumns: string[],
  ): number {
    const rowsToScan = [
      headerRowIndex,
      headerRowIndex - 1,
      headerRowIndex + 1,
      headerRowIndex + 2,
    ].filter((index) => index >= 0 && index < matrix.length);

    let fallbackCol = -1;

    for (const rowIndex of rowsToScan) {
      const row = matrix[rowIndex];
      if (!Array.isArray(row)) continue;
      for (let col = 0; col < row.length; col += 1) {
        const label = String(row[col] ?? '').trim();
        if (!label) continue;
        if (!headerMatchesAnyExcelColumn(label, excelColumns)) continue;

        const norm = normalizeHeader(label);
        if (norm === 'seller gstin' || norm.endsWith('seller gstin')) {
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
      const looksLikeHeader = row.some((cell) => {
        const label = String(cell ?? '').trim();
        if (!label.length) return false;
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
      });
      const hasGstinValue = row.some((cell) => {
        const gstin = normalizeGstinValue(cell);
        return !!gstin && isValidGstinFormat(gstin);
      });
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
  ): string[] {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      header: 1,
      raw: false,
      blankrows: true,
    });
    const firstRow =
      Array.isArray(rows) && rows.length > headerRowIndex
        ? rows[headerRowIndex]
        : [];
    if (!Array.isArray(firstRow)) return [];
    return firstRow
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0);
  }

  private detectHeaderRowIndex(
    sheet: XLSX.WorkSheet,
    sheetName: 'Sales Report' | 'Cash Back Report',
  ) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: true,
    });
    const aliases =
      sheetName === 'Sales Report'
        ? [
            'seller gstin',
            'order id',
            'buyer invoice id',
            'buyer invoice date',
            'event type',
            'taxable value',
          ]
        : [
            'seller gstin',
            'order id',
            'credit note id',
            'debit note id',
            'document sub type',
            'taxable value',
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
      const hasSellerGstin = normalizedCells.some(
        (cell) =>
          cell === 'seller gstin' ||
          cell.includes('seller gstin') ||
          cell.includes('gst no'),
      );
      if (!hasSellerGstin) continue;

      const score =
        aliases.reduce(
          (acc, alias) =>
            acc +
            (normalizedCells.some(
              (cell) => cell.includes(alias) || alias.includes(cell),
            )
              ? 1
              : 0),
          0,
        ) + 5;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  private detectMeeshoHeaderRowIndex(sheet: XLSX.WorkSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: true,
    });
    const aliases = [
      'sub order num',
      'sub order no',
      'order number',
      'gstin',
      'hsn code',
      'total invoice value',
      'order date',
      'cancel return date',
      'reason for credit entry',
      'type of return',
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
          acc + (normalizedCells.some((cell) => cell === alias || cell.includes(alias)) ? 1 : 0),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
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
}
