import { Injectable } from '@nestjs/common';
import {
  getRowCell,
  MEESHO_ORDER_ID_ALIASES,
  MappingService,
  NormalizedImportRow,
  ParsedSheetRow,
} from './mapping.service';
import { FileParserService } from './file-parser.service';

type ParsedMeeshoFile = {
  rows: ParsedSheetRow[];
  headers: string[];
};

export type MeeshoBuildResult = {
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
};

@Injectable()
export class MeeshoImportService {
  constructor(
    private readonly parser: FileParserService,
    private readonly mapping: MappingService,
  ) {}

  parseFiles(files: {
    tcsSalesFile: { buffer: Buffer; originalname: string };
    tcsSalesReturnFile: { buffer: Buffer; originalname: string };
    orderReportFile: { buffer: Buffer; originalname: string };
    returnReportFile: { buffer: Buffer; originalname: string };
  }) {
    return {
      tcsSales: this.parser.parseMeeshoWorkbook(files.tcsSalesFile.buffer),
      tcsSalesReturn: this.parser.parseMeeshoWorkbook(
        files.tcsSalesReturnFile.buffer,
      ),
      orderReport: this.parser.parseMeeshoWorkbook(files.orderReportFile.buffer),
      returnReport: this.parser.parseMeeshoWorkbook(
        files.returnReportFile.buffer,
      ),
    };
  }

  /** Index rows by order id column (sub_order_num / Sub Order No / Order ID). */
  indexBySubOrderNum(rows: ParsedSheetRow[]): Map<string, ParsedSheetRow> {
    const index = new Map<string, ParsedSheetRow>();
    rows.forEach((row) => {
      const raw = getRowCell(row, ...MEESHO_ORDER_ID_ALIASES);
      const orderId =
        typeof raw === 'string' || typeof raw === 'number'
          ? String(raw).trim()
          : '';
      if (!orderId) return;
      index.set(orderId, row);
    });
    return index;
  }

  /**
   * Process TCS Sales Report first, then enrich each order from the other three files.
   * Only TCS Sales rows are persisted (one DB row per sales line).
   */
  buildNormalizedRows(
    parsed: {
      tcsSales: ParsedMeeshoFile;
      tcsSalesReturn: ParsedMeeshoFile;
      orderReport: ParsedMeeshoFile;
      returnReport: ParsedMeeshoFile;
    },
    sellerState?: string,
  ): MeeshoBuildResult {
    const orderReportByOrder = this.indexBySubOrderNum(parsed.orderReport.rows);
    const tcsReturnByOrder = this.indexBySubOrderNum(parsed.tcsSalesReturn.rows);
    const returnReportByOrder = this.indexBySubOrderNum(parsed.returnReport.rows);

    const rows: MeeshoBuildResult['rows'] = [];
    const errors: MeeshoBuildResult['errors'] = [];

    parsed.tcsSales.rows.forEach((salesRow) => {
      try {
        const orderIdRaw = getRowCell(salesRow, 'sub_order_num', 'Order ID');
        const orderId =
          typeof orderIdRaw === 'string' || typeof orderIdRaw === 'number'
            ? String(orderIdRaw).trim()
            : '';
        if (!orderId) {
          errors.push({
            sheetName: salesRow.__sheetName,
            rowNumber: salesRow.__rowNumber,
            error: 'Missing order id (sub_order_num / Sub Order No) in TCS Sales Report row',
          });
          return;
        }

        let mapped = this.mapping.mapMeeshoTcsSalesRow(salesRow, sellerState);
        mapped = this.mapping.enrichMeeshoFromOrderReport(
          mapped,
          orderReportByOrder.get(orderId),
        );
        mapped = this.mapping.enrichMeeshoFromTcsSalesReturn(
          mapped,
          tcsReturnByOrder.get(orderId),
        );
        mapped = this.mapping.enrichMeeshoFromReturnReport(
          mapped,
          returnReportByOrder.get(orderId),
        );

        rows.push({
          ...mapped,
          __sheetName: salesRow.__sheetName,
          __rowNumber: salesRow.__rowNumber,
        });
      } catch {
        errors.push({
          sheetName: salesRow.__sheetName,
          rowNumber: salesRow.__rowNumber,
          error: 'Failed to normalize Meesho TCS Sales row',
        });
      }
    });

    return { rows, errors };
  }
}
