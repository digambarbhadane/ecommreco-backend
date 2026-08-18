import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { ExportSkuMasterQueryDto } from './dto/export-sku-master.query.dto';
import { SkuMasterService } from './sku-master.service';
import { parseSkuRate } from './sku-rate.util';
import { resolveGstDisplayName } from '../gsts/utils/gst-display.util';

type RequestActor = {
  id?: string;
  role?: string;
  email?: string;
};

type ParsedImportRow = {
  rowNumber: number;
  gstin: string;
  marketplace: string;
  marketplaceSku: string;
  masterSku: string;
  category: string;
  rate: string;
};

const EXPORT_COLUMNS = [
  { header: 'GST No', key: 'gstin', width: 20 },
  { header: 'Business Name', key: 'businessName', width: 28 },
  { header: 'Marketplace', key: 'marketplace', width: 14 },
  { header: 'Marketplace SKU', key: 'marketplaceSku', width: 28 },
  { header: 'Master SKU', key: 'masterSku', width: 22 },
  { header: 'Category', key: 'category', width: 22 },
  { header: 'Rate', key: 'rate', width: 12 },
] as const;

@Injectable()
export class SkuMasterExcelService {
  private readonly logger = new Logger(SkuMasterExcelService.name);

  constructor(private readonly skuMasterService: SkuMasterService) {}

  async exportWorkbook(query: ExportSkuMasterQueryDto, actor: RequestActor) {
    const { filtered, gst } = await this.skuMasterService.getFilteredItems(
      {
        gstId: query.gstId,
        marketplace: query.marketplace ?? 'ALL',
        search: query.search,
        status: query.status ?? 'ALL',
      },
      actor,
    );

    if (!filtered.length) {
      throw new BadRequestException(
        'No SKUs found to export for the selected GST.',
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

    const gstin = String(gst?.gstNumber ?? '').trim().toUpperCase();
    const businessName = gst ? resolveGstDisplayName(gst) : '';

    for (const item of filtered) {
      const row = sheet.addRow({
        gstin: item.gstin || gstin,
        businessName: item.businessName || businessName,
        marketplace: this.formatMarketplaceLabel(item.marketplace),
        marketplaceSku: item.marketplaceSku,
        masterSku: item.masterSku ?? '',
        category: item.category ?? '',
        rate: item.rate ?? '',
      });
      row.getCell('rate').numFmt = '0.##';
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
      '1. This file contains SKUs for the selected GST scope (mapped and unmapped).',
    ]);
    instructions.addRow([
      '2. Change Master SKU, Category, and/or Rate, then re-upload. Existing mappings are overwritten with the new values.',
    ]);
    instructions.addRow([
      '3. Rate is stored exactly as entered (for example 500 stays 500). Leave Rate or Category blank to keep the current value.',
    ]);
    instructions.addRow([
      '4. Mapping status becomes Mapped when both Master SKU and Rate are provided. Category is optional.',
    ]);
    instructions.addRow([
      '5. Do not change GST No, Business Name, Marketplace, or Marketplace SKU.',
    ]);
    instructions.addRow([
      '6. Leave Master SKU blank for rows you do not want to update yet.',
    ]);
    instructions.addRow(['7. Save the file and upload it back on the SKU Master page.']);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const gstSlug = query.gstId
      ? gstin.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15)
      : 'all-gst';
    const filename = `sku-master-${gstSlug || 'export'}-${Date.now()}.xlsx`;

    return { buffer, filename, rowCount: filtered.length };
  }

  async importWorkbook(
    buffer: Buffer,
    gstId: string | undefined,
    actor: RequestActor,
  ) {
    const prepared = await this.prepareImport(buffer, gstId, actor);

    if (!prepared.updates.length && prepared.errors.length) {
      throw new BadRequestException({
        message: 'No valid rows to import',
        errors: prepared.errors.slice(0, 25),
      });
    }

    let updatedCount = 0;
    if (prepared.updates.length) {
      const result = await this.commitUpdates(prepared.updates, actor);
      updatedCount = result.updatedCount;
    }

    return {
      success: true,
      updatedCount,
      skippedCount: prepared.skippedCount,
      failedCount: prepared.errors.length,
      errors: prepared.errors.slice(0, 50),
      totalRows: prepared.totalRows,
      pendingCount: 0,
    };
  }

