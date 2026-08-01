import {
  buildFlipkartPaymentMergeKey,
  mergeFlipkartPaymentRowsByOrderId,
} from '../../src/report-import/payments/flipkart/flipkart-payment-merge.util';

describe('flipkart payment order+neft merge', () => {
  it('sums amounts for same Order ID and same NEFT ID', () => {
    const merged = mergeFlipkartPaymentRowsByOrderId(
      {
        orderId: 'OD1',
        orderItemId: 'ITEM-1',
        bankSettlementValue: 100,
        saleAmount: 120,
        refund: 0,
        quantity: 1,
        neftId: 'NEFT-1',
        paymentDate: '2026-03-01',
        sellerSku: 'SKU-A',
      },
      {
        orderId: 'OD1',
        orderItemId: 'ITEM-2',
        bankSettlementValue: 50.5,
        saleAmount: 60,
        refund: 10,
        quantity: 2,
        neftId: 'NEFT-1',
        paymentDate: '2026-03-01',
        sellerSku: 'SKU-B',
      },
    );

    expect(merged.bankSettlementValue).toBe(150.5);
    expect(merged.quantity).toBe(3);
    expect(merged.neftId).toBe('NEFT-1');
  });

  it('builds different merge keys when NEFT IDs differ', () => {
    expect(buildFlipkartPaymentMergeKey('OD1', 'NEFT-A')).not.toBe(
      buildFlipkartPaymentMergeKey('OD1', 'NEFT-B'),
    );
    expect(buildFlipkartPaymentMergeKey('OD1', 'NEFT-A')).toBe(
      buildFlipkartPaymentMergeKey('OD1', ' NEFT-A '),
    );
  });
});
