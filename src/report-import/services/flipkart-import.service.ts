import { Injectable, BadRequestException } from '@nestjs/common';
import { getRowCell, MappingService, ParsedSheetRow } from './mapping.service';
import { FileParserService } from './file-parser.service';
import { flipkartImportMapping } from '../config/importMappings/flipkart.mapping';
import { FLIPKART_RETURN_REQUIRED_HEADER_GROUPS } from '../config/importMappings/flipkart-return.mapping';
import {
  buildFlipkartReturnDetailsByOrderId,
  flipkartOrderIdLookupKey,
  normalizeFlipkartOrderId,
  type FlipkartReturnDetails,
} from '../utils/flipkart-return.util';

const FLIPKART_ORDER_ID_ALIASES = [
  ...(flipkartImportMapping.orderId?.excelColumns ?? ['Order ID']),
  'Order Id',
  'order_id',
];

@Injectable()
export class FlipkartImportService {
  constructor(
    private readonly parser: FileParserService,
    private readonly mapping: MappingService,
  ) {}

  parsePaymentFile(file: { buffer: Buffer; originalname: string }) {
    return this.parser.parseFlipkartPaymentWorkbook(file.buffer);
  }

  parseReturnFile(file: { buffer: Buffer; originalname: string }) {
    return this.parser.parseFlipkartReturnWorkbook(file.buffer);
  }

  validateReturnFile(file: { buffer: Buffer; originalname: string }) {
    if (!file.buffer?.length) {
      throw new BadRequestException('Return report file is empty');
    }
    const name = String(file.originalname ?? '').toLowerCase();
    if (!/\.(xlsx|xls|csv)$/.test(name)) {
      throw new BadRequestException(
        'Return report must be an Excel (.xlsx, .xls) or CSV file',
      );
    }
    const parsed = this.parseReturnFile(file);
    if (!parsed.rows.length) {
      throw new BadRequestException(
        'Return report does not contain any data rows',
      );
    }
    return parsed;
  }

  indexByOrderId(rows: ParsedSheetRow[]): Map<string, ParsedSheetRow> {
    const index = new Map<string, ParsedSheetRow>();
    rows.forEach((row) => {
      const orderId = normalizeFlipkartOrderId(
        getRowCell(row, ...FLIPKART_ORDER_ID_ALIASES),
      );
      if (!orderId) return;
      index.set(orderId, row);
    });
    return index;
  }

  indexReturnDetailsByOrderId(
    rows: ParsedSheetRow[],
  ): Map<string, FlipkartReturnDetails> {
    return buildFlipkartReturnDetailsByOrderId(
      rows,
      (row) => this.mapReturnFields(row),
      (row) =>
        normalizeFlipkartOrderId(getRowCell(row, ...FLIPKART_ORDER_ID_ALIASES)),
    );
  }

  mapPaymentFields(row: ParsedSheetRow) {
    return this.mapping.mapFlipkartPaymentFields(row);
  }

  mapReturnFields(row: ParsedSheetRow): FlipkartReturnDetails {
    return this.mapping.mapFlipkartReturnFields(row);
  }

  validateReturnHeaders(headers: string[]) {
    for (const group of FLIPKART_RETURN_REQUIRED_HEADER_GROUPS) {
      const hasColumn = group.some((alias) =>
        headers.some((header) => {
          const normalized = String(header ?? '')
            .trim()
            .toLowerCase();
          const target = String(alias).trim().toLowerCase();
          return normalized === target || normalized.includes(target);
        }),
      );
      if (!hasColumn) {
        throw new BadRequestException(
          `Return report is missing required column: ${group[0]}`,
        );
      }
    }
  }

  orderIdLookupKey(orderId: unknown): string {
    return flipkartOrderIdLookupKey(orderId);
  }
}
