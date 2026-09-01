import { mapFlipkartPaymentToAnalyticsRow } from '../../../src/report-import/payments/payment-analytics.types';
import {
  aggregateOrderPaymentLifecycle,
  getMarketplaceFeesAmount,
  getPaymentDifference,
} from '../../../src/report-import/payments/payment-reconciliation.util';

describe('Flipkart marketplace fee mapping', () => {
  it('normalizes seller-link marketplace ObjectIds to flipkart slug', () => {
    const row = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-oid',
      orderId: 'OD-OBJ',
      saleAmount: 100,
      bankSettlementValue: 80,
      marketplace: '6a476b04708c5b67c3a791ce',
    } as never);
    expect(row.marketplace).toBe('flipkart');
    expect(row.source).toBe('flipkart_payment_order_reports');
  });

  it('aggregates Flipkart fee components with signed values', () => {
    const row = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-1',
      orderId: 'OD-1001',
      saleAmount: 1000,
      bankSettlementValue: 700,
      commission: -100,
      fixedFee: -40,
      collectionFee: -20,
      shippingFee: -15,
      gstOnMarketplaceFees: -10,
      marketplace: 'flipkart',
    } as never);

    expect(row.commission).toBe(-100);
    expect(row.marketplaceFee).toBe(-85);
    expect(getMarketplaceFeesAmount(row)).toBe(-185);
    expect(getPaymentDifference(row)).toBe(1000 + -185 - 700);
  });

  it('includes signed TCS and TDS inside marketplaceFee', () => {
    const row = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-3',
      orderId: 'OD-1003',
      saleAmount: 1000,
      bankSettlementValue: 400,
      commission: -500,
      fixedFee: 0,
      tcs: -50,
      tds: -25,
      marketplace: 'flipkart',
    } as never);

    expect(row.marketplaceFee).toBe(-75);
    expect(row.tcs).toBe(-50);
    expect(row.tds).toBe(-25);
    expect(getMarketplaceFeesAmount(row)).toBe(-575);
    expect(getPaymentDifference(row)).toBe(1000 + -575 - 400);
  });

  it('nets original fees with return fee reversals across the order lifecycle', () => {
    const sale = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-sale',
      orderId: 'OD-RET',
      orderItemId: 'item-1',
      saleAmount: 273,
      bankSettlementValue: 200,
      commission: -30,
      fixedFee: -20,
      tcs: -5,
      tds: -3,
      marketplace: 'flipkart',
    } as never);
    const returned = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-return',
      orderId: 'OD-RET',
      orderItemId: 'item-1',
      saleAmount: 273,
      refund: -273,
      bankSettlementValue: -200,
      commission: 30,
      fixedFee: 20,
      tcs: 5,
      tds: 3,
      marketplace: 'flipkart',
    } as never);

    const lifecycle = aggregateOrderPaymentLifecycle([sale, returned]);
    expect(lifecycle.sales).toBe(273);
    expect(lifecycle.returns).toBe(-273);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.marketplaceFees).toBe(0);
    expect(lifecycle.bankPayout).toBe(0);
    expect(lifecycle.difference).toBe(0);
  });

  it('uses saleAmountSummary when Flipkart saleAmount is stored as 0', () => {
    const row = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-zero-sale',
      orderId: 'OD337406670212741100',
      saleAmount: 0,
      saleAmountSummary: 464,
      bankSettlementValue: 442.47,
      refund: 0,
      marketplace: 'flipkart',
    } as never);

    expect(row.saleAmount).toBe(464);
  });

  it('keeps original Sales on returned orders when saleAmount is 0 in DB', () => {
    const sale = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-sale-zero',
      orderId: 'OD-RET-ZERO',
      orderItemId: 'item-1',
      saleAmount: 0,
      saleAmountSummary: 301,
      bankSettlementValue: 299.28,
      refund: 0,
      marketplace: 'flipkart',
    } as never);
    const returned = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-return-zero',
      orderId: 'OD-RET-ZERO',
      orderItemId: 'item-1',
      saleAmount: 0,
      saleAmountSummary: 301,
      refund: -301,
      bankSettlementValue: -299.28,
      marketplace: 'flipkart',
    } as never);

    const lifecycle = aggregateOrderPaymentLifecycle([sale, returned]);
    expect(lifecycle.sales).toBe(301);
    expect(lifecycle.returns).toBe(-301);
    expect(lifecycle.netSales).toBe(0);
  });

  it('does not double-count marketplaceFee rollup when detailed fee columns exist', () => {
    const row = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-rollup',
      orderId: 'OD-ROLLUP',
      saleAmount: 0,
      saleAmountSummary: 273,
      bankSettlementValue: -146.32,
      marketplaceFee: -124,
      fixedFee: -5,
      reverseShippingFee: -119,
      gstOnMarketplaceFees: -22.32,
      marketplace: 'flipkart',
    } as never);

    // marketplaceFee (-124) equals fixed + reverse shipping — exclude rollup.
    expect(row.marketplaceFee).toBeCloseTo(-146.32);
    expect(getMarketplaceFeesAmount(row)).toBeCloseTo(-146.32);
  });

  it('nets multi-SKU full return order to a settled difference of zero', () => {
    const rows = [
      mapFlipkartPaymentToAnalyticsRow({
        _id: '1',
        orderId: 'OD-MULTI',
        orderItemId: 'item-a',
        sellerSku: 'SKU-A',
        saleAmount: 0,
        saleAmountSummary: 128,
        bankSettlementValue: -0.014,
        tcs: -0.005,
        tds: -0.009,
        marketplace: 'flipkart',
      } as never),
      mapFlipkartPaymentToAnalyticsRow({
        _id: '2',
        orderId: 'OD-MULTI',
        orderItemId: 'item-a',
        sellerSku: 'SKU-A',
        saleAmount: 0,
        saleAmountSummary: 128,
        refund: -128,
        bankSettlementValue: -146.32,
        fixedFee: -5,
        reverseShippingFee: -119,
        gstOnMarketplaceFees: -22.32,
        marketplaceFee: -124,
        marketplace: 'flipkart',
      } as never),
      mapFlipkartPaymentToAnalyticsRow({
        _id: '3',
        orderId: 'OD-MULTI',
        orderItemId: 'item-b',
        sellerSku: 'SKU-B',
        saleAmount: 0,
        saleAmountSummary: 128,
        bankSettlementValue: 0,
        marketplace: 'flipkart',
      } as never),
      mapFlipkartPaymentToAnalyticsRow({
        _id: '4',
        orderId: 'OD-MULTI',
        orderItemId: 'item-b',
        sellerSku: 'SKU-B',
        saleAmount: 0,
        saleAmountSummary: 128,
        refund: -128,
        bankSettlementValue: -140.42,
        reverseShippingFee: -119,
        gstOnMarketplaceFees: -21.42,
        marketplaceFee: -119,
        marketplace: 'flipkart',
      } as never),
    ];

    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.sales).toBe(256);
    expect(lifecycle.returns).toBe(-256);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBeCloseTo(-286.754);
    expect(lifecycle.marketplaceFees).toBeCloseTo(-286.754);
    expect(lifecycle.difference).toBe(0);
  });

  it('applies marketplace fee discounts as credits', () => {
    const row = mapFlipkartPaymentToAnalyticsRow({
      _id: 'fk-2',
      orderId: 'OD-1002',
      commission: -50,
      fixedFee: -30,
      totalDiscountInMarketplaceFee: 8,
      marketplace: 'flipkart',
    } as never);

    expect(row.marketplaceFee).toBe(-22);
    expect(getMarketplaceFeesAmount(row)).toBe(-72);
  });
});
