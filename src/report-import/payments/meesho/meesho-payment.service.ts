import { Injectable, Logger } from '@nestjs/common';
import { MeeshoPaymentParser } from './meesho-payment.parser';
import { MeeshoPaymentRepository } from './meesho-payment.repository';
import type { ParsedSheetRow } from '../../services/mapping.service';
import type { MeeshoPaymentSheetKind } from './meesho-payment-sheet-kinds';
import type { MeeshoOrderPaymentsMappedRow } from './meesho-payment-order.mapper';
import { SettlementService } from '../../../settlement/settlement.service';
import type { NormalizedTransaction } from '../../../settlement/schemas/normalized-transaction.schema';

export type MeeshoPaymentProcessInput = {
  buffer: Buffer;
  uploadedFileName: string;
  sellerId: string;
  gstId?: string;
  gstin?: string;
  marketplace: string;
  reportMonth?: string;
  importId: string;
};

export type MeeshoPaymentImportSummary = {
  success: true;
  marketplace: 'meesho';
  summary: {
    orderPayments: number;
    adsCost: number;
    referralPayments: number;
    compensationRecovery: number;
  };
  skipped: Record<MeeshoPaymentSheetKind, number>;
  processingTimeMs: number;
  orderPaymentRawRows: ParsedSheetRow[];
};

@Injectable()
export class MeeshoPaymentService {
  private readonly logger = new Logger(MeeshoPaymentService.name);

  constructor(
    private readonly parser: MeeshoPaymentParser,
    private readonly repository: MeeshoPaymentRepository,
    private readonly settlementService: SettlementService,
  ) {}

  async processUpload(
    input: MeeshoPaymentProcessInput,
  ): Promise<MeeshoPaymentImportSummary> {
    const started = Date.now();
    const importedAt = new Date();

    const parsed = this.parser.parse(input.buffer);

    const sheetNames = Object.fromEntries(
      parsed.sheets.map((sheet) => [sheet.kind, sheet.sheetName]),
    ) as Partial<Record<MeeshoPaymentSheetKind, string>>;

    const secondaryByKind = Object.fromEntries(
      parsed.secondary.map((sheet) => [sheet.kind, sheet]),
    ) as Record<
      Exclude<MeeshoPaymentSheetKind, 'orderPayments'>,
      (typeof parsed.secondary)[number]
    >;

    const insertResult = await this.repository.bulkInsertAll(
      {
        sellerId: input.sellerId,
        marketplace: input.marketplace,
        reportMonth: input.reportMonth,
        importId: input.importId,
      },
      {
        sellerId: input.sellerId,
        importId: input.importId,
        importedAt,
        gstId: input.gstId,
        gstin: input.gstin,
        reportMonth: input.reportMonth,
        uploadedFileName: input.uploadedFileName,
      },
      {
        orderPayments: parsed.orderPayments,
        adsCost: secondaryByKind.adsCost?.rows ?? [],
        referralPayments: secondaryByKind.referralPayments?.rows ?? [],
        compensationRecovery: secondaryByKind.compensationRecovery?.rows ?? [],
      },
      sheetNames,
    );

    const summary = {
      orderPayments: insertResult.orderPayments.inserted,
      adsCost: insertResult.adsCost.inserted,
      referralPayments: insertResult.referralPayments.inserted,
      compensationRecovery: insertResult.compensationRecovery.inserted,
    };

    await this.settlementService.replaceNormalizedScope(
      {
        sellerId: input.sellerId,
        marketplace: 'meesho',
        reportMonth: input.reportMonth,
        sourceType: 'meesho-payment',
      },
      parsed.orderPayments.flatMap((row) =>
        this.normalizeTransactions(row, input),
      ),
    );

    const processingTimeMs = Date.now() - started;

    this.logger.log(
      `Meesho payment import ${input.importId}: orderPayments=${summary.orderPayments} adsCost=${summary.adsCost} referralPayments=${summary.referralPayments} compensationRecovery=${summary.compensationRecovery} skipped=${JSON.stringify(parsed.skippedBySheet)} (${processingTimeMs}ms)`,
    );

    for (const sheet of parsed.sheets) {
      const processedRows =
        sheet.kind === 'orderPayments'
          ? (sheet.indexedRows?.length ?? sheet.rows.length)
          : sheet.rows.length;
      const inserted =
        sheet.kind === 'orderPayments'
          ? insertResult.orderPayments.inserted
          : (insertResult[sheet.kind as keyof typeof insertResult]?.inserted ??
            0);
      const failed =
        sheet.kind === 'orderPayments'
          ? insertResult.orderPayments.failed
          : (insertResult[sheet.kind as keyof typeof insertResult]?.failed ??
            0);
      this.logger.log(
        `Meesho sheet "${sheet.sheetName}" (${sheet.kind}): processed=${processedRows} skipped=${parsed.skippedBySheet[sheet.kind]} inserted=${inserted} failed=${failed}`,
      );
    }

    return {
      success: true,
      marketplace: 'meesho',
      summary,
      skipped: parsed.skippedBySheet,
      processingTimeMs,
      orderPaymentRawRows: parsed.orderPaymentRawRows,
    };
  }

