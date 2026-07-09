import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import { ValidationService } from './validation.service';
import { Gstr1B2csExportDto } from '../dto/gstr1-b2cs-export.dto';
import { buildStateWiseSalesMatch } from '../utils/state-wise-report.aggregation';

type B2csRow = {
  type: 'OE';
  placeOfSupply: string;
  applicablePercent: string;
  rate: number;
  taxableValue: number;
  cessAmount: number;
  ecommerceGstin: string;
};

const TEMPLATE_RELATIVE_PATH = path.join(
  'src',
  'assets',
  'gst-template',
  'GSTR1_Excel_Workbook_Template_V2.2.xlsx',
);

/** B2CS sheet layout in GSTR1_Excel_Workbook_Template_V2.2.xlsx */
const B2CS_SHEET_LAYOUT = {
  headerRow: 3, // Excel row 4: Type, Place Of Supply, ...
  dataStartRow: 4, // Excel row 5
  summaryRow: 2, // Excel row 3: Total Taxable Value / Total Cess
  typeCol: 0,
  posCol: 1,
  applicableCol: 2,
  rateCol: 3,
  taxableCol: 4,
  cessCol: 5,
  ecommerceCol: 6,
} as const;

@Injectable()
export class Gstr1B2csReportService {
  constructor(
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    private readonly validationService: ValidationService,
  ) {}

  private resolveTemplatePath(): string {
    const workspacePath = path.join(process.cwd(), TEMPLATE_RELATIVE_PATH);
    if (fs.existsSync(workspacePath)) return workspacePath;
    const distPath = path.join(
      process.cwd(),
      'dist',
      'assets',
      'gst-template',
      'GSTR1_Excel_Workbook_Template_V2.2.xlsx',
    );
    if (fs.existsSync(distPath)) return distPath;
    throw new BadRequestException('GSTR1 template file not found');
  }

