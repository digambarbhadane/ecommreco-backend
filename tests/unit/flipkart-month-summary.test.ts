import {
  aggregateFlipkartMonthSummaryFromRows,
  aggregateFlipkartNotesByOrderId,
  classifyFlipkartDocumentType,
  compareFlipkartVoucherTypes,
  computeFlipkartGrossSale,
  computeFlipkartNetSale,
  computeFlipkartReturnsNetTotal,
  isFlipkartCreditNoteDocumentType,
  isFlipkartDebitNoteDocumentType,
  mapFlipkartVoucherTypeSummaryRows,
  resolveFlipkartBucket,
  resolveFlipkartSummaryType,
} from '../../src/report-import/utils/workflow-month-summary.aggregation';
import { sellerStateKeysFromRegistration } from '../../src/report-import/utils/state-wise-gst-split.util';

describe('classifyFlipkartDocumentType', () => {
  it('treats Sale as gross sales only', () => {
    expect(classifyFlipkartDocumentType('Sale')).toEqual({
      isGrossSale: true,
      isReturnCancellation: false,
      isReturn: false,
      isCancellation: false,
      isReturnDeduction: false,
      isReturnAddition: false,
      isReturnActivity: false,
    });
  });

  it('treats Return Cancellation as return activity with plus sign', () => {
    expect(classifyFlipkartDocumentType('Return Cancellation')).toEqual({
      isGrossSale: false,
      isReturnCancellation: true,
      isReturn: false,
      isCancellation: false,
      isReturnDeduction: false,
      isReturnAddition: true,
      isReturnActivity: true,
    });
  });

  it('treats Return as a return deduction', () => {
    expect(classifyFlipkartDocumentType('Return')).toEqual({
      isGrossSale: false,
      isReturnCancellation: false,
      isReturn: true,
      isCancellation: false,
      isReturnDeduction: true,
      isReturnAddition: false,
      isReturnActivity: true,
    });
  });

  it('treats Cancellation as a return deduction', () => {
    expect(classifyFlipkartDocumentType('Cancellation')).toEqual({
      isGrossSale: false,
      isReturnCancellation: false,
      isReturn: false,
      isCancellation: true,
      isReturnDeduction: true,
      isReturnAddition: false,
      isReturnActivity: true,
    });
  });

  it('prefers the more specific voucher type when document type is generic', () => {
    expect(resolveFlipkartBucket('Return', 'Cancellation')).toEqual({
      bucket: 'cancellation',
      label: 'Cancellation',
    });
    expect(classifyFlipkartDocumentType('Return', 'Cancellation')).toEqual({
      isGrossSale: false,
      isReturnCancellation: false,
      isReturn: false,
      isCancellation: true,
      isReturnDeduction: true,
      isReturnAddition: false,
      isReturnActivity: true,
    });
  });

  it('prefers document type when it is more specific than voucher type', () => {
    expect(classifyFlipkartDocumentType('Cancellation', 'Return')).toEqual({
      isGrossSale: false,
      isReturnCancellation: false,
      isReturn: false,
      isCancellation: true,
      isReturnDeduction: true,
      isReturnAddition: false,
      isReturnActivity: true,
    });
  });

  it('falls back to voucher type when document type is empty', () => {
    expect(resolveFlipkartSummaryType('', 'Sale')).toBe('Sale');
    expect(classifyFlipkartDocumentType('', 'Return Cancellation')).toEqual({
      isGrossSale: false,
      isReturnCancellation: true,
      isReturn: false,
      isCancellation: false,
      isReturnDeduction: false,
      isReturnAddition: true,
      isReturnActivity: true,
    });
  });
});

