import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { classifyFlipkartSettlementRow } from '../../settlement/utils/flipkart-settlement-classifier.util';

@Injectable()
export class SettlementBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SettlementBackfillService.name);
  private readonly migrationId = 'normalized-transactions-v7';

  constructor(@InjectConnection() private readonly connection: Connection) {}

  onApplicationBootstrap() {
    void this.backfill();
  }

  private async backfill() {
    const db = this.connection.db;
    if (!db) return;
    const migrations = db.collection('system_migrations');
    if (await migrations.findOne({ _id: this.migrationId as never })) return;

    try {
      await db.collection('normalized_transactions').deleteMany({
        $or: [
          {
            sourceType: {
              $in: ['amazon-payment', 'flipkart-payment', 'meesho-payment'],
            },
            calculationRole: { $in: ['sale', 'return'] },
          },
          { sourceType: 'myntra-import' },
          {
            marketplace: 'flipkart',
            sourceType: 'flipkart-payment',
            transactionName: 'Marketplace Fee',
          },
        ],
      });
      await Promise.all([
        db.collection('normalized_transactions').deleteMany({
          marketplace: 'flipkart',
          sourceType: 'order-report',
        }),
        db.collection('normalized_transactions').updateMany(
          {
            marketplace: 'flipkart',
            sourceType: 'flipkart-payment',
            transactionName: 'Fixed Fee',
          },
          { $set: { transactionCategory: 'Fixed Fee' } },
        ),
        db.collection('normalized_transactions').updateMany(
          {
            marketplace: 'flipkart',
            sourceType: 'flipkart-payment',
            transactionName: 'Collection Fee',
          },
          { $set: { transactionCategory: 'Collection Fee' } },
        ),
      ]);
      let inserted = 0;
      const hasNormalizedTransactions =
        (await db
          .collection('normalized_transactions')
          .estimatedDocumentCount()) > 0;
      if (!hasNormalizedTransactions) {
        inserted += await this.backfillAmazon();
        inserted += await this.backfillFlipkart();
        inserted += await this.backfillMeesho();
      }
      inserted += await this.backfillOrderReports();
      await migrations.updateOne(
        { _id: this.migrationId as never },
        {
          $set: {
            completedAt: new Date(),
            normalizedTransactions: inserted,
          },
        },
        { upsert: true },
      );
      this.logger.log(
        `Settlement normalization backfill completed (${inserted} transactions)`,
      );
    } catch (error) {
      this.logger.error(
        `Settlement normalization backfill failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async backfillAmazon() {
    const db = this.connection.db!;
    const cursor = db.collection('amazon_payment_transactions').find({
      orderId: { $nin: ['', null] },
    });
    return this.consume(cursor, (row) => {
      const description = String(row.amountDescription ?? '').trim();
      const type = String(row.transactionType ?? '').trim();
      const haystack = `${type} ${description}`.toLowerCase();
      const saleComponent = /principal|product tax/.test(
        description.toLowerCase(),
      );
      const role = saleComponent
        ? /refund|return/.test(haystack)
          ? 'return'
          : 'sale'
        : /claim|reimbursement/.test(haystack)
          ? 'adjustment'
          : 'expense';
      if (role === 'sale' || role === 'return') return null;
      const category = this.amazonExpenseCategory(description.toLowerCase());
      return {
        sellerId: String(row.sellerId ?? ''),
        gstId: row.gstId ? String(row.gstId) : undefined,
        gstin: row.gstin,
        marketplace: 'amazon',
        settlementId: String(row.settlementId ?? ''),
        settlementDate: this.validDate(row.depositDate),
        orderId: String(row.orderId ?? ''),
        transactionType: type || 'transaction',
        transactionCategory: category,
        transactionName: description || type || 'Transaction',
        calculationRole: role,
        amount: Number(row.amount ?? 0),
        currency: 'INR',
        contributesToReceived: true,
        disputed: false,
        sourceType: 'amazon-payment',
        sourceId: String(row.rowKey ?? row._id),
        uploadId: row.uploadId ? String(row.uploadId) : undefined,
        reportMonth: String(row.reportMonth ?? 'unknown'),
        metadata: { sourceRowNumber: row.sourceRowNumber },
      };
    });
  }

  private async backfillFlipkart() {
    const db = this.connection.db!;
    const cursor = db.collection('flipkart_payment_order_reports').find({
      orderId: { $nin: ['', null] },
    });
    return this.consume(cursor, (row) => {
      const settlementId =
        String(row.neftId ?? '').trim() ||
        `UNSETTLED-${row.reportMonth ?? 'UNKNOWN'}`;
      const base = {
        sellerId: String(row.sellerId ?? ''),
        gstId: row.gstId ? String(row.gstId) : undefined,
        gstin: row.gstin,
        marketplace: 'flipkart',
        settlementId,
        settlementDate: this.validDate(
          row.paymentDate ?? row.invoiceDate ?? row.orderDate,
        ),
        orderDate: this.optionalDate(row.orderDate ?? row.invoiceDate),
        orderId: String(row.orderId ?? ''),
        currency: 'INR',
        disputed: false,
        sourceType: 'flipkart-payment',
        uploadId: row.uploadId ? String(row.uploadId) : undefined,
        reportMonth: String(row.reportMonth ?? 'unknown'),
        metadata: {
          orderItemId: row.orderItemId,
          invoiceId: row.invoiceId,
          sellerSku: row.sellerSku,
          quantity: row.quantity,
        },
      };
      const identity = `${base.orderId}:${row.orderItemId ?? ''}:${settlementId}`;
      const definitions = [
        ['Commission', row.commission, 'Commission', 'expense', false],
        ['Fixed Fee', row.fixedFee, 'Fixed Fee', 'expense', false],
        [
          'Collection Fee',
          row.collectionFee,
          'Collection Fee',
          'expense',
          false,
        ],
        [
          'Pick and Pack Fee',
          row.pickAndPackFee,
          'Logistics',
          'expense',
          false,
        ],
        ['Shipping Fee', row.shippingFee, 'Shipping', 'expense', false],
        [
          'Reverse Shipping Fee',
          row.reverseShippingFee,
          'Shipping',
          'expense',
          false,
        ],
        ['TCS', row.tcs, 'TCS', 'expense', false],
        ['TDS', row.tds, 'TDS', 'expense', false],
        [
          'GST on Marketplace Fees',
          row.gstOnMarketplaceFees,
          'GST',
          'expense',
          false,
        ],
        ['Taxes', row.taxes, 'Tax', 'expense', false],
        [
          'Bank Settlement Value',
          row.bankSettlementValue,
          'Settlement Credit',
          'received',
          true,
        ],
      ] as const;
      return definitions
        .filter(
          ([, amount]) =>
            Number.isFinite(Number(amount)) && Number(amount) !== 0,
        )
        .map(([name, amount, category, role, contributes]) => ({
          ...base,
          transactionType: role,
          transactionCategory: category,
          transactionName: name,
          calculationRole: role,
          amount: Number(amount),
          contributesToReceived: contributes,
          sourceId: `${identity}:${name}`,
        }));
    });
  }

  private async backfillMeesho() {
    const db = this.connection.db!;
    const cursor = db.collection('meesho_order_payments').find({
      subOrderNo: { $nin: ['', null] },
    });
    return this.consume(cursor, (row) => {
      const settlementId =
        String(row.transactionId ?? '').trim() ||
        `UNSETTLED-${row.reportMonth ?? 'UNKNOWN'}`;
      const base = {
        sellerId: String(row.sellerId ?? ''),
        gstId: row.gstId ? String(row.gstId) : undefined,
        gstin: row.gstin,
        marketplace: 'meesho',
        settlementId,
        settlementDate: this.validDate(row.paymentDate ?? row.orderDate),
        orderDate: this.optionalDate(row.orderDate),
        orderId: String(row.subOrderNo ?? ''),
        currency: 'INR',
        disputed: false,
        sourceType: 'meesho-payment',
        uploadId: row.importId ? String(row.importId) : undefined,
        reportMonth: String(row.reportMonth ?? 'unknown'),
        metadata: {
          productName: row.productName,
          supplierSku: row.supplierSku,
          quantity: row.quantity,
        },
      };
      const identity = `${base.orderId}:${settlementId}`;
      const definitions = [
        ['Fixed Fee', row.fixedFeeInclGst, 'Marketplace Fee', 'expense', false],
        [
          'Warehousing Fee',
          row.warehousingFeeInclGst,
          'Storage',
          'expense',
          false,
        ],
        [
          'Meesho Commission',
          row.meeshoCommissionInclGst,
          'Commission',
          'expense',
          false,
        ],
        [
          'Return Shipping Charge',
          row.returnShippingChargeInclGst,
          'Shipping',
          'expense',
          false,
        ],
        [
          'Shipping Charge',
          row.shippingChargeInclGst,
          'Shipping',
          'expense',
          false,
        ],
        ['TCS', row.tcs, 'TCS', 'expense', false],
        ['TDS', row.tds, 'TDS', 'expense', false],
        [
          'Compensation',
          row.compensation,
          'Reimbursement',
          'adjustment',
          false,
        ],
        ['Claims', row.claims, 'Claims', 'adjustment', false],
        ['Recovery', row.recovery, 'Adjustment', 'expense', false],
        [
          'Final Settlement Amount',
          row.finalSettlementAmount,
          'Settlement Credit',
          'received',
          true,
        ],
      ] as const;
      return definitions
        .filter(
          ([, amount]) =>
            Number.isFinite(Number(amount)) && Number(amount) !== 0,
        )
        .map(([name, amount, category, role, contributes]) => ({
          ...base,
          transactionType: role,
          transactionCategory: category,
          transactionName: name,
          calculationRole: role,
          amount: Number(amount),
          contributesToReceived: contributes,
          sourceId: `${identity}:${name}`,
        }));
    });
  }

  private async backfillOrderReports() {
    const db = this.connection.db!;
    const platforms = await db
      .collection('platformmarketplaces')
      .find({})
      .project({ slug: 1 })
      .toArray();
    const platformById = new Map(
      platforms.map((item) => [
        String(item._id),
        String(item.slug).toLowerCase(),
      ]),
    );
    const links = await db
      .collection('marketplaces')
      .find({})
      .project({ platformMarketplaceId: 1 })
      .toArray();
    const marketplaceByLinkId = new Map(
      links.map((item) => [
        String(item._id),
        platformById.get(String(item.platformMarketplaceId)) ?? '',
      ]),
    );
    const cursor = db.collection('import_rows').find({
      orderID: { $nin: ['', null] },
    });
    return this.consume(cursor, (row) => {
      const marketplaceValue = String(row.marketplace ?? '').toLowerCase();
      const marketplace =
        marketplaceByLinkId.get(String(row.marketplace ?? '')) ||
        (['amazon', 'flipkart', 'meesho', 'myntra'].includes(marketplaceValue)
          ? marketplaceValue
          : row.myntraTransactionType
            ? 'myntra'
            : row.amazonMtrSource
              ? 'amazon'
              : '');
      if (!marketplace) return null;
      const flipkartClassification =
        marketplace === 'flipkart'
          ? classifyFlipkartSettlementRow(row.documentType, row.voucherType)
          : null;
      const isReturnDocument =
        flipkartClassification?.role === 'return' ||
        row.myntraTransactionType === 'RETURN' ||
        Number(row.returnQty ?? 0) > 0 ||
        /return|credit|refund/i.test(String(row.documentType ?? ''));
      const invoiceAmount = Math.abs(Number(row.invoiceAmount ?? 0));
      const saleAmount = Math.abs(
        Number(
          flipkartClassification
            ? flipkartClassification.role === 'sale'
              ? invoiceAmount
              : 0
            : (row.totalSaleAmountInclShippingGst ??
                (!isReturnDocument ? row.invoiceAmount : 0) ??
                0),
        ),
      );
      const returnAmount =
        (flipkartClassification?.role === 'return'
          ? flipkartClassification.sign
          : 1) *
        Math.abs(
          Number(
            flipkartClassification
              ? flipkartClassification.role === 'return'
                ? invoiceAmount
                : 0
              : (row.meeshoReturnInvoiceAmount ??
                  row.totalSaleReturnAmountInclShippingGst ??
                  (isReturnDocument ? row.invoiceAmount : 0) ??
                  0),
          ),
        );
      const orderDate = this.historicalOrderDate(
        row.order_created_date ??
          row.invoiceDate ??
          row.buyerInvoiceDate ??
          row.order_packed_date,
        row.reportMonth,
      );
      const base = {
        sellerId: String(row.sellerId ?? ''),
        gstId: row.gstId ? String(row.gstId) : undefined,
        gstin: row.gstin ?? row.sellerGSTIN,
        marketplace,
        settlementId:
          String(row.transactionId ?? '').trim() ||
          `UNSETTLED-${row.reportMonth ?? 'UNKNOWN'}`,
        settlementDate:
          orderDate ??
          this.validDate(
            row.paymentDate ?? row.invoiceDate ?? row.returnInvoiceDate,
          ),
        orderDate,
        orderId: String(row.orderID),
        currency: 'INR',
        contributesToReceived: false,
        disputed: false,
        sourceType: 'order-report',
        uploadId: row.uploadId ? String(row.uploadId) : undefined,
        reportMonth: String(row.reportMonth ?? 'unknown'),
        metadata: {
          skuId: row.skuID,
          invoiceNo: row.invoiceNo,
          documentType: row.documentType,
          voucherType: row.voucherType,
          quantity: row.quantity,
        },
      };
      const transactions: Array<Record<string, unknown>> = [];
      if (Number.isFinite(saleAmount) && saleAmount !== 0) {
        transactions.push({
          ...base,
          transactionType: 'sale',
          transactionCategory: 'Sales',
          transactionName:
            flipkartClassification?.transactionName ?? 'Order Sale',
          calculationRole: 'sale',
          amount: saleAmount,
          sourceId: `${String(row._id)}:sale`,
        });
      }
      if (Number.isFinite(returnAmount) && returnAmount !== 0) {
        transactions.push({
          ...base,
          transactionType: 'return',
          transactionCategory: 'Returns',
          transactionName:
            flipkartClassification?.transactionName ?? 'Order Return',
          calculationRole: 'return',
          amount: returnAmount,
          sourceId: `${String(row._id)}:return`,
        });
      }
      return transactions;
    });
  }

  private async consume(
    cursor: any,
    mapper: (
      row: Record<string, any>,
    ) => Record<string, unknown> | Array<Record<string, unknown>> | null,
  ) {
    const target = this.connection.db!.collection('normalized_transactions');
    let operations: any[] = [];
    let count = 0;
    const flush = async () => {
      if (!operations.length) return;
      await target.bulkWrite(operations, { ordered: false });
      count += operations.length;
      operations = [];
    };
    for await (const row of cursor) {
      const mapped = mapper(row as Record<string, any>);
      const transactions = Array.isArray(mapped)
        ? mapped
        : mapped
          ? [mapped]
          : [];
      for (const transaction of transactions) {
        operations.push({
          updateOne: {
            filter: {
              sellerId: transaction.sellerId,
              marketplace: transaction.marketplace,
              reportMonth: transaction.reportMonth,
              sourceType: transaction.sourceType,
              sourceId: transaction.sourceId,
            },
            update: {
              $set: transaction,
              $setOnInsert: { createdAt: new Date() },
              $currentDate: { updatedAt: true },
            },
            upsert: true,
          },
        });
        if (operations.length >= 500) await flush();
      }
    }
    await flush();
    return count;
  }

  private validDate(value: unknown) {
    const date = new Date(String(value ?? ''));
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private optionalDate(value: unknown) {
    if (value == null || value === '') return undefined;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private historicalOrderDate(value: unknown, reportMonth: unknown) {
    const parsed = this.optionalDate(value);
    const monthMatch = String(reportMonth ?? '').match(/^(\d{4})-(\d{2})$/);
    if (!parsed || !monthMatch) return parsed;

    const expectedYear = Number(monthMatch[1]);
    const expectedMonth = Number(monthMatch[2]);
    if (
      parsed.getUTCFullYear() === expectedYear &&
      parsed.getUTCMonth() + 1 === expectedMonth
    ) {
      return parsed;
    }

    const parsedDay = parsed.toISOString().slice(0, 10);
    const candidates: Date[] = [];
    for (
      let year = expectedYear - 2;
      year <= new Date().getUTCFullYear();
      year += 1
    ) {
      for (let month = 1; month <= 12; month += 1) {
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        for (let day = 1; day <= daysInMonth; day += 1) {
          const legacyParsed = new Date(Date.UTC(2000 + day, month - 1, year));
          if (legacyParsed.toISOString().slice(0, 10) === parsedDay) {
            candidates.push(new Date(Date.UTC(year, month - 1, day)));
          }
        }
      }
    }
    if (!candidates.length) return parsed;
    const expectedTime = Date.UTC(expectedYear, expectedMonth - 1, 1);
    return candidates.sort(
      (left, right) =>
        Math.abs(left.getTime() - expectedTime) -
        Math.abs(right.getTime() - expectedTime),
    )[0];
  }

  private amazonExpenseCategory(value: string) {
    const categories: Array<[RegExp, string]> = [
      [/commission/, 'Commission'],
      [/shipping|postage|logistics|easy ship/, 'Shipping'],
      [/advert|sponsored|servicefee|service fee/, 'Advertising'],
      [/\btds\b/, 'TDS'],
      [/\btcs\b/, 'TCS'],
      [/\bgst\b|\bigst\b|\bcgst\b|\bsgst\b/, 'GST'],
      [/storage/, 'Storage'],
      [/penalty/, 'Penalty'],
      [/claim/, 'Claims'],
      [/reimbursement/, 'Reimbursement'],
      [/promotion|promo|discount/, 'Promotion'],
      [/adjustment/, 'Adjustment'],
      [/fee|charge/, 'Marketplace Fee'],
    ];
    return categories.find(([pattern]) => pattern.test(value))?.[1] ?? 'Others';
  }
}
