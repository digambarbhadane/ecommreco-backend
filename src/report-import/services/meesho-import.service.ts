import { Injectable } from '@nestjs/common';
import {
  getRowCell,
  MEESHO_ORDER_ID_ALIASES,
  MappingService,
  NormalizedImportRow,
  ParsedSheetRow,
} from './mapping.service';
import { FileParserService } from './file-parser.service';
import { classifyMeeshoImportRow } from '../utils/meesho-analytics.util';

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
    tcsSalesFile?: { buffer: Buffer; originalname: string };
    tcsSalesReturnFile?: { buffer: Buffer; originalname: string };
    orderReportFile?: { buffer: Buffer; originalname: string };
    returnInTransitReportFile?: { buffer: Buffer; originalname: string };
    returnOutForDeliveryReportFile?: { buffer: Buffer; originalname: string };
    returnDeliveryCompleteReportFile?: { buffer: Buffer; originalname: string };
  }) {
    const empty: ParsedMeeshoFile = { rows: [], headers: [] };
    const parseLifecycle = (
      file: { buffer: Buffer; originalname: string } | undefined,
      kind:
        | 'returnInTransit'
        | 'returnOutForDelivery'
        | 'returnDeliveryComplete',
    ) =>
      file ? this.parser.parseMeeshoWorkbook(file.buffer, kind) : empty;

    return {
      tcsSales: files.tcsSalesFile
        ? this.parser.parseMeeshoWorkbook(files.tcsSalesFile.buffer, 'tcsSales')
        : empty,
      tcsSalesReturn: files.tcsSalesReturnFile
        ? this.parser.parseMeeshoWorkbook(
            files.tcsSalesReturnFile.buffer,
            'tcsSalesReturn',
          )
        : empty,
      orderReport: files.orderReportFile
        ? this.parser.parseMeeshoWorkbook(
            files.orderReportFile.buffer,
            'orderReport',
          )
        : empty,
      returnInTransit: parseLifecycle(
        files.returnInTransitReportFile,
        'returnInTransit',
      ),
      returnOutForDelivery: parseLifecycle(
        files.returnOutForDeliveryReportFile,
        'returnOutForDelivery',
      ),
      returnDeliveryComplete: parseLifecycle(
        files.returnDeliveryCompleteReportFile,
        'returnDeliveryComplete',
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
   * Process TCS Sales Report first, then enrich each order from the other files.
   * Only TCS Sales rows are persisted (one DB row per sales line).
   */
  parsePaymentFile(file: { buffer: Buffer; originalname: string }) {
    return this.parser.parseMeeshoPaymentWorkbook(file.buffer);
  }

  private enrichLifecycleReturnReports(
    mapped: NormalizedImportRow,
    orderId: string,
    indexes: {
      returnInTransit: Map<string, ParsedSheetRow>;
      returnOutForDelivery: Map<string, ParsedSheetRow>;
      returnDeliveryComplete: Map<string, ParsedSheetRow>;
    },
  ): NormalizedImportRow {
    if (!mapped.meeshoHasTcsReturn) return mapped;

    let enriched = mapped;
    const lifecycleRows = [
      indexes.returnInTransit.get(orderId),
      indexes.returnOutForDelivery.get(orderId),
      indexes.returnDeliveryComplete.get(orderId),
    ];
    for (const lifecycleRow of lifecycleRows) {
      enriched = this.mapping.enrichMeeshoFromLifecycleReturnReport(
        enriched,
        lifecycleRow,
      );
    }
    return enriched;
  }

  buildNormalizedRows(
    parsed: {
      tcsSales: ParsedMeeshoFile;
      tcsSalesReturn: ParsedMeeshoFile;
      orderReport: ParsedMeeshoFile;
      returnInTransit: ParsedMeeshoFile;
      returnOutForDelivery: ParsedMeeshoFile;
      returnDeliveryComplete: ParsedMeeshoFile;
    },
    sellerState?: string,
    paymentRows?: ParsedSheetRow[],
    _reportMonth?: string,
  ): MeeshoBuildResult {
    const orderReportByOrder = this.indexBySubOrderNum(parsed.orderReport.rows);
    const tcsReturnByOrder = this.indexBySubOrderNum(parsed.tcsSalesReturn.rows);
    const lifecycleIndexes = {
      returnInTransit: this.indexBySubOrderNum(parsed.returnInTransit.rows),
      returnOutForDelivery: this.indexBySubOrderNum(
        parsed.returnOutForDelivery.rows,
      ),
      returnDeliveryComplete: this.indexBySubOrderNum(
        parsed.returnDeliveryComplete.rows,
      ),
    };
    const paymentByOrder = paymentRows?.length
      ? this.indexBySubOrderNum(paymentRows)
      : null;

    const rows: MeeshoBuildResult['rows'] = [];
    const errors: MeeshoBuildResult['errors'] = [];

    parsed.tcsSales.rows.forEach((salesRow) => {
      try {
        const orderIdRaw = getRowCell(salesRow, ...MEESHO_ORDER_ID_ALIASES);
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
        mapped = this.enrichLifecycleReturnReports(
          mapped,
          orderId,
          lifecycleIndexes,
        );
        if (paymentByOrder) {
          mapped = this.mapping.enrichMeeshoFromPaymentReport(
            mapped,
            paymentByOrder.get(orderId),
          );
        }

        const classification = classifyMeeshoImportRow(mapped);
        mapped.meeshoIsGrossSale = classification.meeshoIsGrossSale;
        mapped.meeshoIsPreviousMonthReturn = classification.meeshoIsPreviousMonthReturn;
        mapped.meeshoHasTcsReturn = classification.meeshoHasTcsReturn;
        mapped.meeshoReturnSubType = classification.meeshoReturnSubType;

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
