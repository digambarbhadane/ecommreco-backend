import {
  aggregateOrderPaymentLifecycle,
} from '../../src/report-import/payments/payment-reconciliation.util';
import {
  aggregateMyntraPgFees,
  buildMyntraInvoiceOrderIdMap,
  canonicalizeMyntraPaymentAnalyticsOrderIds,
  cleanMyntraInvoiceNumber,
  dedupeMyntraPgSettlementDocs,
  attachMyntraPgNeftIdsToGstRows,
  enrichMyntraPaymentAnalyticsRows,
  linkMyntraCustomerReturnsToSales,
  mapMyntraPgSettlementToAnalyticsRow,
} from '../../src/report-import/payments/myntra/myntra-payment-analytics.mapper';
import { resolveMyntraAnalyticsInvoiceDate } from '../../src/report-import/payments/myntra/myntra-invoice-date.util';
import type { PaymentAnalyticsRow } from '../../src/report-import/payments/payment-analytics.types';
import { mapImportRowToPaymentAnalyticsRow } from '../../src/report-import/payments/payment-analytics.types';

describe('myntra-payment-analytics.mapper', () => {
  it('cleans quoted Myntra invoice numbers', () => {
    expect(cleanMyntraInvoiceNumber('\\"I2426MX000000011\\"')).toBe(
      'I2426MX000000011',
    );
    expect(cleanMyntraInvoiceNumber('"INV-1"')).toBe('INV-1');
  });

  it('maps import_rows invoiceNo onto invoiceId', () => {
    const row = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-1',
      orderID: '5698497068',
      documentType: 'SALE',
      invoiceNo: 'I2426MX000000365',
      invoiceDate: '2025-05-12',
      invoiceAmount: 1846,
      marketplace: 'myntra-link',
    });
    expect(row.invoiceId).toBe('I2426MX000000365');
    expect(row.saleAmount).toBe(1846);
  });

  it('prefers Myntra order_packed_date (DD-MM-YYYY) over swapped invoiceDate ISO', () => {
    expect(
      resolveMyntraAnalyticsInvoiceDate({
        documentType: 'SALE',
        invoiceDate: '2025-06-10',
        order_packed_date: '06-10-2025',
      }),
    ).toBe('2025-10-06');

    expect(
      resolveMyntraAnalyticsInvoiceDate({
        documentType: 'SALE',
        invoiceDate: '2026-06-12',
        order_packed_date: '06-12-2026',
      }),
    ).toBe('2026-12-06');

    expect(
      resolveMyntraAnalyticsInvoiceDate({
        documentType: 'SALE',
        invoiceDate: '2026-12-06',
        order_packed_date: '12-06-2026',
      }),
    ).toBe('2026-06-12');

    const mapped = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-swap',
      orderID: '5632765932',
      documentType: 'SALE',
      invoiceDate: '2025-06-10',
      order_packed_date: '06-10-2025',
      invoiceAmount: 100,
      marketplace: 'myntra-link',
    });
    expect(mapped.invoiceDate).toBe('2025-10-06');
  });

  it('does not alter Flipkart invoice dates via Myntra resolver', () => {
    expect(
      resolveMyntraAnalyticsInvoiceDate({
        documentType: 'Sale',
        invoiceDate: '2025-06-10',
        order_packed_date: '06-10-2025',
      }),
    ).toBeUndefined();

    const fk = mapImportRowToPaymentAnalyticsRow({
      _id: 'fk-1',
      orderID: 'OD1',
      documentType: 'Sale',
      invoiceDate: '2025-06-10',
      order_packed_date: '06-10-2025',
      invoiceAmount: 100,
      marketplace: 'flipkart',
    });
    expect(fk.invoiceDate).toBe('2025-06-10');
  });

  it('links invoice-less Customer Return to same-order SALE and copies invoice metadata', () => {
    const sale = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-same',
      orderID: '5692402553',
      documentType: 'SALE',
      invoiceNo: 'I2426MX000000344',
      invoiceDate: '2025-12-01',
      invoiceAmount: 817,
      taxableAmount: 778.095238,
      skuID: 'MMTBBLBGM',
      quantity: 1,
      marketplace: 'myntra-link',
      uploadId: 'upload-1',
    });
    const ret = mapImportRowToPaymentAnalyticsRow({
      _id: 'ret-same',
      orderID: '5692402553',
      documentType: 'Customer Return',
      invoiceAmount: -817,
      taxableAmount: -778.095238,
      refund: 817,
      quantity: -1,
      marketplace: 'myntra-link',
      uploadId: 'upload-1',
      myntraReturnMatchStatus: 'UNMATCHED_RETURN',
    });

    const linked = linkMyntraCustomerReturnsToSales([sale, ret]);
    expect(linked[1].orderId).toBe('5692402553');
    expect(linked[1].invoiceId).toBe('I2426MX000000344');
    expect(linked[1].sellerSku).toBe('MMTBBLBGM');
    expect(linked[1].invoiceDate).toBeUndefined();

    const lifecycle = aggregateOrderPaymentLifecycle(linked);
    expect(lifecycle.sales).toBe(817);
    expect(lifecycle.returns).toBe(-817);
    expect(lifecycle.netSales).toBe(0);
  });

  it('links invoice-less Customer Return onto SALE but keeps return Order Id', () => {
    const sale = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-cross',
      orderID: '3180b511-9b13-418b-9817-149c67343431',
      documentType: 'SALE',
      invoiceNo: 'I2426MX000000342',
      invoiceDate: '2025-12-01',
      invoiceAmount: 817,
      taxableAmount: 778.095238,
      paymentMode: 'cod',
      stateName: 'uttarakhand',
      marketplace: 'myntra-link',
      uploadId: 'upload-dec',
    });
    const otherSale = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-other',
      orderID: '5692047728',
      documentType: 'SALE',
      invoiceNo: 'I2426MX000000346',
      invoiceAmount: 817,
      taxableAmount: 778.095238,
      paymentMode: 'on',
      stateName: 'maharashtra',
      marketplace: 'myntra-link',
      uploadId: 'upload-dec',
    });
    const ret = mapImportRowToPaymentAnalyticsRow({
      _id: 'ret-cross',
      orderID: '5691081908',
      documentType: 'Customer Return',
      invoiceAmount: -817,
      taxableAmount: -778.095238,
      refund: 817,
      paymentMode: 'cod',
      stateName: 'uttarakhand',
      quantity: -1,
      marketplace: 'myntra-link',
      uploadId: 'upload-dec',
      myntraReturnMatchStatus: 'UNMATCHED_RETURN',
    });

    const linked = linkMyntraCustomerReturnsToSales([sale, otherSale, ret]);
    expect(linked[2].orderId).toBe('5691081908');
    expect(linked[2].invoiceId).toBe('I2426MX000000342');

    const enriched = enrichMyntraPaymentAnalyticsRows(
      [sale, otherSale, ret],
      [],
    );
    const group = enriched.filter((row) => row.orderId === '5691081908');
    expect(group).toHaveLength(2);
    expect(group.map((row) => row.documentType).sort()).toEqual([
      'Customer Return',
      'SALE',
    ]);

    const lifecycle = aggregateOrderPaymentLifecycle(group);
    expect(lifecycle.sales).toBe(817);
    expect(lifecycle.returns).toBe(-817);
    expect(lifecycle.netSales).toBe(0);
  });

  it('does not guess when multiple sales match the same return fingerprint', () => {
    const saleA = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-a',
      orderID: '5908496843',
      documentType: 'SALE',
      invoiceAmount: 415,
      taxableAmount: 395.238095,
      paymentMode: 'cod',
      stateName: 'uttarakhand',
      marketplace: 'myntra-link',
      uploadId: 'upload-jan',
    });
    const saleB = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-b',
      orderID: '5902436776',
      documentType: 'SALE',
      invoiceAmount: 415,
      taxableAmount: 395.238095,
      paymentMode: 'cod',
      stateName: 'uttarakhand',
      marketplace: 'myntra-link',
      uploadId: 'upload-jan',
    });
    const ret = mapImportRowToPaymentAnalyticsRow({
      _id: 'ret-ambiguous',
      orderID: '5900488145',
      documentType: 'Customer Return',
      invoiceAmount: -415,
      taxableAmount: -395.238095,
      refund: 415,
      paymentMode: 'cod',
      stateName: 'uttarakhand',
      marketplace: 'myntra-link',
      uploadId: 'upload-jan',
      myntraReturnMatchStatus: 'UNMATCHED_RETURN',
    });

    const linked = linkMyntraCustomerReturnsToSales([saleA, saleB, ret]);
    expect(linked[2].orderId).toBe('5900488145');
    expect(linked[2].invoiceId).toBeUndefined();
  });

  it('prefers GSTR RTO Order Id over Sale_Order_Code for the same invoice', () => {
    const sale = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-1',
      orderID: '5698497068',
      documentType: 'SALE',
      invoiceNo: 'I2426MX000000365',
      invoiceDate: '2025-05-12',
      invoiceAmount: 1846,
      marketplace: 'myntra-link',
    });
    const rto = mapImportRowToPaymentAnalyticsRow({
      _id: 'rto-1',
      orderID: '8846287633',
      documentType: 'RTO Return',
      invoiceNo: 'I2426MX000000365',
      invoiceAmount: -1846,
      marketplace: 'myntra-link',
    });

    const invoiceMap = buildMyntraInvoiceOrderIdMap([sale, rto]);
    expect(invoiceMap.get('I2426MX000000365')).toBe('8846287633');

    const remapped = canonicalizeMyntraPaymentAnalyticsOrderIds(
      [sale, rto],
      invoiceMap,
    );
    expect(remapped[0].orderId).toBe('8846287633');
    expect(remapped[1].orderId).toBe('8846287633');

    const lifecycle = aggregateOrderPaymentLifecycle(remapped);
    expect(lifecycle.sales).toBe(1846);
    expect(lifecycle.returns).toBe(-1846);
    expect(lifecycle.netSales).toBe(0);
  });

  it('resolves portal Order Id for cross-month unmatched RTO linked by unique fingerprint', () => {
    const sale = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-112',
      orderID: '5651467782',
      documentType: 'SALE',
      invoiceNo: 'I2426MX000000112',
      invoiceDate: '2025-10-27',
      invoiceAmount: 275,
      taxableAmount: 261.904762,
      paymentMode: 'cod',
      stateName: 'maharashtra',
      skuID: 'MMSSPFSLVS',
      marketplace: 'myntra-link',
      uploadId: 'upload-oct',
      reportMonth: '2025-10',
    });
    const rto = mapImportRowToPaymentAnalyticsRow({
      _id: 'rto-112',
      orderID: '8767323224',
      documentType: 'RTO Return',
      invoiceAmount: -275,
      taxableAmount: -261.904762,
      refund: 275,
      paymentMode: 'cod',
      stateName: 'maharashtra',
      skuID: 'MMSSPFSLVS',
      quantity: -1,
      marketplace: 'myntra-link',
      uploadId: 'upload-nov',
      reportMonth: '2025-11',
      myntraReturnMatchStatus: 'UNMATCHED_RETURN',
    });

    const enriched = enrichMyntraPaymentAnalyticsRows([sale, rto], []);
    expect(enriched).toHaveLength(2);
    expect(enriched.every((row) => row.orderId === '8767323224')).toBe(true);
    expect(enriched.find((row) => row.documentType === 'SALE')?.invoiceId).toBe(
      'I2426MX000000112',
    );
    expect(
      enriched.find((row) => row.documentType === 'RTO Return')?.invoiceId,
    ).toBe('I2426MX000000112');
    expect(enriched.some((row) => row.orderId === '5651467782')).toBe(false);

    const lifecycle = aggregateOrderPaymentLifecycle(enriched);
    expect(lifecycle.sales).toBe(275);
    expect(lifecycle.returns).toBe(-275);
    expect(lifecycle.netSales).toBe(0);
  });

  it('does not rewrite Flipkart payment order ids', () => {
    const fk: PaymentAnalyticsRow = {
      _id: 'fk-1',
      source: 'flipkart_payment_order_reports',
      orderId: 'OD123',
      marketplace: 'flipkart',
      saleAmount: 100,
      documentType: 'Sale',
      invoiceId: 'INV-FK',
    };
    const invoiceMap = new Map([['INV-FK', 'OTHER']]);
    const out = canonicalizeMyntraPaymentAnalyticsOrderIds([fk], invoiceMap);
    expect(out[0].orderId).toBe('OD123');
  });

  it('dedupes duplicate PG reverse uploads of the same settlement line', () => {
    const docs = [
      {
        reportKind: 'reverse' as const,
        orderReleaseId: '8697817502',
        orderLineId: '10697746629',
        returnId: '100082722173',
        skuCode: 'SKU',
        totalActualSettlement: -1259.012,
        uploadedAt: '2025-09-01',
        rowData: {},
      },
      {
        reportKind: 'reverse' as const,
        orderReleaseId: '8697817502',
        orderLineId: '10697746629',
        returnId: '100082722173',
        skuCode: 'SKU',
        totalActualSettlement: -1259.012,
        uploadedAt: '2025-10-01',
        rowData: {},
      },
    ];
    const deduped = dedupeMyntraPgSettlementDocs(docs);
    expect(deduped).toHaveLength(1);
    expect(String(deduped[0].uploadedAt)).toContain('2025-10');
  });

  it('maps PG fees + settlement without inventing sales or returns', () => {
    const mapped = mapMyntraPgSettlementToAnalyticsRow(
      {
        _id: 'pg-1',
        reportKind: 'forward',
        orderReleaseId: '8697817502',
        orderLineId: '1',
        invoiceNumber: '\\"I2426MX000000011\\"',
        totalActualSettlement: 1008.852,
        rowData: {
          total_commission: -268.403,
          tcs_amount: 6.371,
          tds_amount: 1.274,
          total_commission_plus_tcs_tds_deduction: -276.048,
          total_logistics_deduction: -53.1,
          bank_utr_no_postpaid_payment: 'UTR-1',
          settlement_date_postpaid_payment: '2025-10-05',
        },
      },
      '5609787070',
    );

    expect(mapped.source).toBe('myntra_pg_settlement_rows');
    expect(mapped.orderId).toBe('5609787070');
    expect(mapped.saleAmount).toBeUndefined();
    expect(mapped.refund).toBeUndefined();
    expect(mapped.bankSettlementValue).toBeCloseTo(1008.852, 3);
    expect(mapped.marketplaceFee).toBeCloseTo(-329.148, 3);
    expect(mapped.neftId).toBe('UTR-1');
    expect(mapped.invoiceId).toBe('I2426MX000000011');
  });

  it('attaches PG payout/fees onto the portal RTO Order Id via invoice', () => {
    const sale = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-1',
      orderID: '5609787070',
      documentType: 'SALE',
      invoiceNo: 'I2426MX000000011',
      invoiceDate: '2025-09-23',
      invoiceAmount: 1338,
      marketplace: 'myntra-link',
    });
    const rto = mapImportRowToPaymentAnalyticsRow({
      _id: 'rto-1',
      orderID: 'DIFFERENT-RETURN-ID',
      documentType: 'RTO Return',
      invoiceNo: 'I2426MX000000011',
      invoiceAmount: -1338,
      marketplace: 'myntra-link',
    });

    const enriched = enrichMyntraPaymentAnalyticsRows([sale, rto], [
      {
        _id: 'fwd',
        reportKind: 'forward',
        orderReleaseId: '8697817502',
        orderLineId: '1',
        skuCode: 'SKU',
        totalActualSettlement: 1008.852,
        uploadedAt: '2025-10-01',
        rowData: {
          invoice_number: 'I2426MX000000011',
          total_commission_plus_tcs_tds_deduction: -276.048,
          total_logistics_deduction: -53.1,
        },
      },
      {
        _id: 'rev',
        reportKind: 'reverse',
        orderReleaseId: '8697817502',
        orderLineId: '1',
        returnId: 'ret-1',
        skuCode: 'SKU',
        invoiceNumber: '\\"I2426MX000000011\\"',
        totalActualSettlement: -1259.012,
        uploadedAt: '2025-10-01',
        rowData: {
          total_commission_plus_tcs_tds_deduction: 276.048,
          total_logistics_deduction: -197.06,
        },
      },
    ]);

    expect(new Set(enriched.map((row) => row.orderId))).toEqual(
      new Set(['DIFFERENT-RETURN-ID']),
    );

    const lifecycle = aggregateOrderPaymentLifecycle(enriched);
    expect(lifecycle.sales).toBe(1338);
    expect(lifecycle.returns).toBe(-1338);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBeCloseTo(1008.852 - 1259.012, 3);
    expect(lifecycle.marketplaceFees).toBeCloseTo(-329.148 + 78.988, 3);
  });

  it('aggregateMyntraPgFees matches product + fees → settlement identity', () => {
    const fees = aggregateMyntraPgFees({
      rowData: {
        total_commission_plus_tcs_tds_deduction: -276.048,
        total_logistics_deduction: -53.1,
      },
    });
    expect(fees.marketplaceFee).toBeCloseTo(-329.148, 3);
    expect(1338 + (fees.marketplaceFee ?? 0)).toBeCloseTo(1008.852, 3);
  });

  it('copies PG bank UTR onto matching GST sale and return rows', () => {
    const sale = mapImportRowToPaymentAnalyticsRow({
      _id: 'sale-1',
      orderID: '5622290072',
      documentType: 'SALE',
      invoiceNo: 'I2426MX000000021',
      invoiceAmount: 1338,
      marketplace: 'myntra-link',
    });
    const ret = mapImportRowToPaymentAnalyticsRow({
      _id: 'ret-1',
      orderID: '5622290072',
      documentType: 'Customer Return',
      invoiceNo: 'I2426MX000000021',
      invoiceAmount: -1338,
      marketplace: 'myntra-link',
    });

    const enriched = enrichMyntraPaymentAnalyticsRows([sale, ret], [
      {
        _id: 'pg-fwd',
        reportKind: 'forward',
        orderReleaseId: '8697817502',
        orderLineId: '1',
        invoiceNumber: 'I2426MX000000021',
        totalActualSettlement: 1008.852,
        uploadedAt: '2025-10-01',
        rowData: {
          bank_utr_no_postpaid_payment: 'UTR-FWD-1',
          settlement_date_postpaid_payment: '2025-10-23',
        },
      },
      {
        _id: 'pg-rev',
        reportKind: 'reverse',
        orderReleaseId: '8720075202',
        orderLineId: '1',
        returnId: 'ret-1',
        invoiceNumber: 'I2426MX000000021',
        totalActualSettlement: -1259.012,
        uploadedAt: '2025-10-01',
        rowData: {
          bank_utr_no_postpaid_payment: 'UTR-REV-1',
        },
      },
    ]);

    const gstSale = enriched.find((row) => row._id === 'sale-1');
    const gstReturn = enriched.find((row) => row._id === 'ret-1');
    expect(gstSale?.neftId).toBe('UTR-FWD-1');
    expect(gstReturn?.neftId).toBe('UTR-REV-1');
  });
});