  private normalizeTransactions(
    row: MeeshoOrderPaymentsMappedRow,
    input: MeeshoPaymentProcessInput,
  ): NormalizedTransaction[] {
    const orderId = String(row.subOrderNo ?? '').trim();
    if (!orderId) return [];
    const settlementId =
      String(row.transactionId ?? '').trim() ||
      `UNSETTLED-${input.reportMonth ?? 'UNKNOWN'}`;
    const settlementDate = new Date(
      row.paymentDate ?? row.orderDate ?? Date.now(),
    );
    const orderDate = row.orderDate ? new Date(row.orderDate) : undefined;
    const identity = `${orderId}:${settlementId}`;
    const base = {
      sellerId: input.sellerId,
      gstId: input.gstId,
      gstin: input.gstin,
      marketplace: 'meesho',
      settlementId,
      settlementDate,
      ...(orderDate && !Number.isNaN(orderDate.getTime()) ? { orderDate } : {}),
      orderId,
      currency: 'INR',
      disputed: false,
      sourceType: 'meesho-payment',
      uploadId: input.importId,
      reportMonth: input.reportMonth,
      metadata: {
        productName: row.productName,
        supplierSku: row.supplierSku,
        quantity: row.quantity,
        liveOrderStatus: row.liveOrderStatus,
      },
    };
    const transactions: NormalizedTransaction[] = [];
    const add = (
      name: string,
      amount: number | null | undefined,
      category: string,
      role: NormalizedTransaction['calculationRole'],
      contributesToReceived = false,
    ) => {
      const value = Number(amount ?? 0);
      if (!Number.isFinite(value) || value === 0) return;
      transactions.push({
        ...base,
        transactionType: role,
        transactionCategory: category,
        transactionName: name,
        calculationRole: role,
        amount: value,
        contributesToReceived,
        sourceId: `${identity}:${name}`,
      });
    };

    add('Fixed Fee', row.fixedFeeInclGst, 'Marketplace Fee', 'expense');
    add('Warehousing Fee', row.warehousingFeeInclGst, 'Storage', 'expense');
    add(
      'Return Premium',
      row.returnPremiumInclGst,
      'Marketplace Fee',
      'expense',
    );
    add(
      'Meesho Commission',
      row.meeshoCommissionInclGst,
      'Commission',
      'expense',
    );
    add(
      'Gold Platform Fee',
      row.meeshoGoldPlatformFeeInclGst,
      'Marketplace Fee',
      'expense',
    );
    add(
      'Mall Platform Fee',
      row.meeshoMallPlatformFeeInclGst,
      'Marketplace Fee',
      'expense',
    );
    add(
      'Return Shipping Charge',
      row.returnShippingChargeInclGst,
      'Shipping',
      'expense',
    );
    add('Shipping Charge', row.shippingChargeInclGst, 'Shipping', 'expense');
    add('TCS', row.tcs, 'TCS', 'expense');
    add('TDS', row.tds, 'TDS', 'expense');
    add('Compensation', row.compensation, 'Reimbursement', 'adjustment');
    add('Claims', row.claims, 'Claims', 'adjustment');
    add('Recovery', row.recovery, 'Adjustment', 'expense');
    add(
      'Final Settlement Amount',
      row.finalSettlementAmount,
      'Settlement Credit',
      'received',
      true,
    );
    return transactions;
  }
}
