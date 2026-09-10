import {
  getNetSales,
  getBankPayout,
  getPaymentDifference,
  getMarketplaceFeesAmount,
  getExpectedBankPayout,
  getReturnAmount,
  getReturnDeduction,
  aggregateOrderPaymentLifecycle,
  getOrderReconciliationStatus,
  isFlipkartCompletedReturnSettlement,
  isIgnoredPaymentDifference,
  isPaymentDispute,
  isPaymentDue,
  isPaymentOverdue,
  isPaymentSettled,
  matchesPaymentStatus,
  resolveOrderPaymentDisplayStatus,
  summarizePaymentRecords,
  sumOrderWisePaymentColumnTotals,
  toOrderPaymentStatusRow,
} from '../../../src/report-import/payments/payment-reconciliation.util';

describe('payment-reconciliation.util', () => {
  it('deducts positive refunds from gross sales', () => {
    const row = { saleAmount: 1000, refund: 100 };
    expect(getReturnDeduction(row)).toBe(100);
    expect(getReturnAmount(row)).toBe(-100);
    expect(getNetSales(row)).toBe(900);
  });

  it('nets same-row sale and negative refund to zero', () => {
    const row = { saleAmount: 301, refund: -301 };
    expect(getReturnDeduction(row)).toBe(301);
    expect(getReturnAmount(row)).toBe(-301);
    expect(getNetSales(row)).toBe(0);
  });

  it('computes difference from expected vs actual payout', () => {
    const row = {
      saleAmount: 301,
      refund: 0,
      bankSettlementValue: 250,
      commission: -51,
    };
    expect(getExpectedBankPayout(row)).toBe(250);
    expect(getPaymentDifference(row)).toBe(0);
  });

  it('nets marketplaceFee and commission with signs preserved', () => {
    const row = {
      saleAmount: 500,
      bankSettlementValue: 300,
      marketplaceFee: -40,
      commission: -60,
    };
    expect(getMarketplaceFeesAmount(row)).toBe(-100);
    expect(getPaymentDifference(row)).toBe(100);
  });

  it('marks full-return zero-bank orders as settled when net sales and bank are zero', () => {
    const rows = [
      {
        orderId: 'OD-ZERO',
        orderItemId: 'item-1',
        saleAmount: 500,
        bankSettlementValue: 0,
        marketplaceFee: 0,
        commission: 0,
      },
      {
        orderId: 'OD-ZERO',
        orderItemId: 'item-1',
        saleAmount: 500,
        refund: -500,
        bankSettlementValue: 0,
        marketplaceFee: 0,
        commission: 0,
      },
    ];
    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBe(0);
    expect(lifecycle.difference).toBe(0);
    expect(getOrderReconciliationStatus(rows)).toBe('settled');
    const summary = summarizePaymentRecords(rows);
    expect(summary.settledCount).toBe(1);
    expect(summary.disputeCount).toBe(0);
    expect(summary.overdueCount).toBe(0);
  });

  it('Net Sales = Sales + Returns when amounts differ and bank matches sale settlement', () => {
    const lifecycle = aggregateOrderPaymentLifecycle([
      {
        orderId: 'SUB-PARTIAL-NET',
        source: 'meesho_order_payments',
        marketplace: 'meesho',
        sellerSku: 'SKU-A',
        saleAmount: 0,
        refund: -482,
        bankSettlementValue: 0,
        marketplaceFee: 0,
      },
      {
        orderId: 'SUB-PARTIAL-NET',
        source: 'meesho_order_payments',
        marketplace: 'meesho',
        sellerSku: 'SKU-A',
        saleAmount: 533.76,
        refund: 0,
        bankSettlementValue: 514.57,
        marketplaceFee: -19.19,
      },
    ]);
    expect(lifecycle.sales).toBeCloseTo(533.76, 2);
    expect(lifecycle.returns).toBe(-482);
    expect(lifecycle.netSales).toBeCloseTo(51.76, 2);
    expect(lifecycle.difference).toBe(0);
  });

  it('prefers Amazon payment settlements over GST import_rows for amounts', () => {
    const lifecycle = aggregateOrderPaymentLifecycle([
      {
        _id: 'gst-sale',
        orderId: '403-AMZ-1',
        source: 'import_rows',
        marketplace: 'amazon',
        documentType: 'SALE',
        saleAmount: 1000,
        invoiceAmount: 1000,
        bankSettlementValue: 0,
      },
      {
        _id: 'amz-settle',
        orderId: '403-AMZ-1',
        source: 'amazon_payment_transactions',
        marketplace: 'amazon',
        neftId: 'SETTLE-1',
        transactionId: 'SETTLE-1',
        saleAmount: 500,
        refund: 0,
        marketplaceFee: -50,
        commission: -30,
        bankSettlementValue: 420,
      },
    ]);
    expect(lifecycle.sales).toBe(500);
    expect(lifecycle.returns).toBe(0);
    expect(lifecycle.netSales).toBe(500);
    expect(lifecycle.marketplaceFees).toBeCloseTo(-80, 2);
    expect(lifecycle.bankPayout).toBe(420);
    expect(lifecycle.difference).toBe(0);
  });

  it('sums Amazon sales across distinct settlements (not max-per-invoice)', () => {
    const lifecycle = aggregateOrderPaymentLifecycle([
      {
        orderId: '403-MULTI',
        source: 'amazon_payment_transactions',
        marketplace: 'amazon',
        neftId: 'S1',
        transactionId: 'S1',
        invoiceId: 'INV-SHARED',
        sellerSku: 'SKU-1',
        saleAmount: 400,
        bankSettlementValue: 350,
        marketplaceFee: -30,
        commission: -20,
      },
      {
        orderId: '403-MULTI',
        source: 'amazon_payment_transactions',
        marketplace: 'amazon',
        neftId: 'S2',
        transactionId: 'S2',
        invoiceId: 'INV-SHARED',
        sellerSku: 'SKU-1',
        saleAmount: 200,
        bankSettlementValue: 170,
        marketplaceFee: -20,
        commission: -10,
      },
    ]);
    expect(lifecycle.sales).toBe(600);
    expect(lifecycle.bankPayout).toBe(520);
    expect(lifecycle.marketplaceFees).toBeCloseTo(-80, 2);
    expect(lifecycle.difference).toBe(0);
  });

  it('aggregates full return lifecycle without double-counting mirrored sales', () => {
    const lifecycle = aggregateOrderPaymentLifecycle([
      {
        orderItemId: 'item-1',
        saleAmount: 273,
        bankSettlementValue: 193.52,
        commission: -50,
        marketplaceFee: -29.48,
      },
      {
        orderItemId: 'item-1',
        saleAmount: 273,
        refund: -273,
        bankSettlementValue: -193.52,
        commission: 50,
        marketplaceFee: 29.48,
      },
    ]);
    expect(lifecycle.sales).toBe(273);
    expect(lifecycle.returns).toBe(-273);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.marketplaceFees).toBe(0);
    expect(lifecycle.bankPayout).toBe(0);
    expect(lifecycle.difference).toBe(0);
  });

  it('sums multi-SKU sales once per item across repeated NEFT saleAmount copies', () => {
    const lifecycle = aggregateOrderPaymentLifecycle([
      {
        orderItemId: 'A',
        sellerSku: 'SKU-A',
        saleAmount: 150,
        bankSettlementValue: 140,
        marketplaceFee: -10,
      },
      {
        orderItemId: 'A',
        sellerSku: 'SKU-A',
        saleAmount: 150,
        bankSettlementValue: 5,
        marketplaceFee: -1,
      },
      {
        orderItemId: 'B',
        sellerSku: 'SKU-B',
        saleAmount: 151,
        bankSettlementValue: 141,
        marketplaceFee: -10,
      },
      {
        orderItemId: 'A',
        sellerSku: 'SKU-A',
        saleAmount: 150,
        refund: -150,
        bankSettlementValue: -145,
        marketplaceFee: 11,
      },
      {
        orderItemId: 'B',
        sellerSku: 'SKU-B',
        saleAmount: 151,
        refund: -151,
        bankSettlementValue: -141,
        marketplaceFee: 10,
      },
    ]);
    expect(lifecycle.sales).toBe(301);
    expect(lifecycle.returns).toBe(-301);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.marketplaceFees).toBe(0);
    expect(lifecycle.bankPayout).toBe(0);
    expect(lifecycle.difference).toBe(0);
  });

  it('treats reconciled return lifecycle as settled at order level', () => {
    const rows = [
      {
        orderId: 'OD-RET',
        orderItemId: 'item-1',
        saleAmount: 273,
        bankSettlementValue: 260.82,
        marketplaceFee: -12.18,
      },
      {
        orderId: 'OD-RET',
        orderItemId: 'item-1',
        saleAmount: 273,
        refund: -273,
        bankSettlementValue: -454.34,
        marketplaceFee: -181.34,
      },
    ];
    expect(getOrderReconciliationStatus(rows)).toBe('settled');
    // Leaf return NEFT alone: settlement exists + material Diff → Dispute.
    expect(isPaymentDispute(rows[1])).toBe(true);
  });

  it('marks negative bank settlement with Diff within ±1 as Settled', () => {
    const now = Date.parse('2026-08-21T12:00:00.000Z');
    const row = {
      saleAmount: 599,
      refund: -599,
      marketplaceFee: -209.44,
      bankSettlementValue: -209.44,
      invoiceDate: '2026-06-01',
    };
    expect(isPaymentSettled(row)).toBe(true);
    expect(isPaymentOverdue(row, now)).toBe(false);
  });

  it('marks Flipkart return settlement (Net Sales 0, bank 0) as Settled — not Overdue', () => {
    const now = Date.parse('2026-08-21T12:00:00.000Z');
    const sale = {
      orderId: 'OD434387569951879100',
      marketplace: 'flipkart',
      source: 'import_rows' as const,
      documentType: 'Sale',
      saleAmount: 199,
      refund: 0,
      bankSettlementValue: 0,
      marketplaceFee: 0,
      commission: 0,
      invoiceDate: '2025-05-12',
      sellerSku: 'MMASPK',
    };
    const returned = {
      orderId: 'OD434387569951879100',
      marketplace: 'flipkart',
      source: 'flipkart_payment_order_reports' as const,
      returnType: 'Logistics Return',
      saleAmount: 199,
      refund: -199,
      bankSettlementValue: 0,
      marketplaceFee: 0,
      commission: 0,
      invoiceDate: '2025-05-12',
      sellerSku: 'MMASPK',
    };
    const statusRow = toOrderPaymentStatusRow([sale, returned]);
    expect(statusRow.marketplace).toBe('flipkart');
    expect(getNetSales(statusRow)).toBe(0);
    expect(getBankPayout(statusRow)).toBe(0);
    expect(isPaymentSettled(statusRow)).toBe(true);
    expect(isPaymentOverdue(statusRow, now)).toBe(false);
    expect(isPaymentDue(statusRow, now)).toBe(false);
    expect(resolveOrderPaymentDisplayStatus([sale, returned], now)).toBe(
      'Settled',
    );
    expect(matchesPaymentStatus(statusRow, 'settled', now)).toBe(true);
    expect(matchesPaymentStatus(statusRow, 'overdue', now)).toBe(false);
  });

  it('marks Amazon zero-bank full return as Settled via zero net/bank rule (not Flipkart rule)', () => {
    const now = Date.parse('2026-08-21T12:00:00.000Z');
    const row = {
      marketplace: 'amazon',
      saleAmount: 199,
      refund: -199,
      bankSettlementValue: 0,
      marketplaceFee: 0,
      commission: 0,
      invoiceDate: '2025-05-12',
    };
    expect(isFlipkartCompletedReturnSettlement(row)).toBe(false);
    expect(isPaymentSettled(row)).toBe(true);
    expect(isPaymentOverdue(row, now)).toBe(false);
  });

  it('marks Myntra zero-net zero-bank full return as Settled (not Overdue)', () => {
    const now = Date.parse('2026-08-21T12:00:00.000Z');
    const sale = {
      orderId: '5929134867',
      marketplace: 'myntra',
      source: 'import_rows' as const,
      documentType: 'Sale',
      saleAmount: 720,
      refund: 0,
      bankSettlementValue: 0,
      marketplaceFee: 0,
      commission: 0,
      invoiceDate: '2025-05-12',
    };
    const returned = {
      orderId: '5929134867',
      marketplace: 'myntra',
      source: 'import_rows' as const,
      documentType: 'Customer Return',
      saleAmount: 0,
      refund: -720,
      bankSettlementValue: 0,
      marketplaceFee: 0,
      commission: 0,
      invoiceDate: '2025-05-12',
    };
    const statusRow = toOrderPaymentStatusRow([sale, returned]);
    expect(statusRow.marketplace).toBe('myntra');
    expect(getNetSales(statusRow)).toBe(0);
    expect(getBankPayout(statusRow)).toBe(0);
    expect(getPaymentDifference(statusRow)).toBe(0);
    expect(isPaymentSettled(statusRow)).toBe(true);
    expect(isPaymentDue(statusRow, now)).toBe(false);
    expect(isPaymentOverdue(statusRow, now)).toBe(false);
    expect(resolveOrderPaymentDisplayStatus([sale, returned], now)).toBe(
      'Settled',
    );
  });

  it('recovers Meesho sales that only appear on the return row', () => {
    const lifecycle = aggregateOrderPaymentLifecycle([
      { saleAmount: 0, bankSettlementValue: 351.48, commission: 0 },
      {
        saleAmount: 551,
        refund: -551,
        bankSettlementValue: -172,
        commission: 0,
      },
    ]);
    expect(lifecycle.sales).toBe(551);
    expect(lifecycle.returns).toBe(-551);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBeCloseTo(179.48);
  });

  it('adds Flipkart credit notes to Sales and debit notes to Return', () => {
    const lifecycle = aggregateOrderPaymentLifecycle([
      {
        orderItemId: 'item-1',
        saleAmount: 1000,
        bankSettlementValue: 900,
        marketplaceFee: -40,
      },
      {
        documentType: 'Credit Note',
        orderItemId: 'note-cn',
        saleAmount: 100,
        bankSettlementValue: 0,
      },
      {
        orderItemId: 'item-1',
        saleAmount: 1000,
        refund: -300,
        bankSettlementValue: -250,
        marketplaceFee: 10,
      },
      {
        documentType: 'Debit Note',
        orderItemId: 'note-dn',
        refund: -50,
        bankSettlementValue: 0,
      },
    ]);
    expect(lifecycle.originalSales).toBe(1000);
    expect(lifecycle.creditNotes).toBe(100);
    expect(lifecycle.sales).toBe(1100);
    expect(lifecycle.originalReturns).toBe(-300);
    expect(lifecycle.debitNotes).toBe(-50);
    expect(lifecycle.returns).toBe(-350);
    expect(lifecycle.netSales).toBe(750);
    expect(lifecycle.marketplaceFees).toBe(-30);
    expect(lifecycle.bankPayout).toBe(650);
  });

  it('adds Flipkart Return Cancellation to Sales and Sales Cancellation to Return', () => {
    const lifecycle = aggregateOrderPaymentLifecycle([
      {
        orderItemId: 'item-1',
        saleAmount: 1000,
        bankSettlementValue: 700,
        marketplaceFee: -100,
        commission: -100,
      },
      {
        documentType: 'Return Cancellation',
        saleAmount: 150,
        invoiceAmount: 150,
      },
      {
        documentType: 'Cancellation',
        invoiceAmount: 80,
      },
    ]);
    expect(lifecycle.sales).toBe(1150);
    expect(lifecycle.returns).toBe(-80);
    expect(lifecycle.netSales).toBe(1070);
  });

  it('excludes settled orders from overdue even when older than 30 days', () => {
    const now = Date.parse('2026-08-17T00:00:00.000Z');
    const settledOld = {
      saleAmount: 1000,
      bankSettlementValue: 1000,
      invoiceDate: '2026-06-14',
      commission: 0,
    };
    const unpaidOld = {
      saleAmount: 1000,
      bankSettlementValue: 0,
      invoiceDate: '2026-06-14',
      commission: 0,
    };
    const partialOld = {
      saleAmount: 1000,
      bankSettlementValue: 600,
      invoiceDate: '2026-06-14',
      commission: 0,
    };
    const unpaidYoung = {
      saleAmount: 1000,
      bankSettlementValue: 0,
      invoiceDate: '2026-08-10',
      commission: 0,
    };
    // Exactly 30 days old → Overdue (age >= 30).
    const unpaidDay30 = {
      saleAmount: 1000,
      bankSettlementValue: 0,
      invoiceDate: '2026-07-18',
      commission: 0,
    };

    expect(isPaymentOverdue(settledOld, now)).toBe(false);
    expect(isPaymentDue(settledOld, now)).toBe(false);
    expect(isPaymentOverdue(unpaidOld, now)).toBe(true);
    expect(isPaymentDue(unpaidOld, now)).toBe(false);
    // Partial payment → Dispute, never Due/Overdue.
    expect(isPaymentOverdue(partialOld, now)).toBe(false);
    expect(isPaymentDue(partialOld, now)).toBe(false);
    expect(isPaymentDispute(partialOld)).toBe(true);
    expect(isPaymentDue(unpaidYoung, now)).toBe(true);
    expect(isPaymentOverdue(unpaidYoung, now)).toBe(false);
    expect(isPaymentDispute(unpaidYoung)).toBe(false);
    expect(isPaymentDue(unpaidDay30, now)).toBe(false);
    expect(isPaymentOverdue(unpaidDay30, now)).toBe(true);
  });

  it('does not invent returns from Flipkart returnType when refund is 0', () => {
    const summary = summarizePaymentRecords([
      {
        orderId: 'OD-SALE',
        saleAmount: 500,
        refund: 0,
        bankSettlementValue: 400,
      },
      {
        orderId: 'OD-SALE-TAGGED',
        saleAmount: 500,
        refund: 0,
        returnType: 'Customer Return',
        bankSettlementValue: -100,
      },
      {
        orderId: 'OD-RET2',
        saleAmount: 0,
        documentType: 'Return',
        invoiceAmount: 200,
        refund: 200,
        bankSettlementValue: 0,
      },
    ]);
    // returnType + refund 0 is a Sale settlement NEFT, not a Return.
    expect(summary.salesRecords).toBe(2);
    expect(summary.returnRecords).toBe(1);
    expect(summary.totalOrderRecords).toBe(3);
    expect(
      getReturnAmount({ saleAmount: 500, returnType: 'Customer Return', refund: 0 }),
    ).toBe(0);
    expect(
      getReturnAmount({
        saleAmount: 500,
        returnType: 'Customer Return',
        refund: -500,
      }),
    ).toBe(-500);
  });

  it('aggregates Flipkart sale NEFT (returnType) + refund NEFT without double return', () => {
    const gstSale = {
      orderId: 'OD-PAIR',
      marketplace: 'flipkart',
      source: 'import_rows' as const,
      documentType: 'Sale',
      saleAmount: 443,
      refund: 0,
      bankSettlementValue: 0,
      _id: 'fk-sale:1',
      sellerSku: 'SKU-A',
      invoiceId: 'FATQXW1',
    };
    const cn = {
      orderId: 'OD-PAIR',
      marketplace: 'flipkart',
      source: 'import_rows' as const,
      documentType: 'Credit Note',
      saleAmount: 30,
      refund: 0,
      bankSettlementValue: 0,
      invoiceId: 'CN1',
    };
    const dn = {
      orderId: 'OD-PAIR',
      marketplace: 'flipkart',
      source: 'import_rows' as const,
      documentType: 'Debit Note',
      saleAmount: 0,
      refund: -30,
      invoiceAmount: -30,
      bankSettlementValue: 0,
      invoiceId: 'DN1',
    };
    const saleNeft = {
      orderId: 'OD-PAIR',
      marketplace: 'flipkart',
      source: 'flipkart_payment_order_reports' as const,
      returnType: 'Logistics Return',
      saleAmount: 443,
      refund: 0,
      bankSettlementValue: 0,
      sellerSku: 'SKU-A',
    };
    const returnNeft = {
      orderId: 'OD-PAIR',
      marketplace: 'flipkart',
      source: 'flipkart_payment_order_reports' as const,
      returnType: 'Logistics Return',
      saleAmount: 443,
      refund: -443,
      bankSettlementValue: 0,
      sellerSku: 'SKU-A',
    };

    const rows = [gstSale, saleNeft, returnNeft, cn, dn];
    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.originalSales).toBe(443);
    expect(lifecycle.creditNotes).toBe(30);
    expect(lifecycle.sales).toBe(473);
    expect(lifecycle.originalReturns).toBe(-443);
    expect(lifecycle.debitNotes).toBe(-30);
    expect(lifecycle.returns).toBe(-473);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBe(0);
    expect(lifecycle.difference).toBe(0);

    const statusRow = toOrderPaymentStatusRow(rows);
    expect(isPaymentSettled(statusRow)).toBe(true);
  });

  it('sums Order Wise Payments column totals per Order ID', () => {
    const rows = [
      {
        orderId: 'OD-1',
        saleAmount: 100,
        bankSettlementValue: 60,
        marketplaceFee: -30,
        commission: -10,
      },
      {
        orderId: 'OD-2',
        saleAmount: 200,
        refund: -50,
        bankSettlementValue: 120,
        marketplaceFee: -20,
        commission: -10,
      },
    ];
    const totals = sumOrderWisePaymentColumnTotals(rows);
    expect(totals.sales).toBe(300);
    expect(totals.returns).toBe(-50);
    expect(totals.netSales).toBe(250);
    expect(totals.marketplaceFees).toBe(-70);
    expect(totals.bankPayout).toBe(180);
    expect(totals.difference).toBe(
      aggregateOrderPaymentLifecycle([rows[0]]).difference +
        aggregateOrderPaymentLifecycle([rows[1]]).difference,
    );
  });

  it('classifies order status from final lifecycle Difference and ±₹1 tolerance', () => {
    expect(
      resolveOrderPaymentDisplayStatus([
        {
          orderId: 'OD-0',
          saleAmount: 500,
          bankSettlementValue: 500,
          commission: 0,
        },
      ]),
    ).toBe('Settled');
    expect(
      resolveOrderPaymentDisplayStatus([
        {
          orderId: 'OD-HALF',
          saleAmount: 500,
          bankSettlementValue: 499.5,
          commission: 0,
        },
      ]),
    ).toBe('Settled');
    expect(
      resolveOrderPaymentDisplayStatus([
        {
          orderId: 'AMZ-1',
          saleAmount: 1000,
          commission: -100,
          marketplaceFee: -50,
          bankSettlementValue: 1013.4,
        },
      ]),
    ).toBe('Dispute');
    expect(getPaymentDifference({
      saleAmount: 1000,
      commission: -100,
      marketplaceFee: -50,
      bankSettlementValue: 1013.4,
    })).toBeCloseTo(-163.4);
  });
});
