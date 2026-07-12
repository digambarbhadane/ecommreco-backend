import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { ExportSkuMasterQueryDto } from './dto/export-sku-master.query.dto';
import { SkuMasterService } from './sku-master.service';

type RequestActor = {
  id?: string;
  role?: string;
  email?: string;
};

type ParsedImportRow = {
  rowNumber: number;
  marketplace: string;
  marketplaceSku: string;
  masterSku: string;
  rate: string;
};

const EXPORT_COLUMNS = [
  { header: 'GST No', key: 'gstin', width: 20 },
  { header: 'Business Name', key: 'businessName', width: 28 },
  { header: 'Marketplace', key: 'marketplace', width: 14 },
  { header: 'Marketplace SKU', key: 'marketplaceSku', width: 28 },
  { header: 'Master SKU', key: 'masterSku', width: 22 },
  { header: 'Rate', key: 'rate', width: 12 },
] as const;

@Injectable()
export class SkuMasterExcelService {
  private readonly logger = new Logger(SkuMasterExcelService.name);

  constructor(private readonly skuMasterService: SkuMasterService) {}

  async exportWorkbook(query: ExportSkuMasterQueryDto, actor: RequestActor) {
    const { filtered, gst } = await this.skuMasterService.getFilteredItems(
      {
        ...query,
        // Excel download is only for rows that still need mapping.
        status: 'UNMAPPED',
      },
      actor,
    );

    if (!filtered.length) {
      throw new BadRequestException(
        'No unmapped SKUs found to export for the selected GST and filters.',
      );
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EcommReco';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('SKU Master');
    sheet.columns = EXPORT_COLUMNS.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF003F5C' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 22;

    const gstin = String(gst.gstNumber ?? '').trim().toUpperCase();
    const businessName =
      String(gst.businessName ?? '').trim() ||
      String(gst.tradeName ?? '').trim() ||
      '';

    for (const item of filtered) {
      sheet.addRow({
        gstin: item.gstin || gstin,
        businessName: item.businessName || businessName,
        marketplace: this.formatMarketplaceLabel(item.marketplace),
        marketplaceSku: item.marketplaceSku,
        masterSku: item.masterSku ?? '',
        rate: item.rate ?? '',
      });
    }

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: EXPORT_COLUMNS.length },
    };