  async prepareImport(
    buffer: Buffer,
    gstId: string | undefined,
    actor: RequestActor,
  ) {
    if (!buffer?.length) {
      throw new BadRequestException('Excel file is empty');
    }

    const { allItems } = await this.skuMasterService.getFilteredItems(
      { gstId, marketplace: 'ALL', status: 'ALL' },
      actor,
    );

    const knownByGstin = new Map(
      allItems.map((item) => [
        `${item.gstin}:${item.marketplace}:${item.marketplaceSku.toLowerCase()}`,
        item,
      ]),
    );
    const knownBySku = new Map(
      allItems.map((item) => [
        `${item.marketplace}:${item.marketplaceSku.toLowerCase()}`,
        item,
      ]),
    );
    const selectedGstin = gstId
      ? allItems.find((item) => item.gstId === gstId)?.gstin
      : undefined;

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
      rate?: number | null;
      category?: string;
    }> = [];

    let skippedCount = 0;

    for (const row of parsedRows) {
      const marketplace = this.normalizeMarketplace(row.marketplace);
      const marketplaceSku = row.marketplaceSku.trim();
      const masterSkuFromFile = row.masterSku.trim();
      const categoryFromFile = row.category.trim();
      const rateRaw = row.rate.trim();
      const rate = rateRaw ? parseSkuRate(rateRaw) : null;

      if (!marketplace || !marketplaceSku) {
        if (!masterSkuFromFile && !rateRaw && !categoryFromFile) {
          skippedCount += 1;
          continue;
        }
        errors.push({
          row: row.rowNumber,
          marketplaceSku: marketplaceSku || '—',
          message: 'Marketplace and Marketplace SKU are required',
        });
        continue;
      }

      const gstin = String(row.gstin ?? selectedGstin ?? '')
        .trim()
        .toUpperCase();
      const skuKey = marketplaceSku.toLowerCase();
      const matched =
        (gstin
          ? knownByGstin.get(`${gstin}:${marketplace}:${skuKey}`)
          : undefined) ??
        knownBySku.get(`${marketplace}:${skuKey}`);

      if (!matched) {
        errors.push({
          row: row.rowNumber,
          marketplaceSku,
          message: 'SKU not found for this GST in uploaded reports',
        });
        continue;
      }

      const masterSku = masterSkuFromFile || String(matched.masterSku ?? '').trim();
      if (!masterSku) {
        errors.push({
          row: row.rowNumber,
          marketplaceSku,
          message: 'Master SKU is required to update this row',
        });
        continue;
      }

      const existingMaster = String(matched.masterSku ?? '').trim();
      const existingCategory = String(matched.category ?? '').trim();
      const existingRate =
        matched.rate === null || matched.rate === undefined
          ? null
          : Number(matched.rate);
      const masterChanged = masterSku !== existingMaster;
      const categoryChanged =
        Boolean(categoryFromFile) && categoryFromFile !== existingCategory;
      const rateChanged = rate !== null && rate !== existingRate;
      if (!masterChanged && !rateChanged && !categoryChanged) {
        skippedCount += 1;
        continue;
      }

      updates.push({
        gstId: matched.gstId,
        marketplace,
        marketplaceSku,
        masterSku,
        ...(rate !== null ? { rate } : {}),
        ...(categoryFromFile ? { category: categoryFromFile.slice(0, 120) } : {}),
      });
    }

    return {
      success: true as const,
      totalRows: parsedRows.length,
      updateCount: updates.length,
      skippedCount,
      failedCount: errors.length,
      errors: errors.slice(0, 50),
      updates,
    };
  }

  async commitUpdates(
    items: Array<{
      gstId: string;
      marketplace: string;
      marketplaceSku: string;
      masterSku: string;
      rate?: number | null;
      category?: string | null;
    }>,
    actor: RequestActor,
  ) {
    if (!items.length) {
      return { success: true as const, updatedCount: 0 };
    }
    const result = await this.skuMasterService.bulkUpdate(items, actor);
    return {
      success: true as const,
      updatedCount: result.updatedCount,
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
        'Invalid template. Expected columns: Marketplace, Marketplace SKU, Master SKU, Rate. Category is optional.',
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
      const category = this.cellValue(row, columnIndex.category);
      const rate = this.cellValue(row, columnIndex.rate);

      if (!marketplace && !marketplaceSku && !masterSku && !category && !rate) {
        continue;
      }

      parsed.push({
        rowNumber: index + 1,
        gstin: this.cellValue(row, columnIndex.gstin).toUpperCase(),
        marketplace,
        marketplaceSku,
        masterSku,
        category,
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
      category: find('category', 'product category'),
      rate: find('rate', 'gst rate', 'tax rate'),
    };
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
