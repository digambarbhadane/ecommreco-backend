import { Injectable, BadRequestException } from '@nestjs/common';
import { getRowCell, MappingService, ParsedSheetRow } from './mapping.service';
import { FileParserService } from './file-parser.service';
import { amazonImportMapping } from '../config/importMappings/amazon.mapping';
import {
  AMAZON_RETURN_ORDER_ID_HEADER_GROUPS,
  AMAZON_RETURN_REQUIRED_HEADER_GROUPS,
} from '../config/importMappings/amazon-return.mapping';
import {
  buildAmazonReturnDetailsByOrderId,
  amazonOrderIdLookupKey,
  normalizeAmazonOrderId,
  type AmazonReturnDetails,
} from '../utils/amazon-return.util';

const AMAZON_ORDER_ID_ALIASES = [
  ...(amazonImportMapping.orderId?.excelColumns ?? ['Order Id']),
  'Order ID',
  'order_id',
];

@Injectable()
export class AmazonImportService {
  constructor(
    private readonly parser: FileParserService,
    private readonly mapping: MappingService,
  ) {}

  parseReturnFile(file: { buffer: Buffer; originalname: string }) {
    return this.parser.parseAmazonReturnWorkbook(file.buffer);
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
      throw new BadRequestException('Return report does not contain any data rows');
    }
    return parsed;
  }

  indexReturnDetailsByOrderId(
    rows: ParsedSheetRow[],
  ): Map<string, AmazonReturnDetails> {
    return buildAmazonReturnDetailsByOrderId(
      rows,
      (row) => this.mapReturnFields(row),
      (row) =>
        normalizeAmazonOrderId(getRowCell(row, ...AMAZON_ORDER_ID_ALIASES)),
    );
  }

  mapReturnFields(row: ParsedSheetRow): AmazonReturnDetails {
    return this.mapping.mapAmazonReturnFields(row);
  }

  validateReturnHeaders(headers: string[]) {
    for (const group of AMAZON_RETURN_REQUIRED_HEADER_GROUPS) {
      const hasColumn = group.some((alias) =>
        headers.some((header) => {
          const normalized = String(header ?? '').trim().toLowerCase();
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

  hasOrderIdColumn(headers: string[]): boolean {
    return AMAZON_RETURN_ORDER_ID_HEADER_GROUPS.some((group) =>
      group.some((alias) =>
        headers.some((header) => {
          const normalized = String(header ?? '').trim().toLowerCase();
          const target = String(alias).trim().toLowerCase();
          return normalized === target || normalized.includes(target);
        }),
      ),
    );
  }

  orderIdLookupKey(orderId: unknown): string {
    return amazonOrderIdLookupKey(orderId);
  }
}
