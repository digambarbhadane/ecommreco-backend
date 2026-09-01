import {
  applyMyntraSaleDisplayFieldsToReturn,
  buildMyntraSaleOrderLookupKey,
  enrichMyntraReturnRowsFromSaleMaps,
  myntraReturnNeedsSaleDisplayEnrichment,
  pickPreferredMyntraSaleDisplay,
} from '../../src/report-import/utils/myntra-return-sale-display.util';

describe('myntra-return-sale-display.util', () => {
  const sale = {
    _id: 'sale-1',
    sellerId: 'seller-1',
    gstin: '24ESNPK1432B1Z5',
    marketplace: 'mp-myntra',
    orderID: '5797360852',
    invoiceNo: 'I2426IB000015270',
    skuID: 'Drishti-Pink-S',
    reportMonth: '2025-03',
  };

  it('detects Myntra returns missing invoice or sku', () => {
    expect(
      myntraReturnNeedsSaleDisplayEnrichment({
        documentType: 'Customer Return',
        myntraTransactionType: 'RETURN',
        orderID: '5797360852',
      }),
    ).toBe(true);

    expect(
      myntraReturnNeedsSaleDisplayEnrichment({
        documentType: 'RTO Return',
        invoiceNo: 'I2426IB000015270',
        skuID: 'Drishti-Pink-S',
      }),
    ).toBe(false);

    expect(
      myntraReturnNeedsSaleDisplayEnrichment({
        documentType: 'SALE',
        orderID: '5797360852',
      }),
    ).toBe(false);
  });

  it('fills only blank Invoice No and SKU from related SALE', () => {
    const enriched = applyMyntraSaleDisplayFieldsToReturn(
      {
        documentType: 'Customer Return',
        orderID: '5797360852',
        taxableAmount: -100,
        invoiceAmount: -105,
        quantity: -1,
      },
      sale,
    );
    expect(enriched.invoiceNo).toBe('I2426IB000015270');
    expect(enriched.skuID).toBe('Drishti-Pink-S');
    expect(enriched.orderID).toBe('5797360852');
    expect(enriched.taxableAmount).toBe(-100);
    expect(enriched.invoiceAmount).toBe(-105);
    expect(enriched.quantity).toBe(-1);
  });

  it('does not overwrite existing Invoice No or SKU', () => {
    const enriched = applyMyntraSaleDisplayFieldsToReturn(
      {
        documentType: 'RTO Return',
        orderID: '5797360852',
        invoiceNo: 'EXISTING-INV',
        skuID: 'EXISTING-SKU',
      },
      sale,
    );
    expect(enriched.invoiceNo).toBe('EXISTING-INV');
    expect(enriched.skuID).toBe('EXISTING-SKU');
  });

  it('resolves SALE via linkedSaleRowId then order key', () => {
    const rows = [
      {
        documentType: 'Customer Return',
        myntraTransactionType: 'RETURN',
        sellerId: 'seller-1',
        gstin: '24ESNPK1432B1Z5',
        marketplace: 'mp-myntra',
        orderID: '5797360852',
        linkedSaleRowId: 'sale-1',
      },
      {
        documentType: 'RTO Return',
        myntraTransactionType: 'RETURN',
        sellerId: 'seller-1',
        gstin: '24ESNPK1432B1Z5',
        marketplace: 'mp-myntra',
        orderID: '5804953924',
      },
      {
        documentType: 'Customer Return',
        myntraTransactionType: 'RETURN',
        sellerId: 'seller-1',
        gstin: '24ESNPK1432B1Z5',
        marketplace: 'mp-myntra',
        orderID: 'NO-SALE',
      },
    ];

    const byId = new Map([['sale-1', sale]]);
    const byOrder = new Map([
      [
        buildMyntraSaleOrderLookupKey({
          sellerId: 'seller-1',
          gstin: '24ESNPK1432B1Z5',
          marketplace: 'mp-myntra',
          orderID: '5804953924',
        }),
        {
          ...sale,
          _id: 'sale-2',
          orderID: '5804953924',
          invoiceNo: 'I2426IB000016010',
          skuID: 'Tanvika-Mustard-S',
        },
      ],
    ]);

    const enriched = enrichMyntraReturnRowsFromSaleMaps(rows, byId, byOrder);
    expect(enriched[0].invoiceNo).toBe('I2426IB000015270');
    expect(enriched[0].skuID).toBe('Drishti-Pink-S');
    expect(enriched[1].invoiceNo).toBe('I2426IB000016010');
    expect(enriched[1].skuID).toBe('Tanvika-Mustard-S');
    expect(enriched[2].invoiceNo).toBeUndefined();
    expect(enriched[2].skuID).toBeUndefined();
  });

  it('prefers SALE with both invoice and sku', () => {
    const preferred = pickPreferredMyntraSaleDisplay([
      {
        orderID: '1',
        invoiceNo: '',
        skuID: 'Only-Sku',
        reportMonth: '2025-04',
      },
      {
        orderID: '1',
        invoiceNo: 'INV-1',
        skuID: 'Full-Sku',
        reportMonth: '2025-03',
      },
    ]);
    expect(preferred?.invoiceNo).toBe('INV-1');
    expect(preferred?.skuID).toBe('Full-Sku');
  });
});