    const instructions = workbook.addWorksheet('Instructions');
    instructions.columns = [{ width: 96 }];
    instructions.addRow(['SKU Master bulk mapping guide']);
    instructions.addRow([]);
    instructions.addRow([
      '1. This file contains only UNMAPPED SKUs for the selected GST.',
    ]);
    instructions.addRow([
      '2. Fill both "Master SKU" and "Rate" for every row you want to map.',
    ]);
    instructions.addRow([
      '3. Mapping is completed only when both Master SKU and Rate are provided.',
    ]);
    instructions.addRow([
      '4. Do not change GST No, Business Name, Marketplace, or Marketplace SKU.',
    ]);
    instructions.addRow([
      '5. Leave Master SKU / Rate blank for rows you do not want to update yet.',
    ]);
    instructions.addRow(['6. Save the file and upload it back on the SKU Master page.']);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const gstSlug = gstin.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15);
    const filename = `sku-master-unmapped-${gstSlug || 'export'}-${Date.now()}.xlsx`;

    return { buffer, filename, rowCount: filtered.length };
  }

  async importWorkbook(
    buffer: Buffer,
    gstId: string,
    actor: RequestActor,
  ) {
    if (!buffer?.length) {
      throw new BadRequestException('Excel file is empty');
    }

    const { allItems } = await this.skuMasterService.getFilteredItems(
      { gstId, marketplace: 'ALL', status: 'ALL' },
      actor,
    );

    const knownKeys = new Map(
      allItems.map((item) => [
        `${item.marketplace}:${item.marketplaceSku}`,
        item,
      ]),
    );

    const parsedRows = this.parseWorkbook(buffer);
    if (!parsedRows.length) {
      throw new BadRequestException(
        'No data rows found. Use the exported SKU Master template.',
      );
    }

    const errors: Array<{
      row: number;
      marketplaceSku: string;
      message: string;
    }> = [];
    const updates: Array<{
      gstId: string;
      marketplace: string;
      marketplaceSku: string;
      masterSku: string;
      rate: number;
    }> = [];

    let skippedCount = 0;

    for (const row of parsedRows) {
      const masterSku = row.masterSku.trim();
      const rateRaw = row.rate.trim();
      if (!masterSku && !rateRaw) {
        skippedCount += 1;
        continue;
      }

      const marketplace = this.normalizeMarketplace(row.marketplace);
      const marketplaceSku = row.marketplaceSku.trim();
      const rate = this.parseRate(rateRaw);

      if (!marketplace || !marketplaceSku) {
        errors.push({
          row: row.rowNumber,
          marketplaceSku: marketplaceSku || '—',
          message: 'Marketplace and Marketplace SKU are required',
        });
        continue;
      }

      if (!masterSku || rate === null) {
        errors.push({
          row: row.rowNumber,
          marketplaceSku,
          message: 'Both Master SKU and Rate are required to complete mapping',
        });
        continue;
      }

      const key = `${marketplace}:${marketplaceSku}`;
      if (!knownKeys.has(key)) {
        errors.push({
          row: row.rowNumber,
          marketplaceSku,
          message: 'SKU not found for this GST in uploaded reports',
        });
        continue;
      }

      updates.push({
        gstId,
        marketplace,
        marketplaceSku,
        masterSku,
        rate,
      });
    }

    if (!updates.length && errors.length) {
      throw new BadRequestException({
        message: 'No valid rows to import',
        errors: errors.slice(0, 25),
      });
    }

    let updatedCount = 0;
    if (updates.length) {
      const result = await this.skuMasterService.bulkUpdate(updates, actor);
      updatedCount = result.updatedCount;
    }

    this.logger.log(
      `SKU master Excel import for GST ${gstId}: updated=${updatedCount}, skipped=${skippedCount}, failed=${errors.length}`,
    );

    return {
      success: true,
      updatedCount,
      skippedCount,
      failedCount: errors.length,
      errors: errors.slice(0, 50),
    };
  }

  private parseWorkbook(buffer: Buffer): ParsedImportRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName =
      workbook.SheetNames.find((name) =>
        name.trim().toLowerCase().includes('sku master'),
      ) ?? workbook.SheetNames[0];

    if (!sheetName) return [];

    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    if (!matrix.length) return [];

    const headerRowIndex = matrix.findIndex((row) =>
      this.rowHasRequiredHeaders(row),
    );
    if (headerRowIndex < 0) {
      throw new BadRequestException(
        'Invalid template. Expected columns: Marketplace, Marketplace SKU, Master SKU, Rate.',
      );
    }

    const headerRow = matrix[headerRowIndex] ?? [];
    const columnIndex = this.resolveColumnIndexes(headerRow);
    const parsed: ParsedImportRow[] = [];

    for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
      const row = matrix[index] ?? [];
      const marketplace = this.cellValue(row, columnIndex.marketplace);
      const marketplaceSku = this.cellValue(row, columnIndex.marketplaceSku);
      const masterSku = this.cellValue(row, columnIndex.masterSku);
      const rate = this.cellValue(row, columnIndex.rate);

      if (!marketplace && !marketplaceSku && !masterSku && !rate) continue;

      parsed.push({
        rowNumber: index + 1,
        marketplace,
        marketplaceSku,
        masterSku,
        rate,
      });
    }

    return parsed;
  }

  private rowHasRequiredHeaders(row: (string | number | null)[]) {
    const indexes = this.resolveColumnIndexes(row);
    return (
      indexes.marketplace >= 0 &&
      indexes.marketplaceSku >= 0 &&
      indexes.masterSku >= 0 &&
      indexes.rate >= 0
    );
  }

  private resolveColumnIndexes(row: (string | number | null)[]) {
    const normalized = row.map((cell) => this.normalizeHeader(cell));

    const find = (...labels: string[]) =>
      normalized.findIndex((cell) => labels.includes(cell));

    return {
      gstin: find('gst no', 'gstin', 'gst number'),
      businessName: find('business name', 'trade name'),
      marketplace: find('marketplace'),
      marketplaceSku: find(
        'marketplace sku',
        'marketplace sku id',
        'sku id',
        'sku',
      ),
      masterSku: find('master sku', 'master sku id'),
      rate: find('rate', 'gst rate', 'tax rate'),
    };
  }

  private parseRate(value: string): number | null {
    if (!value) return null;
    const cleaned = value.replace(/%/g, '').trim();
    const rate = Number(cleaned);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return null;
    return Math.round(rate * 100) / 100;
  }

  private cellValue(row: (string | number | null)[], index: number) {
    if (index < 0) return '';
    return String(row[index] ?? '').trim();
  }

  private normalizeHeader(value: string | number | null) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  private normalizeMarketplace(value: string) {
    return String(value ?? '').trim().toLowerCase();
  }

  private formatMarketplaceLabel(value: string) {
    const normalized = value.trim().toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
}