  private toNumber(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  private async getRows(dto: Gstr1B2csExportDto): Promise<B2csRow[]> {
    const sellerAliases = await this.validationService.resolveSellerIdAliases(
      dto.sellerId,
    );
    const gstin = String(dto.gstin ?? '').trim().toUpperCase();
    const reportMonth = String(dto.reportMonth ?? '').trim();

    if (!gstin || !reportMonth) {
      throw new BadRequestException('gstin and reportMonth are required');
    }

    const baseFilter = buildStateWiseSalesMatch({
      sellerId: { $in: sellerAliases },
      gstin,
      reportMonth,
    });
    if (dto.marketplace?.trim()) {
      (baseFilter as Record<string, unknown>).marketplace = dto.marketplace.trim();
    }

    const groupedRows = await this.rowModel
      .aggregate<{
        _id: { placeOfSupply: string; rate: number };
        taxableValue: number;
      }>([
        { $match: baseFilter },
        {
          $addFields: {
            placeOfSupply: {
              $ifNull: [{ $trim: { input: '$stateName' } }, 'Unknown'],
            },
            effectiveRate: {
              $cond: [
                { $gt: [{ $ifNull: ['$igstRate', 0] }, 0] },
                { $ifNull: ['$igstRate', 0] },
                {
                  $add: [
                    { $ifNull: ['$cgstRate', 0] },
                    { $ifNull: ['$sgstRate', 0] },
                  ],
                },
              ],
            },
          },
        },
        {
          $group: {
            _id: {
              placeOfSupply: '$placeOfSupply',
              rate: '$effectiveRate',
            },
            taxableValue: { $sum: { $ifNull: ['$taxableAmount', 0] } },
          },
        },
        { $sort: { '_id.placeOfSupply': 1, '_id.rate': 1 } },
      ])
      .option({ maxTimeMS: 45_000, allowDiskUse: true })
      .exec();

    return groupedRows.map((item) => ({
      type: 'OE',
      placeOfSupply: String(item._id?.placeOfSupply ?? 'Unknown') || 'Unknown',
      applicablePercent: '',
      rate: this.toNumber(item._id?.rate),
      taxableValue: this.toNumber(item.taxableValue),
      cessAmount: 0,
      ecommerceGstin: '',
    }));
  }

  private normalizeHeader(value: unknown): string {
    return String(value ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getSheetCellValue(
    sheet: XLSX.WorkSheet,
    row: number,
    col: number,
  ): unknown {
    const ref = XLSX.utils.encode_cell({ r: row, c: col });
    return sheet[ref]?.v;
  }

  private setSheetCellValue(
    sheet: XLSX.WorkSheet,
    row: number,
    col: number,
    value: string | number,
  ) {
    const ref = XLSX.utils.encode_cell({ r: row, c: col });
    sheet[ref] = {
      t: typeof value === 'number' ? 'n' : 's',
      v: value,
    };
  }

  private clearSheetCell(
    sheet: XLSX.WorkSheet,
    row: number,
    col: number,
  ) {
    const ref = XLSX.utils.encode_cell({ r: row, c: col });
    if (sheet[ref]) {
      delete sheet[ref];
    }
  }

  private resolveB2csSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
    const sheetName = workbook.SheetNames.find(
      (name) => name.toLowerCase() === 'b2cs',
    );
    if (!sheetName) {
      throw new BadRequestException('B2CS sheet not found in template');
    }
    return workbook.Sheets[sheetName];
  }

  private resolveB2csColumns(sheet: XLSX.WorkSheet) {
    for (let rowIdx = 0; rowIdx < 20; rowIdx += 1) {
      const map = new Map<string, number>();
      for (let colIdx = 0; colIdx < 10; colIdx += 1) {
        const header = this.normalizeHeader(
          this.getSheetCellValue(sheet, rowIdx, colIdx),
        );
        if (!header) continue;
        map.set(header, colIdx);
      }
      const typeCol = map.get('type');
      const posCol = map.get('place of supply');
      const applicableCol =
        map.get('applicable % of tax rate') ??
        map.get('applicable % of tax rate'.replace('%', ''));
      const rateCol = map.get('rate');
      const taxableCol = map.get('taxable value');
      const cessCol = map.get('cess amount');
      const ecommerceCol =
        map.get('e-commerce gstin') ?? map.get('e commerce gstin');
      if (
        typeCol !== undefined &&
        posCol !== undefined &&
        rateCol !== undefined &&
        taxableCol !== undefined &&
        cessCol !== undefined
      ) {
        return {
          headerRow: rowIdx,
          dataStartRow: rowIdx + 1,
          summaryRow: B2CS_SHEET_LAYOUT.summaryRow,
          typeCol,
          posCol,
          applicableCol: applicableCol ?? typeCol + 2,
          rateCol,
          taxableCol,
          cessCol,
          ecommerceCol: ecommerceCol ?? cessCol + 1,
        };
      }
    }

    // Fallback to known template layout (row 4 headers, row 5+ data).
    return { ...B2CS_SHEET_LAYOUT };
  }

  async getPreview(dto: Gstr1B2csExportDto) {
    const rows = await this.getRows(dto);
    return {
      success: true,
      data: {
        rowCount: rows.length,
        gstin: dto.gstin,
        reportMonth: dto.reportMonth,
        message:
          rows.length === 0
            ? 'No data found for selected GST and month.'
            : undefined,
      },
    };
  }

  async generateWorkbook(dto: Gstr1B2csExportDto): Promise<{
    buffer: Buffer;
    rowCount: number;
    filename: string;
  }> {
    const rows = await this.getRows(dto);
    if (!rows.length) {
      throw new BadRequestException('No data found for selected GST and month.');
    }

    const templatePath = this.resolveTemplatePath();
    const templateBuffer = fs.readFileSync(templatePath);
    const workbook = XLSX.read(templateBuffer, {
      type: 'buffer',
      cellDates: true,
      cellNF: true,
      cellStyles: true,
    });
    const b2csSheet = this.resolveB2csSheet(workbook);

    const cols = this.resolveB2csColumns(b2csSheet);
    const dataStartRow = cols.dataStartRow;

    // Clear only a bounded window to avoid iterating giant formatted row ranges.
    const clearUntilRow = dataStartRow + Math.max(rows.length + 500, 1000);
    for (let r = dataStartRow; r <= clearUntilRow; r += 1) {
      this.clearSheetCell(b2csSheet, r, cols.typeCol);
      this.clearSheetCell(b2csSheet, r, cols.posCol);
      this.clearSheetCell(b2csSheet, r, cols.applicableCol);
      this.clearSheetCell(b2csSheet, r, cols.rateCol);
      this.clearSheetCell(b2csSheet, r, cols.taxableCol);
      this.clearSheetCell(b2csSheet, r, cols.cessCol);
      this.clearSheetCell(b2csSheet, r, cols.ecommerceCol);
    }

    let totalTaxable = 0;
    let totalCess = 0;

    rows.forEach((item, index) => {
      const rowIdx = dataStartRow + index;
      totalTaxable += item.taxableValue;
      totalCess += item.cessAmount;
      this.setSheetCellValue(b2csSheet, rowIdx, cols.typeCol, 'OE');
      this.setSheetCellValue(b2csSheet, rowIdx, cols.posCol, item.placeOfSupply);
      this.setSheetCellValue(
        b2csSheet,
        rowIdx,
        cols.applicableCol,
        item.applicablePercent,
      );
      this.setSheetCellValue(b2csSheet, rowIdx, cols.rateCol, item.rate);
      this.setSheetCellValue(
        b2csSheet,
        rowIdx,
        cols.taxableCol,
        item.taxableValue,
      );
      this.setSheetCellValue(b2csSheet, rowIdx, cols.cessCol, item.cessAmount);
      this.setSheetCellValue(
        b2csSheet,
        rowIdx,
        cols.ecommerceCol,
        item.ecommerceGstin,
      );
    });

    this.setSheetCellValue(
      b2csSheet,
      cols.summaryRow,
      cols.taxableCol,
      totalTaxable,
    );
    this.setSheetCellValue(b2csSheet, cols.summaryRow, cols.cessCol, totalCess);

    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true,
    }) as Buffer;
    const gstSlug = String(dto.gstin).replace(/[^a-zA-Z0-9]/g, '');
    const monthSlug = String(dto.reportMonth).replace(/[^0-9-]/g, '');
    return {
      buffer,
      rowCount: rows.length,
      filename: `gstr1-b2cs-${gstSlug}-${monthSlug}.xlsx`,
    };
  }
}