describe('computeFlipkartReturnsNetTotal', () => {
  it('nets return and cancellation minus with return cancellation plus', () => {
    const net = computeFlipkartReturnsNetTotal(
      {
        totalRows: 2141,
        pcs: 2190,
        taxableValue: -469029.92,
        igst: -23015.48,
        cgst: -218.76,
        sgst: -218.76,
        invoiceAmount: -492482.92,
      },
      {
        totalRows: 465,
        pcs: 465,
        taxableValue: -96730.23,
        igst: -4753.7,
        cgst: -41.57,
        sgst: -41.57,
        invoiceAmount: -101567.07,
      },
      {
        totalRows: 88,
        pcs: 88,
        taxableValue: 18399.97,
        igst: 920.03,
        cgst: 0,
        sgst: 0,
        invoiceAmount: 19320,
      },
    );

    expect(net.totalRows).toBe(2694);
    expect(net.taxableValue).toBeCloseTo(-547360.18, 2);
    expect(net.invoiceAmount).toBeCloseTo(-574730, 0);
  });

  it('adds debit note into returns total', () => {
    const net = computeFlipkartReturnsNetTotal(
      {
        totalRows: 10,
        pcs: 10,
        taxableValue: -100,
        igst: -10,
        cgst: 0,
        sgst: 0,
        invoiceAmount: -110,
      },
      {
        totalRows: 0,
        pcs: 0,
        taxableValue: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        invoiceAmount: 0,
      },
      {
        totalRows: 0,
        pcs: 0,
        taxableValue: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        invoiceAmount: 0,
      },
      {
        totalRows: 2,
        pcs: 2,
        taxableValue: 20,
        igst: 2,
        cgst: 0,
        sgst: 0,
        invoiceAmount: 22,
      },
    );

    expect(net.invoiceAmount).toBe(-88);
  });
});

describe('computeFlipkartGrossSale and NetSale', () => {
  const sale = {
    totalRows: 100,
    pcs: 100,
    taxableValue: 1000,
    igst: 180,
    cgst: 0,
    sgst: 0,
    invoiceAmount: 1180,
  };
  const creditNote = {
    totalRows: 5,
    pcs: 5,
    taxableValue: 50,
    igst: 9,
    cgst: 0,
    sgst: 0,
    invoiceAmount: 59,
  };
  const returns = {
    totalRows: 20,
    pcs: 20,
    taxableValue: -200,
    igst: -36,
    cgst: 0,
    sgst: 0,
    invoiceAmount: -236,
  };

  it('gross sale = sale + credit note', () => {
    const gross = computeFlipkartGrossSale(sale, creditNote);
    expect(gross.invoiceAmount).toBe(1239);
  });

  it('net sale = gross sale + signed returns total', () => {
    const gross = computeFlipkartGrossSale(sale, creditNote);
    const net = computeFlipkartNetSale(gross, returns);
    expect(net.invoiceAmount).toBe(1003);
  });
});

describe('compareFlipkartVoucherTypes', () => {
  it('sorts voucher types in summary display order', () => {
    const sorted = [
      'Cancellation',
      'Return Cancellation',
      'Return',
      'Sale',
    ].sort(compareFlipkartVoucherTypes);

    expect(sorted).toEqual([
      'Sale',
      'Return Cancellation',
      'Return',
      'Cancellation',
    ]);
  });
});

describe('mapFlipkartVoucherTypeSummaryRows', () => {
  it('assigns categories and sorts rows by document type', () => {
    const rows = mapFlipkartVoucherTypeSummaryRows([
      {
        bucket: 'cancellation',
        label: 'Cancellation',
        count: 1,
        pcs: 1,
        invoiceAmount: -10,
        taxableAmount: -8,
        igst: -1,
        cgst: -0.5,
        sgst: -0.5,
      },
      {
        bucket: 'return_cancellation',
        label: 'Return Cancellation',
        count: 2,
        pcs: 2,
        invoiceAmount: 20,
        taxableAmount: 16,
        igst: 2,
        cgst: 1,
        sgst: 1,
      },
      {
        bucket: 'sale',
        label: 'Sale',
        count: 5,
        pcs: 5,
        invoiceAmount: 100,
        taxableAmount: 80,
        igst: 10,
        cgst: 5,
        sgst: 5,
      },
      {
        bucket: 'return',
        label: 'Return',
        count: 3,
        pcs: 3,
        invoiceAmount: -30,
        taxableAmount: -24,
        igst: -3,
        cgst: -1.5,
        sgst: -1.5,
      },
    ]);

    expect(rows.map((row) => row.voucherType)).toEqual([
      'Sale',
      'Return Cancellation',
      'Return',
      'Cancellation',
    ]);
    expect(rows.find((row) => row.voucherType === 'Return Cancellation')?.category).toBe(
      'returnSubPlus',
    );
    expect(rows.find((row) => row.voucherType === 'Return')?.category).toBe(
      'returnSubMinus',
    );
    expect(rows.find((row) => row.voucherType === 'Sale')?.category).toBe('gross');
  });
});

