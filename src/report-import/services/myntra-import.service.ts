import { BadRequestException, Injectable } from '@nestjs/common';
import { MyntraFileKind } from './file-parser.service';
import {
  getRowCell,
  MYNTRA_GSTR_ORDER_ID_ALIASES,
  MYNTRA_GSTR_RTO_ORDER_ID_ALIASES,
  MYNTRA_GSTR_RT_ORDER_ID_ALIASES,
  MYNTRA_MDIRECT_ORDER_ID_ALIASES,
  MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES,
  MYNTRA_SALES_ORDER_ID_ALIASES,
  MappingService,
  NormalizedImportRow,
  ParsedSheetRow,
  ColumnHeaderMap,
} from './mapping.service';
import { FileParserService } from './file-parser.service';
import { normalizeOrderKey } from '../utils/order-key.util';

type ParsedMyntraFile = {
  rows: ParsedSheetRow[];
  headers: string[];
};

export type MyntraBuildResult = {
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
  joinIssues?: {
    missingOrderIdInSales: number;
    missingInGstr: number;
    missingInMdirect: number;
    sampleSalesOrderCodes: string[];
    sampleGstrKeys: string[];
    sampleMdirectKeys: string[];
  };
};

/** Yield the Node.js event loop for one tick so HTTP requests can be served. */
const yieldEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Rows processed per event-loop yield during buildNormalizedRows. */
const YIELD_CHUNK = 2000;

@Injectable()
export class MyntraImportService {
  constructor(
    private readonly parser: FileParserService,
    private readonly mapping: MappingService,
  ) {}

  /**
   * Parse all 6 Myntra files, yielding the event loop between each parse
   * so the HTTP server stays responsive during heavy synchronous XLSX.read() calls.
   */
  async parseFiles(files: {
    gstrReportPackedFile: { buffer: Buffer; originalname: string };
    mDirectOrdersReportFile?: { buffer: Buffer; originalname: string };
    salesRevenuePackedB2cFile: { buffer: Buffer; originalname: string };
    gstrReportRtoFile: { buffer: Buffer; originalname: string };
    gstrReportRtFile: { buffer: Buffer; originalname: string };
    mDirectReturnsReportFile?: { buffer: Buffer; originalname: string };
  }): Promise<{
    gstrReportPacked: ParsedMyntraFile;
    mDirectOrders: ParsedMyntraFile;
    salesRevenueB2c: ParsedMyntraFile;
    gstrReportRto: ParsedMyntraFile;
    gstrReportRt: ParsedMyntraFile;
    mDirectReturns: ParsedMyntraFile;
  }> {
    const gstrReportPacked = this.parseOne('GSTR Report Packed', files.gstrReportPackedFile, 'gstrReportPacked');
    await yieldEventLoop();
    const mDirectOrders = files.mDirectOrdersReportFile
      ? this.parseOne('MDirect Orders Report', files.mDirectOrdersReportFile, 'mDirectOrders')
      : { rows: [], headers: [] };
    await yieldEventLoop();
    const salesRevenueB2c = this.parseOne('Sales Revenue Packed B2C', files.salesRevenuePackedB2cFile, 'salesRevenueB2c');
    await yieldEventLoop();
    const gstrReportRto = this.parseOne('GSTR Report RTO', files.gstrReportRtoFile, 'gstrReportRto');
    await yieldEventLoop();
    const gstrReportRt = this.parseOne('GSTR Report RT', files.gstrReportRtFile, 'gstrReportRt');
    await yieldEventLoop();
    const mDirectReturns = files.mDirectReturnsReportFile
      ? this.parseOne('MDirect Returns Report', files.mDirectReturnsReportFile, 'mDirectReturns')
      : { rows: [], headers: [] };
    return { gstrReportPacked, mDirectOrders, salesRevenueB2c, gstrReportRto, gstrReportRt, mDirectReturns };
  }

  private parseOne(
    reportLabel: string,
    file: { buffer: Buffer; originalname: string },
    kind: MyntraFileKind,
  ): ParsedMyntraFile {
    try {
      return this.parser.parseMyntraWorkbook(file.buffer, kind);
    } catch (error) {
      const detail =
        error instanceof BadRequestException
          ? error.message
          : 'Failed to read workbook';
      throw new BadRequestException(
        `${reportLabel} (${file.originalname}): ${detail}`,
      );
    }
  }

