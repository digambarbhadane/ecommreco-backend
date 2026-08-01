import { BadRequestException, Injectable } from '@nestjs/common';
import { FileParserService } from '../../services/file-parser.service';
import type { ParsedSheetRow } from '../../services/mapping.service';
import {
  buildOrderPaymentsColumnFieldMap,
  isMeeshoOrderPaymentsRowEmpty,
  mapMeeshoOrderPaymentsIndexedRow,
  mappedOrderPaymentsToEnrichmentRow,
  type MeeshoOrderPaymentsMappedRow,
} from './meesho-payment-order.mapper';
import {
  isMeeshoSecondaryRowEmpty,
  mapMeeshoSecondarySheetRow,
} from './meesho-payment-secondary.mapper';
import type { MeeshoPaymentSheetKind } from './meesho-payment-sheet-kinds';

export type MeeshoPaymentParsedSheet = {
  kind: MeeshoPaymentSheetKind;
  sheetName: string;
  headers: string[];
  rows: ParsedSheetRow[];
  indexedRows?: unknown[][];
};

export type MeeshoPaymentParseResult = {
  sheets: MeeshoPaymentParsedSheet[];
  orderPayments: MeeshoOrderPaymentsMappedRow[];
  orderPaymentRawRows: ParsedSheetRow[];
  secondary: {
    kind: Exclude<MeeshoPaymentSheetKind, 'orderPayments'>;
    sheetName: string;
    rows: Record<string, string | number | Date | null>[];
    skipped: number;
  }[];
  skippedBySheet: Record<MeeshoPaymentSheetKind, number>;
};

@Injectable()
export class MeeshoPaymentParser {
  constructor(private readonly fileParser: FileParserService) {}

  parse(buffer: Buffer): MeeshoPaymentParseResult {
    const workbook = this.fileParser.parseMeeshoPaymentAllSheetsWorkbook(buffer);

    const skippedBySheet: Record<MeeshoPaymentSheetKind, number> = {
      orderPayments: 0,
      adsCost: 0,
      referralPayments: 0,
      compensationRecovery: 0,
    };

    const orderSheet = workbook.sheets.find((s) => s.kind === 'orderPayments');
    if (!orderSheet) {
      throw new BadRequestException(
        "Required sheet 'Order Payments' not found.",
      );
    }

    const colFieldMap = buildOrderPaymentsColumnFieldMap(orderSheet.headers);
    const orderPayments: MeeshoOrderPaymentsMappedRow[] = [];
    const orderPaymentRawRows: ParsedSheetRow[] = [];
    const indexedRows = orderSheet.indexedRows ?? [];

    indexedRows.forEach((cells, index) => {
      const mapped = mapMeeshoOrderPaymentsIndexedRow(cells, colFieldMap);
      if (isMeeshoOrderPaymentsRowEmpty(mapped)) {
        skippedBySheet.orderPayments += 1;
        return;
      }
      orderPayments.push(mapped);
      orderPaymentRawRows.push(
        mappedOrderPaymentsToEnrichmentRow(
          mapped,
          orderSheet.sheetName,
          index + 4,
        ),
      );
    });

    const secondary = workbook.sheets
      .filter(
        (sheet): sheet is MeeshoPaymentParsedSheet & {
          kind: Exclude<MeeshoPaymentSheetKind, 'orderPayments'>;
        } => sheet.kind !== 'orderPayments',
      )
      .map((sheet) => {
        const rows: Record<string, string | number | Date | null>[] = [];
        let skipped = 0;
        for (const rawRow of sheet.rows) {
          const mapped = mapMeeshoSecondarySheetRow(sheet.kind, rawRow);
          if (isMeeshoSecondaryRowEmpty(mapped)) {
            skipped += 1;
            skippedBySheet[sheet.kind] += 1;
            continue;
          }
          rows.push(mapped);
        }
        return {
          kind: sheet.kind,
          sheetName: sheet.sheetName,
          rows,
          skipped,
        };
      });

    return {
      sheets: workbook.sheets,
      orderPayments,
      orderPaymentRawRows,
      secondary,
      skippedBySheet,
    };
  }
}
