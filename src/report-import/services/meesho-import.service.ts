import { Injectable } from '@nestjs/common';
import {
  getRowCell,
  MEESHO_ORDER_ID_ALIASES,
  MappingService,
  NormalizedImportRow,
  ParsedSheetRow,
} from './mapping.service';
import { FileParserService } from './file-parser.service';
import {
  classifyMeeshoImportRow,
  classifyMeeshoReturnSubType,
  MeeshoReturnSubType,
  resolveMeeshoReturnSubType,
} from '../utils/meesho-analytics.util';

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

  private normalizeOrderId(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (Number.isInteger(raw)) return String(raw);
      return String(raw).replace(/\.0+$/, '');
    }
    let value = String(raw).trim();
    if (!value) return '';
    value = value.replace(/^['"]+|['"]+$/g, '');
    value = value.replace(/\s+/g, '');
    value = value.replace(/\.0+$/, '');
    return value.toUpperCase();
  }

  private orderIdVariants(raw: unknown): string[] {
    const normalized = this.normalizeOrderId(raw);
    if (!normalized) return [];
    const variants = [normalized];
    const strippedSuffix = normalized.replace(/[_-]\d+$/, '');
    if (strippedSuffix && strippedSuffix !== normalized) {
      variants.push(strippedSuffix);
    }
    return variants;
  }

  async parseFiles(files: {
    tcsSalesFile?: { buffer: Buffer; originalname: string };
    tcsSalesReturnFile?: { buffer: Buffer; originalname: string };
    orderReportFile?: { buffer: Buffer; originalname: string };
    returnInTransitReportFile?: { buffer: Buffer; originalname: string };
    returnOutForDeliveryReportFile?: { buffer: Buffer; originalname: string };
    returnDeliveryCompleteReportFile?: { buffer: Buffer; originalname: string };
  }) {
    const empty: ParsedMeeshoFile = { rows: [], headers: [] };
    const yieldToEventLoop = () =>
      new Promise<void>((resolve) => setImmediate(resolve));
    const parseLifecycle = async (
      file: { buffer: Buffer; originalname: string } | undefined,
      kind:
        | 'returnInTransit'
        | 'returnOutForDelivery'
        | 'returnDeliveryComplete',
    ) => {
      if (!file) return empty;
      await yieldToEventLoop();
      return this.parser.parseMeeshoWorkbook(file.buffer, kind);
    };

    await yieldToEventLoop();
    const tcsSales = files.tcsSalesFile
      ? this.parser.parseMeeshoWorkbook(files.tcsSalesFile.buffer, 'tcsSales')
      : empty;
    await yieldToEventLoop();
    const tcsSalesReturn = files.tcsSalesReturnFile
      ? this.parser.parseMeeshoWorkbook(
          files.tcsSalesReturnFile.buffer,
          'tcsSalesReturn',
        )
      : empty;
    await yieldToEventLoop();
    const orderReport = files.orderReportFile
      ? this.parser.parseMeeshoWorkbook(
          files.orderReportFile.buffer,
          'orderReport',
        )
      : empty;

    return {
      tcsSales,
      tcsSalesReturn,
      orderReport,
      returnInTransit: await parseLifecycle(
        files.returnInTransitReportFile,
        'returnInTransit',
      ),
      returnOutForDelivery: await parseLifecycle(
        files.returnOutForDeliveryReportFile,
        'returnOutForDelivery',
      ),
      returnDeliveryComplete: await parseLifecycle(
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
      const variants = this.orderIdVariants(raw);
      if (!variants.length) return;
      for (const orderId of variants) {
        if (!index.has(orderId)) {
          index.set(orderId, row);
        }
      }
    });
    return index;
  }

  /** Index rows by order id preserving all matches (across lifecycle sheets). */
  indexManyBySubOrderNum(rows: ParsedSheetRow[]): Map<string, ParsedSheetRow[]> {
    const index = new Map<string, ParsedSheetRow[]>();
    rows.forEach((row) => {
      const raw = getRowCell(row, ...MEESHO_ORDER_ID_ALIASES);
      const variants = this.orderIdVariants(raw);
      if (!variants.length) return;
      for (const orderId of variants) {
        const existing = index.get(orderId);
        if (existing) {
          existing.push(row);
        } else {
          index.set(orderId, [row]);
        }
      }
    });
    return index;
  }

  /**
   * TCS Sales rows are the imported-data base (one row per sales line).
   * TCS Sales Return rows are persisted separately for return summary metrics.
   */
  parsePaymentFile(file: { buffer: Buffer; originalname: string }) {
    return this.parser.parseMeeshoPaymentWorkbook(file.buffer);
  }

  private enrichLifecycleReturnReports(
    mapped: NormalizedImportRow,
    salesOrderIdRaw: unknown,
    indexes: {
      returnInTransit: Map<string, ParsedSheetRow[]>;
      returnOutForDelivery: Map<string, ParsedSheetRow[]>;
      returnDeliveryComplete: Map<string, ParsedSheetRow[]>;
    },
  ): NormalizedImportRow {
    let enriched = mapped;
    const variants = this.orderIdVariants(salesOrderIdRaw);
    const lifecycleRows = [
      ...variants.flatMap((orderId) => indexes.returnInTransit.get(orderId) ?? []),
      ...variants.flatMap((orderId) => indexes.returnOutForDelivery.get(orderId) ?? []),
      ...variants.flatMap((orderId) => indexes.returnDeliveryComplete.get(orderId) ?? []),
    ];
    for (const lifecycleRow of lifecycleRows) {
      enriched = this.mapping.enrichMeeshoFromLifecycleReturnReport(
        enriched,
        lifecycleRow,
      );
    }
    const lifecycleSubTypes = lifecycleRows
      .map((row) =>
        classifyMeeshoReturnSubType(
          String(getRowCell(row, 'Type of Return', 'Return Type') ?? ''),
          String(getRowCell(row, 'Sub Type') ?? ''),
        ),
      )
      .filter(
        (subType): subType is Exclude<MeeshoReturnSubType, 'na'> =>
          Boolean(subType) && subType !== 'na',
      );

    if (lifecycleSubTypes.includes('rto')) {
      enriched.meeshoReturnSubType = 'rto';
    } else if (lifecycleSubTypes.includes('customer_return')) {
      enriched.meeshoReturnSubType = 'customer_return';
    } else if (lifecycleSubTypes.includes('cancellation')) {
      enriched.meeshoReturnSubType = 'cancellation';
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
      returnInTransit: this.indexManyBySubOrderNum(parsed.returnInTransit.rows),
      returnOutForDelivery: this.indexManyBySubOrderNum(
        parsed.returnOutForDelivery.rows,
      ),
      returnDeliveryComplete: this.indexManyBySubOrderNum(
        parsed.returnDeliveryComplete.rows,
      ),
    };
    const paymentByOrder = paymentRows?.length
      ? this.indexBySubOrderNum(paymentRows)
      : null;

    const rows: MeeshoBuildResult['rows'] = [];
    const errors: MeeshoBuildResult['errors'] = [];

    const finalizeSalesAndPush = (
      mapped: NormalizedImportRow,
      sourceRow: ParsedSheetRow,
    ) => {
      mapped.meeshoIsGrossSale = true;
      mapped.meeshoHasTcsReturn = Boolean(
        mapped.returnInvoiceDate || mapped.meeshoHasTcsReturn,
      );
      mapped.meeshoReturnSubType = undefined;
      mapped.meeshoIsPreviousMonthReturn = false;

      rows.push({
        ...mapped,
        __sheetName: sourceRow.__sheetName,
        __rowNumber: sourceRow.__rowNumber,
      });
    };

    const finalizeReturnAndPush = (
      mapped: NormalizedImportRow,
      sourceRow: ParsedSheetRow,
      tcsReturnTypeOfReturn?: string,
      tcsReturnSubType?: string,
    ) => {
      mapped.meeshoIsGrossSale = false;
      mapped.meeshoHasTcsReturn = true;

      const subType = resolveMeeshoReturnSubType({
        ...mapped,
        tcsReturnTypeOfReturn,
        tcsReturnSubType,
        isReturnDocument: true,
        meeshoHasTcsReturn: true,
      });
      mapped.meeshoReturnSubType = subType;
      mapped.meeshoIsPreviousMonthReturn = subType === 'na';

      rows.push({
        ...mapped,
        __sheetName: sourceRow.__sheetName,
        __rowNumber: sourceRow.__rowNumber,
      });
    };

    parsed.tcsSales.rows.forEach((salesRow) => {
      try {
        const orderIdRaw = getRowCell(salesRow, ...MEESHO_ORDER_ID_ALIASES);
        const orderId = this.normalizeOrderId(orderIdRaw);
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
          sellerState,
        );
        mapped = this.enrichLifecycleReturnReports(
          mapped,
          orderIdRaw,
          lifecycleIndexes,
        );
        if (paymentByOrder) {
          mapped = this.mapping.enrichMeeshoFromPaymentReport(
            mapped,
            paymentByOrder.get(orderId),
          );
        }
        finalizeSalesAndPush(mapped, salesRow);
      } catch {
        errors.push({
          sheetName: salesRow.__sheetName,
          rowNumber: salesRow.__rowNumber,
          error: 'Failed to normalize Meesho TCS Sales row',
        });
      }
    });

    parsed.tcsSalesReturn.rows.forEach((returnRow) => {
      try {
        const orderIdRaw = getRowCell(returnRow, ...MEESHO_ORDER_ID_ALIASES);
        const orderId = this.normalizeOrderId(orderIdRaw);
        if (!orderId) {
          errors.push({
            sheetName: returnRow.__sheetName,
            rowNumber: returnRow.__rowNumber,
            error: 'Missing order id (sub_order_num / Sub Order No) in TCS Sales Return row',
          });
          return;
        }

        let mapped = this.mapping.mapMeeshoTcsReturnRow(returnRow, sellerState);
        const tcsReturnTypeOfReturn = mapped.typeOfReturn;
        const tcsReturnSubType = mapped.subType;

        mapped = this.mapping.enrichMeeshoFromOrderReport(
          mapped,
          orderReportByOrder.get(orderId),
        );
        mapped = this.mapping.enrichMeeshoFromTcsSalesReturn(
          mapped,
          returnRow,
          sellerState,
        );
        mapped = this.enrichLifecycleReturnReports(
          mapped,
          orderIdRaw,
          lifecycleIndexes,
        );
        if (paymentByOrder) {
          mapped = this.mapping.enrichMeeshoFromPaymentReport(
            mapped,
            paymentByOrder.get(orderId),
          );
        }

        finalizeReturnAndPush(
          mapped,
          returnRow,
          tcsReturnTypeOfReturn,
          tcsReturnSubType,
        );
      } catch {
        errors.push({
          sheetName: returnRow.__sheetName,
          rowNumber: returnRow.__rowNumber,
          error: 'Failed to normalize Meesho TCS Sales Return row',
        });
      }
    });

    return { rows, errors };
  }
}
