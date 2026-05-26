import { BadRequestException, Injectable } from '@nestjs/common';
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
} from './mapping.service';
import { FileParserService } from './file-parser.service';

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
};

@Injectable()
export class MyntraImportService {
  constructor(
    private readonly parser: FileParserService,
    private readonly mapping: MappingService,
  ) {}

  parseFiles(files: {
    gstrReportPackedFile: { buffer: Buffer; originalname: string };
    mDirectOrdersReportFile: { buffer: Buffer; originalname: string };
    salesRevenuePackedB2cFile: { buffer: Buffer; originalname: string };
    gstrReportRtoFile: { buffer: Buffer; originalname: string };
    gstrReportRtFile: { buffer: Buffer; originalname: string };
    mDirectReturnsReportFile: { buffer: Buffer; originalname: string };
  }) {
    return {
      gstrReportPacked: this.parser.parseMeeshoWorkbook(
        files.gstrReportPackedFile.buffer,
      ),
      mDirectOrders: this.parser.parseMeeshoWorkbook(
        files.mDirectOrdersReportFile.buffer,
      ),
      salesRevenueB2c: this.parser.parseMeeshoWorkbook(
        files.salesRevenuePackedB2cFile.buffer,
      ),
      gstrReportRto: this.parser.parseMeeshoWorkbook(
        files.gstrReportRtoFile.buffer,
      ),
      gstrReportRt: this.parser.parseMeeshoWorkbook(files.gstrReportRtFile.buffer),
      mDirectReturns: this.parser.parseMeeshoWorkbook(
        files.mDirectReturnsReportFile.buffer,
      ),
    };
  }

  indexByOrderId(
    rows: ParsedSheetRow[],
    ...orderIdAliases: string[]
  ): Map<string, ParsedSheetRow> {
    const index = new Map<string, ParsedSheetRow>();
    rows.forEach((row) => {
      const raw = getRowCell(row, ...orderIdAliases);
      const orderId =
        typeof raw === 'string' || typeof raw === 'number'
          ? String(raw).trim()
          : '';
      if (!orderId) return;
      index.set(orderId, row);
    });
    return index;
  }

  indexOrderIds(rows: ParsedSheetRow[], ...orderIdAliases: string[]): Set<string> {
    const ids = new Set<string>();
    rows.forEach((row) => {
      const raw = getRowCell(row, ...orderIdAliases);
      const orderId =
        typeof raw === 'string' || typeof raw === 'number'
          ? String(raw).trim()
          : '';
      if (orderId) ids.add(orderId);
    });
    return ids;
  }

  buildNormalizedRows(parsed: {
    gstrReportPacked: ParsedMyntraFile;
    mDirectOrders: ParsedMyntraFile;
    salesRevenueB2c: ParsedMyntraFile;
    gstrReportRto: ParsedMyntraFile;
    gstrReportRt: ParsedMyntraFile;
    mDirectReturns: ParsedMyntraFile;
  }): MyntraBuildResult {
    const mDirectByOrder = this.indexByOrderId(
      parsed.mDirectOrders.rows,
      ...MYNTRA_MDIRECT_ORDER_ID_ALIASES,
    );
    const gstrByOrder = this.indexByOrderId(
      parsed.gstrReportPacked.rows,
      ...MYNTRA_GSTR_ORDER_ID_ALIASES,
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

    const rows: MyntraBuildResult['rows'] = [];
    const errors: MyntraBuildResult['errors'] = [];
    let missingOrderIdCount = 0;
    let missingInGstrCount = 0;
    let missingInMdirectCount = 0;

    parsed.salesRevenueB2c.rows.forEach((row) => {
      try {
        const orderIdRaw = getRowCell(row, ...MYNTRA_SALES_ORDER_ID_ALIASES);
        const orderId =
          typeof orderIdRaw === 'string' || typeof orderIdRaw === 'number'
            ? String(orderIdRaw).trim()
            : '';
        if (!orderId) {
          missingOrderIdCount += 1;
          return;
        }
        const mDirectRow = mDirectByOrder.get(orderId);
        const gstrRow = gstrByOrder.get(orderId);
        if (!gstrRow) {
          missingInGstrCount += 1;
          return;
        }
        if (!mDirectRow) {
          missingInMdirectCount += 1;
          return;
        }
        const isRtoReturn = rtoOrderIds.has(orderId);
        const isCustomerReturn = !isRtoReturn && rtOrderIds.has(orderId);
        rows.push({
          ...this.mapping.mapMyntraSalesRow(row, mDirectRow, gstrRow, {
            isRtoReturn,
            isCustomerReturn,
            mDirectReturnsRow: mDirectReturnsByOrder.get(orderId),
          }),
          __sheetName: row.__sheetName,
          __rowNumber: row.__rowNumber,
        });
      } catch {
        errors.push({
          sheetName: row.__sheetName,
          rowNumber: row.__rowNumber,
          error: 'Failed to normalize Myntra sales revenue row',
        });
      }
    });

    if (missingOrderIdCount || missingInGstrCount || missingInMdirectCount) {
      throw new BadRequestException(
        [
          'Myntra order id validation failed.',
          `Missing order id in Sales Revenue Packed B2C rows: ${missingOrderIdCount}`,
          `Sales rows with no matching order id in GSTR Report Packed: ${missingInGstrCount}`,
          `Sales rows with no matching order id in MDirect Orders Report: ${missingInMdirectCount}`,
        ].join(' '),
      );
    }

    return { rows, errors };
  }
}