describe('Flipkart credit and debit notes', () => {
  it('detects credit and debit note document types', () => {
    expect(isFlipkartCreditNoteDocumentType('Credit Note')).toBe(true);
    expect(isFlipkartDebitNoteDocumentType('Debit Note')).toBe(true);
    expect(isFlipkartCreditNoteDocumentType('Debit Note')).toBe(false);
  });

  it('nets note amounts per order id before rolling up totals', () => {
    const totals = aggregateFlipkartNotesByOrderId([
      {
        orderID: 'ORD-1',
        documentType: 'Credit Note',
        quantity: 1,
        taxableAmount: 80,
        igstAmount: 20,
      },
      {
        orderID: 'ORD-1',
        documentType: 'Credit Note',
        quantity: 1,
        taxableAmount: 40,
        igstAmount: 10,
      },
      {
        orderID: 'ORD-2',
        documentType: 'Debit Note',
        quantity: 1,
        taxableAmount: 25,
        igstAmount: 5,
      },
    ]);

    expect(totals.creditNote.totalRows).toBe(1);
    expect(totals.creditNote.invoiceAmount).toBe(150);
    expect(totals.debitNote.totalRows).toBe(1);
    expect(totals.debitNote.invoiceAmount).toBe(30);
  });
});

describe('aggregateFlipkartMonthSummaryFromRows GST split', () => {
  const delhiSeller = sellerStateKeysFromRegistration('Delhi', '07AAAAA0000A1Z5');

  it('splits intra-state Delhi orders to CGST/SGST with zero IGST on sales', () => {
    const result = aggregateFlipkartMonthSummaryFromRows(
      [
        {
          documentType: 'Sale',
          stateName: 'Delhi',
          quantity: 1,
          taxableAmount: 1000,
          invoiceAmount: 1180,
          igstAmount: 180,
          reportType: 'sales',
        },
        {
          documentType: 'Sale',
          stateName: 'Gujarat',
          quantity: 1,
          taxableAmount: 500,
          invoiceAmount: 590,
          igstAmount: 90,
          reportType: 'sales',
        },
      ],
      delhiSeller,
    );

    expect(result.totals.flipkartGrossSalesIgst).toBe(90);
    expect(result.totals.flipkartGrossSalesCgst).toBe(90);
    expect(result.totals.flipkartGrossSalesSgst).toBe(90);
    expect(result.totals.intraStateSalesRows).toBe(1);
    expect(result.totals.interStateSalesRows).toBe(1);
  });

  it('applies GST split to return buckets', () => {
    const result = aggregateFlipkartMonthSummaryFromRows(
      [
        {
          documentType: 'Return',
          stateName: 'Delhi',
          quantity: 1,
          taxableAmount: 200,
          invoiceAmount: 236,
          igstAmount: 36,
          reportType: 'sales',
        },
      ],
      delhiSeller,
    );

    expect(result.totals.flipkartReturnIgst).toBe(0);
    expect(result.totals.flipkartReturnCgst).toBe(18);
    expect(result.totals.flipkartReturnSgst).toBe(18);
  });
});