  /** Index each row under every non-empty order key column (supports cross-file id formats). */
  indexByOrderId(
    rows: ParsedSheetRow[],
    ...orderIdAliases: string[]
  ): Map<string, ParsedSheetRow> {
    const index = new Map<string, ParsedSheetRow>();
    rows.forEach((row) => {
      const keysOnRow = new Set<string>();
      orderIdAliases.forEach((alias) => {
        const raw = getRowCell(row, alias);
        const orderId = normalizeOrderKey(raw);
        if (!orderId || keysOnRow.has(orderId)) return;
        keysOnRow.add(orderId);
        if (!index.has(orderId)) {
          index.set(orderId, row);
        }
      });
    });
    return index;
  }

  indexOrderIds(rows: ParsedSheetRow[], ...orderIdAliases: string[]): Set<string> {
    const ids = new Set<string>();
    rows.forEach((row) => {
      orderIdAliases.forEach((alias) => {
        const orderId = normalizeOrderKey(getRowCell(row, alias));
        if (orderId) ids.add(orderId);
      });
    });
    return ids;
  }

  private sampleIndexKeys(index: Map<string, ParsedSheetRow>, limit = 3): string[] {
    return [...index.keys()].slice(0, limit);
  }

  /**
   * Join 6 parsed Myntra files into normalised import rows.
   *
   * Performance notes:
   * - Header→config maps are built ONCE per file (O(headers × aliases)), not per row.
   * - Each row is mapped in O(columns) using those maps — 56× faster than the old
   *   O(rows × headers × aliases × mappings) approach.
   * - Event loop is yielded every YIELD_CHUNK rows so HTTP status-check requests
   *   can be served while a large file is being processed.
   */
  async buildNormalizedRows(parsed: {
    gstrReportPacked: ParsedMyntraFile;
    mDirectOrders: ParsedMyntraFile;
    salesRevenueB2c: ParsedMyntraFile;
    gstrReportRto: ParsedMyntraFile;
    gstrReportRt: ParsedMyntraFile;
    mDirectReturns: ParsedMyntraFile;
  }): Promise<MyntraBuildResult> {
    const mDirectByOrder = this.indexByOrderId(
      parsed.mDirectOrders.rows,
      ...MYNTRA_MDIRECT_ORDER_ID_ALIASES,
    );
    const gstrByOrder = this.indexByOrderId(
      parsed.gstrReportPacked.rows,
      ...MYNTRA_GSTR_ORDER_ID_ALIASES,
    );
    const salesByOrder = this.indexByOrderId(
      parsed.salesRevenueB2c.rows,
      ...MYNTRA_SALES_ORDER_ID_ALIASES,
    );
    const mDirectReturnsByOrder = this.indexByOrderId(
      parsed.mDirectReturns.rows,
      ...MYNTRA_MDIRECT_RETURNS_ORDER_ID_ALIASES,
    );
    const rtoOrderIds = this.indexOrderIds(
      parsed.gstrReportRto.rows,
      ...MYNTRA_GSTR_RTO_ORDER_ID_ALIASES,
    );
    const rtOrderIds = this.indexOrderIds(
      parsed.gstrReportRt.rows,
      ...MYNTRA_GSTR_RT_ORDER_ID_ALIASES,
    );

    const gstrHeaderMap = this.mapping.buildMyntraGstrHeaderMap(parsed.gstrReportPacked.headers);
    const mdirectHeaderMap = this.mapping.buildMyntraMdirectHeaderMap(parsed.mDirectOrders.headers);
    const salesHeaderMap = this.mapping.buildMyntraSalesHeaderMap(parsed.salesRevenueB2c.headers);
    const returnsHeaderMap = this.mapping.buildMyntraMdirectReturnsHeaderMap(parsed.mDirectReturns.headers);

    const rows: MyntraBuildResult['rows'] = [];
    const errors: MyntraBuildResult['errors'] = [];
    let missingOrderIdInGstr = 0;
    let missingInSales = 0;
    let missingInMdirect = 0;
    let missingGstrForReturn = 0;

    const gstrRows = parsed.gstrReportPacked.rows;
    const mdirectOrdersProvided = parsed.mDirectOrders.rows.length > 0;
    const processedReturnOrders = new Set<string>();

    const pushRow = (
      mapped: NormalizedImportRow,
      sheetName: string,
      rowNumber: number,
    ) => {
      rows.push({
        ...mapped,
        __sheetName: sheetName,
        __rowNumber: rowNumber,
      });
    };

    // Phase 1 — every GSTR Report Packed row is a gross sale.
    for (let i = 0; i < gstrRows.length; i++) {
      const gstrRow = gstrRows[i];
      try {
        const orderIdRaw = getRowCell(gstrRow, ...MYNTRA_GSTR_ORDER_ID_ALIASES);
        const orderId = normalizeOrderKey(orderIdRaw);
        if (!orderId) {
          missingOrderIdInGstr += 1;
          continue;
        }

        const salesRow = salesByOrder.get(orderId);
        if (!salesRow) {
          missingInSales += 1;
        }

        const mDirectRow = mDirectByOrder.get(orderId);
        if (mdirectOrdersProvided && !mDirectRow) {
          missingInMdirect += 1;
          continue;
        }

        const mapped = this.mapRowFast(
          salesRow,
          gstrRow,
          mDirectRow,
          gstrHeaderMap,
          mdirectHeaderMap,
          salesHeaderMap,
          returnsHeaderMap,
          {
            documentType: 'SALE',
            mDirectReturnsRow: mDirectReturnsByOrder.get(orderId),
          },
        );
        pushRow(mapped, gstrRow.__sheetName, gstrRow.__rowNumber);
      } catch {
        errors.push({
          sheetName: gstrRow.__sheetName,
          rowNumber: gstrRow.__rowNumber,
          error: 'Failed to normalize Myntra GSTR packed row',
        });
      }

      if ((i + 1) % YIELD_CHUNK === 0) {
        await yieldEventLoop();
      }
    }

    // Phase 2 — GSTR Report RTO rows become separate return entries.
    for (let i = 0; i < parsed.gstrReportRto.rows.length; i++) {
      const rtoRow = parsed.gstrReportRto.rows[i];
      try {
        const orderId = normalizeOrderKey(
          getRowCell(rtoRow, ...MYNTRA_GSTR_RTO_ORDER_ID_ALIASES),
        );
        if (!orderId || processedReturnOrders.has(orderId)) continue;

        const gstrRow = gstrByOrder.get(orderId);
        if (!gstrRow) {
          missingGstrForReturn += 1;
          continue;
        }

        processedReturnOrders.add(orderId);
        const salesRow = salesByOrder.get(orderId);
        const mDirectRow = mDirectByOrder.get(orderId);
        const mapped = this.mapRowFast(
          salesRow,
          gstrRow,
          mDirectRow,
          gstrHeaderMap,
          mdirectHeaderMap,
          salesHeaderMap,
          returnsHeaderMap,
          {
            documentType: 'RTO Return',
            typeOfReturn: 'RTO Return',
            mDirectReturnsRow: mDirectReturnsByOrder.get(orderId),
          },
        );
        pushRow(mapped, rtoRow.__sheetName, rtoRow.__rowNumber);
      } catch {
        errors.push({
          sheetName: rtoRow.__sheetName,
          rowNumber: rtoRow.__rowNumber,
          error: 'Failed to normalize Myntra RTO return row',
        });
      }

      if ((i + 1) % YIELD_CHUNK === 0) {
        await yieldEventLoop();
      }
    }

    // Phase 3 — GSTR Report RT rows (customer returns), excluding RTO orders.
    for (let i = 0; i < parsed.gstrReportRt.rows.length; i++) {
      const rtRow = parsed.gstrReportRt.rows[i];
      try {
        const orderId = normalizeOrderKey(
          getRowCell(rtRow, ...MYNTRA_GSTR_RT_ORDER_ID_ALIASES),
        );
        if (!orderId || rtoOrderIds.has(orderId) || processedReturnOrders.has(orderId)) {
          continue;
        }

        const gstrRow = gstrByOrder.get(orderId);
        if (!gstrRow) {
          missingGstrForReturn += 1;
          continue;
        }

        processedReturnOrders.add(orderId);
        const salesRow = salesByOrder.get(orderId);
        const mDirectRow = mDirectByOrder.get(orderId);
        const mapped = this.mapRowFast(
          salesRow,
          gstrRow,
          mDirectRow,
          gstrHeaderMap,
          mdirectHeaderMap,
          salesHeaderMap,
          returnsHeaderMap,
          {
            documentType: 'Customer Return',
            typeOfReturn: 'Customer Return',
            mDirectReturnsRow: mDirectReturnsByOrder.get(orderId),
          },
        );
        pushRow(mapped, rtRow.__sheetName, rtRow.__rowNumber);
      } catch {
        errors.push({
          sheetName: rtRow.__sheetName,
          rowNumber: rtRow.__rowNumber,
          error: 'Failed to normalize Myntra customer return row',
        });
      }

      if ((i + 1) % YIELD_CHUNK === 0) {
        await yieldEventLoop();
      }
    }

    const joinIssues =
      missingOrderIdInGstr ||
      missingInSales ||
      missingInMdirect ||
      missingGstrForReturn
        ? {
            missingOrderIdInSales: missingOrderIdInGstr,
            missingInGstr: missingGstrForReturn,
            missingInMdirect,
            sampleSalesOrderCodes: this.sampleIndexKeys(salesByOrder),
            sampleGstrKeys: this.sampleIndexKeys(gstrByOrder),
            sampleMdirectKeys: this.sampleIndexKeys(mDirectByOrder),
          }
        : undefined;

    // eslint-disable-next-line no-console
    console.log(
      `[MYNTRA_BUILD] gstr=${gstrRows.length} sales=${parsed.salesRevenueB2c.rows.length} built=${rows.length} missingGstrId=${missingOrderIdInGstr} missingSales=${missingInSales} missingMdirect=${missingInMdirect} missingGstrForReturn=${missingGstrForReturn} rto=${rtoOrderIds.size} rt=${rtOrderIds.size}`,
    );

    return { rows, errors, joinIssues };
  }

