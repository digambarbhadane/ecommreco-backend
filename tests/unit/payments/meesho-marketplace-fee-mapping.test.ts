import {
  dedupeMeeshoDuplicatePaymentTransactions,
  mapMeeshoOrderPaymentToAnalyticsRow,
} from '../../../src/report-import/payments/payment-analytics.types';
import {
  aggregateOrderPaymentLifecycle,
  getMarketplaceFeesAmount,
} from '../../../src/report-import/payments/payment-reconciliation.util';

describe('Meesho marketplace fee mapping', () => {
  it('includes signed TCS and TDS inside marketplaceFee', () => {
    const row = mapMeeshoOrderPaymentToAnalyticsRow({
      _id: 'ms-1',
      subOrderNo: 'SUB-1',
      fixedFeeInclGst: -100,
      meeshoCommissionInclGst: -200,
      tcs: -50,
      tds: -25,
      finalSettlementAmount: 500,
      totalSaleAmountInclShippingGst: 1000,
    } as never);

    expect(row.marketplaceFee).toBe(-175);
    expect(row.tcs).toBe(-50);
    expect(row.tds).toBe(-25);
    expect(row.commission).toBe(-200);
    expect(getMarketplaceFeesAmount(row)).toBe(-375);
    expect(row.feeComponents?.some((c) => c.key === 'tcs')).toBe(true);
    expect(row.feeComponents?.some((c) => c.key === 'tds')).toBe(true);
  });

  it('dedupes the same Meesho NEFT across payment collection and import_rows', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'pay-1',
        source: 'meesho_order_payments',
        orderId: '299077843560723265_1',
        marketplace: 'meesho',
        transactionId: 'NEFT-ABC',
        neftId: 'NEFT-ABC',
        saleAmount: 600,
        refund: -600,
        bankSettlementValue: 0,
      },
      {
        _id: 'imp-1',
        source: 'import_rows',
        orderId: '299077843560723265_1',
        marketplace: 'meesho',
        transactionId: 'NEFT-ABC',
        neftId: 'NEFT-ABC',
        saleAmount: 600,
        refund: -600,
        bankSettlementValue: 0,
      },
      {
        _id: 'pay-2',
        source: 'meesho_order_payments',
        orderId: '299077843560723265_1',
        marketplace: 'meesho',
        transactionId: 'NEFT-OTHER',
        neftId: 'NEFT-OTHER',
        saleAmount: 0,
        bankSettlementValue: 50,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r._id).sort()).toEqual(['pay-1', 'pay-2']);
  });

  it('keeps import_rows Meesho lines that have a different transaction id', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'pay-1',
        source: 'meesho_order_payments',
        orderId: 'SUB-1',
        marketplace: 'meesho',
        transactionId: 'T1',
        neftId: 'T1',
      },
      {
        _id: 'imp-2',
        source: 'import_rows',
        orderId: 'SUB-1',
        marketplace: 'meesho',
        transactionId: 'T2',
        neftId: 'T2',
        documentType: 'Sale',
      },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('merges Meesho fee-split rows that share the same transaction id', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'pay-fees',
        source: 'meesho_order_payments',
        orderId: 'SUB-FEE-1',
        marketplace: 'meesho',
        transactionId: 'AXISCN1390024012',
        neftId: 'AXISCN1390024012',
        saleAmount: 499,
        quantity: 1,
        bankSettlementValue: 375.74,
        finalSettlementAmount: 375.74,
        marketplaceFee: -123.16,
        tds: undefined,
        feeComponents: [
          {
            key: 'fixedFeeInclGst',
            label: 'Fixed Fee',
            amount: -123.16,
            category: 'other',
          },
        ],
        sellerSku: 'King_White_NavyBLUE_2',
        documentType: 'Delivered',
      },
      {
        _id: 'pay-tds',
        source: 'meesho_order_payments',
        orderId: 'SUB-FEE-1',
        marketplace: 'meesho',
        transactionId: 'AXISCN1390024012',
        neftId: 'AXISCN1390024012',
        saleAmount: 499,
        quantity: 1,
        bankSettlementValue: 375.74,
        finalSettlementAmount: 375.74,
        marketplaceFee: -0.1,
        tds: -0.1,
        feeComponents: [
          { key: 'tds', label: 'TDS', amount: -0.1, category: 'tds' },
        ],
        sellerSku: 'King_White_NavyBLUE_2',
        documentType: 'Delivered',
      },
    ]);

    expect(rows).toHaveLength(1);
    const merged = rows[0];
    expect(merged.transactionId).toBe('AXISCN1390024012');
    expect(merged.saleAmount).toBe(499);
    expect(merged.quantity).toBe(1);
    expect(merged.bankSettlementValue).toBe(375.74);
    expect(merged.marketplaceFee).toBeCloseTo(-123.26, 2);
    expect(merged.tds).toBeCloseTo(-0.1, 2);
    expect(merged.feeComponents?.map((c) => c.key).sort()).toEqual([
      'fixedFeeInclGst',
      'tds',
    ]);
    expect(getMarketplaceFeesAmount(merged)).toBeCloseTo(-123.26, 2);
  });

  it('keeps genuinely different Meesho transaction ids separate', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'a',
        source: 'meesho_order_payments',
        orderId: 'SUB-2',
        marketplace: 'meesho',
        transactionId: 'TXN-1',
        neftId: 'TXN-1',
        saleAmount: 100,
        quantity: 1,
      },
      {
        _id: 'b',
        source: 'meesho_order_payments',
        orderId: 'SUB-2',
        marketplace: 'meesho',
        transactionId: 'TXN-2',
        neftId: 'TXN-2',
        saleAmount: 0,
        bankSettlementValue: 50,
        quantity: 1,
      },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('splits mirrored Meesho sale+return stamps across different payment ids into Sale then Return', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 't1',
        source: 'meesho_order_payments',
        orderId: '268908149125127616_1',
        marketplace: 'meesho',
        transactionId: 'AXISCN1306568646',
        neftId: 'AXISCN1306568646',
        paymentDate: '2026-04-09',
        saleAmount: 514,
        refund: -514,
        quantity: 1,
        bankSettlementValue: 0,
        sellerSku: 'King_White_NavyBLUE_2',
        documentType: 'Returned',
      },
      {
        _id: 't2',
        source: 'meesho_order_payments',
        orderId: '268908149125127616_1',
        marketplace: 'meesho',
        transactionId: 'AXISCN1310184754',
        neftId: 'AXISCN1310184754',
        paymentDate: '2026-04-13',
        saleAmount: 514,
        refund: -514,
        quantity: 1,
        bankSettlementValue: 0,
        sellerSku: 'King_White_NavyBLUE_2',
        documentType: 'Returned',
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.transactionId).sort()).toEqual([
      'AXISCN1306568646',
      'AXISCN1310184754',
    ]);
    const sale = rows.find((r) => r.transactionId === 'AXISCN1306568646');
    const ret = rows.find((r) => r.transactionId === 'AXISCN1310184754');
    expect(sale?.saleAmount).toBe(514);
    expect(sale?.refund).toBe(0);
    expect(sale?.documentType).toBe('Sale');
    expect(ret?.saleAmount).toBe(0);
    expect(ret?.refund).toBe(-514);
    expect(getMarketplaceFeesAmount(sale!)).toBe(0);

    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.sales).toBe(514);
    expect(lifecycle.returns).toBe(-514);
    expect(lifecycle.netSales).toBe(0);
  });

  it('leaves a single Meesho sale+return settlement row unchanged', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'one',
        source: 'meesho_order_payments',
        orderId: 'SUB-RTO',
        marketplace: 'meesho',
        transactionId: 'TXN-ONLY',
        neftId: 'TXN-ONLY',
        saleAmount: 642,
        refund: -642,
        quantity: 1,
        documentType: 'RTO',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].saleAmount).toBe(642);
    expect(rows[0].refund).toBe(-642);
  });

  it('does not double bank/returns when Meesho reprints settlement across payment ids', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'a',
        source: 'meesho_order_payments',
        orderId: '288727044862755520_1',
        marketplace: 'meesho',
        transactionId: 'TXN-A',
        neftId: 'TXN-A',
        paymentDate: '2026-03-01',
        saleAmount: 597,
        refund: -597,
        quantity: 1,
        bankSettlementValue: 459.34,
        finalSettlementAmount: 459.34,
        marketplaceFee: -137.66,
        sellerSku: 'King_White_SkyBlue_2',
        documentType: 'Returned',
      },
      {
        _id: 'b',
        source: 'meesho_order_payments',
        orderId: '288727044862755520_1',
        marketplace: 'meesho',
        transactionId: 'TXN-B',
        neftId: 'TXN-B',
        paymentDate: '2026-03-05',
        saleAmount: 597,
        refund: -597,
        quantity: 0,
        bankSettlementValue: 459.34,
        finalSettlementAmount: 459.34,
        marketplaceFee: -137.66,
        sellerSku: '',
        documentType: 'Returned',
      },
      {
        _id: 'c',
        source: 'meesho_order_payments',
        orderId: '288727044862755520_1',
        marketplace: 'meesho',
        transactionId: 'TXN-C',
        neftId: 'TXN-C',
        paymentDate: '2026-03-08',
        saleAmount: 597,
        refund: -597,
        quantity: 1,
        bankSettlementValue: 459.34,
        finalSettlementAmount: 459.34,
        marketplaceFee: -137.66,
        tds: -0.1,
        sellerSku: 'King_White_SkyBlue_2',
        documentType: 'Returned',
        feeComponents: [
          { key: 'tds', label: 'TDS', amount: -0.1, category: 'tds' },
        ],
      },
    ]);

    expect(rows).toHaveLength(3);
    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.sales).toBe(597);
    expect(lifecycle.returns).toBe(-597);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBeCloseTo(459.34, 2);
    expect(rows.filter((r) => (Number(r.bankSettlementValue) || 0) !== 0)).toHaveLength(
      1,
    );
  });

  it('keeps sale payout and return clawback banks with opposite signs', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'sale-pay',
        source: 'meesho_order_payments',
        orderId: '276351580826560896_1',
        marketplace: 'meesho',
        transactionId: 'PAY-SALE',
        neftId: 'PAY-SALE',
        paymentDate: '2026-05-01',
        saleAmount: 579.68,
        refund: -579.68,
        quantity: 1,
        bankSettlementValue: 456.4,
        finalSettlementAmount: 456.4,
        marketplaceFee: -123.28,
        sellerSku: 'Net_King_Lavender_2',
        documentType: 'Delivered',
      },
      {
        _id: 'ret-claw',
        source: 'meesho_order_payments',
        orderId: '276351580826560896_1',
        marketplace: 'meesho',
        transactionId: 'PAY-RET',
        neftId: 'PAY-RET',
        paymentDate: '2026-05-20',
        saleAmount: 579.68,
        refund: -579.68,
        quantity: 1,
        bankSettlementValue: -456.4,
        finalSettlementAmount: -456.4,
        marketplaceFee: 123.28,
        sellerSku: 'Net_King_Lavender_2',
        documentType: 'Returned',
      },
    ]);

    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.sales).toBeCloseTo(579.68, 2);
    expect(lifecycle.returns).toBeCloseTo(-579.68, 2);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBeCloseTo(0, 2);
    expect(lifecycle.marketplaceFees).toBeCloseTo(0, 2);
    expect(lifecycle.difference).toBe(0);
    expect(lifecycle.expectedBankPayout).toBeCloseTo(0, 2);
  });

  it('keeps genuinely different Meesho bank payouts on different payment ids', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'p1',
        source: 'meesho_order_payments',
        orderId: 'SUB-MULTI-PAY',
        marketplace: 'meesho',
        transactionId: 'PAY-1',
        neftId: 'PAY-1',
        paymentDate: '2026-01-01',
        saleAmount: 100,
        bankSettlementValue: 80,
      },
      {
        _id: 'p2',
        source: 'meesho_order_payments',
        orderId: 'SUB-MULTI-PAY',
        marketplace: 'meesho',
        transactionId: 'PAY-2',
        neftId: 'PAY-2',
        paymentDate: '2026-01-10',
        saleAmount: 0,
        bankSettlementValue: 20,
      },
    ]);
    expect(aggregateOrderPaymentLifecycle(rows).bankPayout).toBe(100);
  });

  it('restores Sale and single Return for Meesho Cancelled status reprints', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'm1',
        source: 'meesho_order_payments',
        orderId: '28855608280787744_1',
        marketplace: 'meesho',
        documentType: 'Cancelled',
        transactionId: 'TXN-1',
        neftId: 'TXN-1',
        paymentDate: '2026-06-01',
        saleAmount: 618,
        refund: -618,
        quantity: 1,
        bankSettlementValue: 0,
        marketplaceFee: 0,
        sellerSku: 'Net_King_Lavender_2',
      },
      {
        _id: 'm2',
        source: 'meesho_order_payments',
        orderId: '28855608280787744_1',
        marketplace: 'meesho',
        documentType: 'Cancelled',
        transactionId: 'TXN-2',
        neftId: 'TXN-2',
        paymentDate: '2026-06-24',
        saleAmount: 618,
        refund: -618,
        quantity: 1,
        bankSettlementValue: 0,
        marketplaceFee: -141.76,
        sellerSku: 'Net_King_Lavender_2',
      },
    ]);

    expect(rows).toHaveLength(2);
    const sale = rows.find((r) => r.documentType === 'Sale');
    const ret = rows.find((r) => r.transactionId === 'TXN-2');
    expect(sale?.saleAmount).toBe(618);
    expect(sale?.refund).toBe(0);
    expect(ret?.saleAmount).toBe(0);
    expect(ret?.refund).toBe(-618);

    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.salesCancellations).toBe(0);
    expect(lifecycle.sales).toBe(618);
    expect(lifecycle.returns).toBe(-618);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.marketplaceFees).toBeCloseTo(-141.76, 2);
  });

  it('keeps unequal Meesho sale vs return amounts and Net Sales = Sales + Returns', () => {
    // Real pattern: earlier RTO stamps a lower sale+return; later Cancelled
    // payout carries a higher Total Sale with bank ≈ Sales + Fees.
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'rto',
        source: 'meesho_order_payments',
        orderId: '282069108232530368_1',
        marketplace: 'meesho',
        transactionId: 'AXISCN1369930667',
        neftId: 'AXISCN1369930667',
        paymentDate: '2026-06-09',
        saleAmount: 634,
        refund: -634,
        quantity: 1,
        bankSettlementValue: 0,
        sellerSku: 'King_White_NavyBLUE_2',
        documentType: 'RTO',
      },
      {
        _id: 'pay',
        source: 'meesho_order_payments',
        orderId: '282069108232530368_1',
        marketplace: 'meesho',
        transactionId: 'AXISCN1388893720',
        neftId: 'AXISCN1388893720',
        paymentDate: '2026-06-29',
        saleAmount: 674,
        refund: 0,
        quantity: 1,
        bankSettlementValue: 507.94,
        marketplaceFee: -166.06,
        sellerSku: 'King_White_NavyBLUE_2',
        documentType: 'Cancelled',
      },
    ]);

    expect(rows).toHaveLength(2);
    const sale = rows.find((r) => r.transactionId === 'AXISCN1388893720');
    const ret = rows.find((r) => r.transactionId === 'AXISCN1369930667');
    expect(sale?.saleAmount).toBe(674);
    expect(sale?.refund).toBe(0);
    expect(ret?.saleAmount).toBe(0);
    expect(ret?.refund).toBe(-634);

    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.sales).toBe(674);
    expect(lifecycle.returns).toBe(-634);
    expect(lifecycle.netSales).toBe(40);
    expect(lifecycle.bankPayout).toBeCloseTo(507.94, 2);
    expect(lifecycle.marketplaceFees).toBeCloseTo(-166.06, 2);
    // Must not set Difference to the Return amount (−634).
    expect(lifecycle.difference).toBe(0);
  });

  it('does not dedupe Flipkart/Amazon rows', () => {
    const rows = dedupeMeeshoDuplicatePaymentTransactions([
      {
        _id: 'fk-1',
        source: 'flipkart_payment_order_reports',
        orderId: 'OD1',
        marketplace: 'flipkart',
        transactionId: 'N1',
        neftId: 'N1',
      },
      {
        _id: 'imp-fk',
        source: 'import_rows',
        orderId: 'OD1',
        marketplace: 'flipkart',
        transactionId: 'N1',
        neftId: 'N1',
      },
    ]);
    expect(rows).toHaveLength(2);
  });
});
