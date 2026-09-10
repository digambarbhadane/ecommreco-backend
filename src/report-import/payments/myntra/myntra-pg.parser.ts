import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { headerMatchesExcelColumn } from '../../config/importMappings/gst-column.util';
import { MYNTRA_PG_FORWARD_REQUIRED_HEADER_GROUPS } from '../../config/importMappings/myntra-pg-forward.mapping';
import { MYNTRA_PG_REVERSE_REQUIRED_HEADER_GROUPS } from '../../config/importMappings/myntra-pg-reverse.mapping';
import {
  buildMyntraPgRowKey,
  buildTypedMyntraPgReverseRowData,
  mapRawRowToMyntraPgRowData,
  normalizeMyntraPgFieldKey,
  pickDate,
  pickNumber,
  pickString,
  promoteMyntraPgReverseTopLevelFields,
  rowHasMeaningfulData,
} from './myntra-pg-field.util';
import type {
  MyntraPgParseResult,
  MyntraPgReportKind,
} from './myntra-pg.types';

@Injectable()
export class MyntraPgParser {
  parse(
    buffer: Buffer,
    reportKind: MyntraPgReportKind,
    uploadedFileName: string,
  ): MyntraPgParseResult {
    void uploadedFileName;
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        raw: true,
      });
    } catch (error) {
      throw new BadRequestException(
        `Could not read Myntra PG ${reportKind === 'forward' ? 'Forward' : 'Reverse'} Settled report: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException(
        `Myntra PG ${reportKind === 'forward' ? 'Forward' : 'Reverse'} Settled report contains no sheets`,
      );
    }

    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    if (!matrix.length) {
      throw new BadRequestException(
        `Myntra PG ${reportKind === 'forward' ? 'Forward' : 'Reverse'} Settled report is empty`,
      );
    }

    const headerRowIndex = this.detectHeaderRowIndex(matrix);
    const rawHeaders = (matrix[headerRowIndex] ?? []).map((cell) =>
      String(cell ?? ''),
    );
    const headers = rawHeaders.filter((header) => header.trim().length > 0);
    const fieldKeys = headers.map((header) =>
      normalizeMyntraPgFieldKey(header),
    );

    if (reportKind === 'forward') {
      this.validateRequiredHeaders(
        headers,
        MYNTRA_PG_FORWARD_REQUIRED_HEADER_GROUPS,
        'Forward',
      );
    } else {
      this.validateRequiredHeaders(
        headers,
        MYNTRA_PG_REVERSE_REQUIRED_HEADER_GROUPS,
        'Reverse',
      );
    }

    const rows: MyntraPgParseResult['rows'] = [];
    const validationErrors: string[] = [];
    let blankRows = 0;
    let invalidRowCount = 0;

    for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
      const cells = Array.isArray(matrix[index]) ? matrix[index] : [];
      const sourceRowNumber = index + 1;
      const rawRowData = mapRawRowToMyntraPgRowData(rawHeaders, cells);
      const rowData =
        reportKind === 'reverse'
          ? buildTypedMyntraPgReverseRowData(rawRowData)
          : rawRowData;
      if (!rowHasMeaningfulData(rowData)) {
        blankRows += 1;
        continue;
      }

      const orderReleaseId = pickString(
        rowData,
        'order_release_id',
        'seller_order_id',
      );
      const orderLineId = pickString(rowData, 'order_line_id');
      const returnId = pickString(rowData, 'return_id');
      if (reportKind === 'forward' && !orderReleaseId && !orderLineId) {
        invalidRowCount += 1;
        validationErrors.push(
          `Row ${sourceRowNumber}: missing order_release_id or order_line_id`,
        );
        continue;
      }
      if (
        reportKind === 'reverse' &&
        !orderReleaseId &&
        !orderLineId &&
        !returnId
      ) {
        invalidRowCount += 1;
        validationErrors.push(
          `Row ${sourceRowNumber}: missing order_release_id, order_line_id, or return_id`,
        );
        continue;
      }

      const reverseTopLevel =
        reportKind === 'reverse'
          ? promoteMyntraPgReverseTopLevelFields(rowData)
          : {};

      rows.push({
        reportKind,
        sourceRowNumber,
        rowKey: buildMyntraPgRowKey(reportKind, rowData, sourceRowNumber),
        orderReleaseId,
        orderLineId,
        sellerOrderId: pickString(
          rowData,
          'seller_order_id',
          'order_release_id',
        ),
        skuCode: pickString(rowData, 'sku_code'),
        sellerGstn: pickString(rowData, 'seller_gstn'),
        returnType: pickString(rowData, 'return_type'),
        totalActualSettlement: pickNumber(
          rowData,
          'total_actual_settlement',
          'total_expected_settlement',
        ),
        totalExpectedSettlement: pickNumber(
          rowData,
          'total_settlement',
          'total_expected_settlement',
        ),
        settlementDate: pickDate(
          rowData,
          'settlement_date_postpaid_payment',
          'settlement_date_prepaid_payment',
          'return_date',
          'delivery_date',
          'packing_date',
        ),
        rowData,
        ...reverseTopLevel,
      });
    }

    return {
      rows,
      headers,
      fieldKeys,
      totalRawRows: Math.max(0, matrix.length - headerRowIndex - 1),
      blankRows,
      invalidRowCount,
      validationErrors,
      sheetName,
    };
  }

  private detectHeaderRowIndex(matrix: unknown[][]): number {
    const scanLimit = Math.min(matrix.length, 15);
    let bestIndex = 0;
    let bestScore = -1;
    for (let index = 0; index < scanLimit; index += 1) {
      const cells = Array.isArray(matrix[index]) ? matrix[index] : [];
      const normalized = cells
        .map((cell) => normalizeMyntraPgFieldKey(String(cell ?? '')))
        .filter(Boolean);
      if (!normalized.length) continue;
      const score = normalized.reduce((acc, cell) => {
        if (cell.includes('order_release') || cell === 'order_release_id')
          return acc + 3;
        if (cell.includes('seller_gstn') || cell.includes('sku_code'))
          return acc + 2;
        if (cell.includes('settlement') || cell.includes('return_type'))
          return acc + 1;
        return acc;
      }, 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  private validateRequiredHeaders(
    headers: string[],
    requiredGroups: ReadonlyArray<readonly string[]>,
    label: 'Forward' | 'Reverse',
  ) {
    const missing = requiredGroups.filter((aliases) => {
      const hit = headers.some((header) =>
        aliases.some((alias) => headerMatchesExcelColumn(header, alias)),
      );
      return !hit;
    });
    if (missing.length) {
      throw new BadRequestException(
        `Myntra PG ${label} Settled report is missing required columns: ${missing
          .map((aliases) => aliases[0])
          .join(', ')}`,
      );
    }
  }
}