  /**
   * Map one combined Myntra row using pre-built header maps — O(cols) per row.
   * Primary fields come from GSTR Packed; SKU from MDirect; invoice no/date from Sales Revenue.
   */
  private mapRowFast(
    salesRow: ParsedSheetRow | undefined,
    gstrRow: ParsedSheetRow,
    mDirectRow: ParsedSheetRow | undefined,
    gstrHeaderMap: ColumnHeaderMap,
    mdirectHeaderMap: ColumnHeaderMap,
    salesHeaderMap: ColumnHeaderMap,
    returnsHeaderMap: ColumnHeaderMap,
    options?: {
      documentType?: string;
      typeOfReturn?: string;
      mDirectReturnsRow?: ParsedSheetRow;
    },
  ): NormalizedImportRow {
    const base = this.mapping.mapRowFast(gstrRow, 'sales', gstrHeaderMap);

    if (mDirectRow) {
      const mdirectMapped = this.mapping.mapRowFast(mDirectRow, 'sales', mdirectHeaderMap);
      if (mdirectMapped.skuID) base.skuID = mdirectMapped.skuID;
    }

    if (salesRow) {
      const salesMapped = this.mapping.mapRowFast(salesRow, 'sales', salesHeaderMap);
      if (salesMapped.orderID) base.orderID = salesMapped.orderID;
      if (salesMapped.invoiceNo) base.invoiceNo = salesMapped.invoiceNo;
      if (salesMapped.invoiceDate) base.invoiceDate = salesMapped.invoiceDate;
    }

    base.documentType = options?.documentType ?? 'SALE';
    if (options?.typeOfReturn) {
      base.typeOfReturn = options.typeOfReturn;
    } else {
      delete base.typeOfReturn;
    }

    if (options?.mDirectReturnsRow) {
      const returnsMapped = this.mapping.mapRowFast(
        options.mDirectReturnsRow,
        'sales',
        returnsHeaderMap,
      );
      if (returnsMapped.returnReason) base.returnReason = returnsMapped.returnReason;
      if (returnsMapped.detailedReturnReason) {
        base.detailedReturnReason = returnsMapped.detailedReturnReason;
      }
    }

    return base;
  }
}
