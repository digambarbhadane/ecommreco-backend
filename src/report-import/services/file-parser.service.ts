import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { normalizeHeader, ParsedSheetRow } from './mapping.service';

type ParsedWorkbook = {
  salesRows: ParsedSheetRow[];
  cashbackRows: ParsedSheetRow[];
  headers: Record<'Sales Report' | 'Cash Back Report', string[]>;
};

type ParsedSingleSheetWorkbook = {
  rows: ParsedSheetRow[];
  headers: string[];
};

@Injectable()
export class FileParserService {
  parseFlipkartWorkbook(buffer: Buffer): ParsedWorkbook {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const requiredSheets = ['Sales Report', 'Cash Back Report'] as const;
    const missing = requiredSheets.filter(
      (name) => !workbook.SheetNames.includes(name),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required sheet(s): ${missing.join(', ')}`,
      );
    }

    const sales = workbook.Sheets['Sales Report'];
    const cashback = workbook.Sheets['Cash Back Report'];

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
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false,
      blankrows: false,
      range: headerRowIndex,
    });
    return rows.map((row, index) => ({
      ...row,
      __sheetName: sheetName,
      __rowNumber: index + headerRowIndex + 2,
    }));
  }

  private extractHeaders(
    sheet: XLSX.WorkSheet,
    headerRowIndex: number,
  ): string[] {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
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
      blankrows: false,
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

  private detectMeeshoHeaderRowIndex(sheet: XLSX.WorkSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
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
      blankrows: false,
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
