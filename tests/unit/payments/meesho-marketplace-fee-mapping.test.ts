import { mapMeeshoOrderPaymentToAnalyticsRow } from '../../../src/report-import/payments/payment-analytics.types';
import { getMarketplaceFeesAmount } from '../../../src/report-import/payments/payment-reconciliation.util';

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
});
