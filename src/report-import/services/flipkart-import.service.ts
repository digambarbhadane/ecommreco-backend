import { Injectable } from '@nestjs/common';
import { getRowCell, MappingService, ParsedSheetRow } from './mapping.service';
import { FileParserService } from './file-parser.service';
import { flipkartImportMapping } from '../config/importMappings/flipkart.mapping';

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

  indexByOrderId(rows: ParsedSheetRow[]): Map<string, ParsedSheetRow> {
    const index = new Map<string, ParsedSheetRow>();
    rows.forEach((row) => {
      const raw = getRowCell(row, ...FLIPKART_ORDER_ID_ALIASES);
      const orderId =
        typeof raw === 'string' || typeof raw === 'number'
          ? String(raw).trim()
          : '';
      if (!orderId) return;
      index.set(orderId, row);
    });
    return index;
  }

  mapPaymentFields(row: ParsedSheetRow) {
    return this.mapping.mapFlipkartPaymentFields(row);
  }
}
