import {
  amazonFeeKey,
  classifyAmazonPaymentLine,
  mapAmazonAggregatedSettlementsToAnalyticsRows,
  mapAmazonPaymentComponentsToAnalyticsRows,
} from '../../src/report-import/payments/amazon/amazon-payment-analytics.mapper';

describe('amazon-payment-analytics.mapper', () => {
  describe('amazonFeeKey', () => {
    it('normalizes name variants to one identity', () => {
      expect(amazonFeeKey('Fixed closing fee')).toBe(
        amazonFeeKey('Fixed Closing Fee'),
      );
      expect(amazonFeeKey('FixedClosingFee')).toBe(
        amazonFeeKey('Fixed closing fee'),
      );
      expect(amazonFeeKey('FBA Pick & Pack Fee')).toBe(
        amazonFeeKey('FBA Pick and Pack Fee'),
      );
    });

    it('keeps CGST/SGST distinct from the base fee', () => {
      expect(amazonFeeKey('FBA Pick & Pack Fee')).not.toBe(
        amazonFeeKey('FBA Pick & Pack Fee CGST'),
      );
      expect(amazonFeeKey('FBA Pick & Pack Fee CGST')).not.toBe(
        amazonFeeKey('FBA Pick & Pack Fee SGST'),
      );
    });
  });

  describe('classifyAmazonPaymentLine', () => {
    it('classifies principal as sale', () => {
      expect(classifyAmazonPaymentLine('Order', 'Principal')).toBe('sale');
      expect(classifyAmazonPaymentLine('Order', 'Product Tax')).toBe('sale');
    });

    it('classifies refund principal as return', () => {
      expect(classifyAmazonPaymentLine('Refund', 'Principal')).toBe('return');
    });

    it('classifies commission', () => {
      expect(classifyAmazonPaymentLine('Order', 'Commission')).toBe('commission');
    });

    it('classifies shipping and fees', () => {
      expect(classifyAmazonPaymentLine('Order', 'Shipping')).toBe('fee');
      expect(
        classifyAmazonPaymentLine('Order', 'FBA Per Unit Fulfillment Fee'),
      ).toBe('fee');
    });
  });

  describe('mapAmazonPaymentComponentsToAnalyticsRows', () => {
    it('aggregates sale, commission, fees and bank payout per order+settlement', () => {
      const rows = mapAmazonPaymentComponentsToAnalyticsRows([
        {
          _id: '1',
          settlementId: 'SETTLE-1',
          depositDate: '2026-06-10',
          transactionType: 'Order',
          orderId: '403-123',
          amountDescription: 'Principal',
          amount: 500,
          gstin: '24AAAAA0000A1Z5',
          reportMonth: '2026-06',
        },
        {
          _id: '2',
          settlementId: 'SETTLE-1',
          depositDate: '2026-06-10',
          transactionType: 'Order',
          orderId: '403-123',
          amountDescription: 'Commission',
          amount: -50,
          reportMonth: '2026-06',
        },
        {
          _id: '3',
          settlementId: 'SETTLE-1',
          depositDate: '2026-06-10',
          transactionType: 'Order',
          orderId: '403-123',
          amountDescription: 'Shipping',
          amount: -20,
          reportMonth: '2026-06',
        },
        {
          _id: '4',
          settlementId: 'SETTLE-1',
          depositDate: '2026-06-10',
          transactionType: 'Transfer',
          orderId: '',
          amountDescription: 'Transfer',
          amount: 430,
          reportMonth: '2026-06',
        },
      ]);

      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.marketplace).toBe('amazon');
      expect(row.source).toBe('amazon_payment_transactions');
      expect(row.orderId).toBe('403-123');
      expect(row.neftId).toBe('SETTLE-1');
      expect(row.saleAmount).toBe(500);
      expect(row.commission).toBe(-50);
      expect(row.marketplaceFee).toBe(-20);
      expect(row.bankSettlementValue).toBe(430);
      expect(row.feeComponents?.some((c) => c.key === 'commission')).toBe(true);
    });

    it('keeps refund absolute and marks return type', () => {
      const rows = mapAmazonPaymentComponentsToAnalyticsRows([
        {
          settlementId: 'SETTLE-2',
          depositDate: '2026-06-12',
          transactionType: 'Refund',
          orderId: '403-999',
          amountDescription: 'Principal',
          amount: -300,
        },
        {
          settlementId: 'SETTLE-2',
          depositDate: '2026-06-12',
          transactionType: 'Refund',
          orderId: '403-999',
          amountDescription: 'Commission',
          amount: 30,
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].saleAmount).toBeUndefined();
      expect(rows[0].refund).toBe(300);
      expect(rows[0].returnType).toBe('Customer Return');
      expect(rows[0].commission).toBe(30);
      expect(rows[0].bankSettlementValue).toBe(-270);
    });

    it('emits separate rows for multiple settlements on one order', () => {
      const rows = mapAmazonPaymentComponentsToAnalyticsRows([
        {
          settlementId: 'A',
          depositDate: '2026-06-01',
          transactionType: 'Order',
          orderId: '403-1',
          amountDescription: 'Principal',
          amount: 100,
        },
        {
          settlementId: 'B',
          depositDate: '2026-06-15',
          transactionType: 'Order',
          orderId: '403-1',
          amountDescription: 'Principal',
          amount: 50,
        },
      ]);

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.neftId).sort()).toEqual(['A', 'B']);
    });

    it('merges fee name variants into one component without double-counting', () => {
      const rows = mapAmazonPaymentComponentsToAnalyticsRows([
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-1',
          amountDescription: 'Fixed closing fee',
          amount: -22,
          rowKey: 'rk-a',
        },
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-1',
          amountDescription: 'FixedClosingFee',
          amount: -22,
          rowKey: 'rk-b',
        },
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-1',
          amountDescription: 'Fixed closing fee CGST',
          amount: -1.98,
          rowKey: 'rk-c',
        },
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-1',
          amountDescription: 'Fixed closing fee SGST',
          amount: -1.98,
          rowKey: 'rk-d',
        },
      ]);

      expect(rows).toHaveLength(1);
      const fees = rows[0].feeComponents ?? [];
      const closing = fees.filter((f) =>
        /fixed_closing_fee$/.test(f.key),
      );
      const cgst = fees.filter((f) => /fixed_closing_fee_cgst$/.test(f.key));
      const sgst = fees.filter((f) => /fixed_closing_fee_sgst$/.test(f.key));
      expect(closing).toHaveLength(1);
      expect(closing[0].amount).toBe(-44);
      expect(cgst).toHaveLength(1);
      expect(sgst).toHaveLength(1);
      // -22 + -22 merged + CGST + SGST
      expect(Number((rows[0].marketplaceFee ?? 0).toFixed(2))).toBe(-47.96);
    });

    it('dedupes identical rowKey across report months (no double fee/bank)', () => {
      const rows = mapAmazonPaymentComponentsToAnalyticsRows([
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-dup',
          amountDescription: 'Commission',
          amount: -49.56,
          rowKey: 'same-fingerprint:1',
          reportMonth: '2026-05',
        },
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-dup',
          amountDescription: 'Commission',
          amount: -49.56,
          rowKey: 'same-fingerprint:1',
          reportMonth: '2026-06',
        },
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-dup',
          amountDescription: 'Principal',
          amount: 500,
          rowKey: 'principal:1',
          reportMonth: '2026-05',
        },
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-dup',
          amountDescription: 'Principal',
          amount: 500,
          rowKey: 'principal:1',
          reportMonth: '2026-06',
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].commission).toBe(-49.56);
      expect(rows[0].saleAmount).toBe(500);
      expect(rows[0].bankSettlementValue).toBe(450.44);
      expect(rows[0].feeComponents?.filter((f) => f.key === 'commission')).toHaveLength(
        1,
      );
    });

    it('sums legitimate repeated Amazon lines with distinct rowKeys', () => {
      const rows = mapAmazonPaymentComponentsToAnalyticsRows([
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-multi',
          amountDescription: 'Commission',
          amount: -25,
          rowKey: 'comm:1',
        },
        {
          settlementId: 'S1',
          transactionType: 'Order',
          orderId: '407-multi',
          amountDescription: 'Commission',
          amount: -24.56,
          rowKey: 'comm:2',
        },
      ]);

      expect(rows[0].commission).toBe(-49.56);
      expect(rows[0].feeComponents).toEqual([
        expect.objectContaining({
          key: 'commission',
          label: 'Commission',
          amount: -49.56,
        }),
      ]);
    });

    it('keeps example fee mix as one row per unique component totaling -261.84', () => {
      const rows = mapAmazonPaymentComponentsToAnalyticsRows([
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'Commission',
          amount: -49.56,
          rowKey: '1',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'FBA Pick & Pack Fee',
          amount: -34,
          rowKey: '2',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'FBA Pick & Pack Fee CGST',
          amount: -3.06,
          rowKey: '3',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'FBA Pick & Pack Fee SGST',
          amount: -3.06,
          rowKey: '4',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'FBA Weight Handling Fee',
          amount: -85,
          rowKey: '5',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'FBA Weight Handling Fee CGST',
          amount: -7.66,
          rowKey: '6',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'FBA Weight Handling Fee SGST',
          amount: -7.66,
          rowKey: '7',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'Fixed closing fee',
          amount: -44,
          rowKey: '8',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'Fixed closing fee CGST',
          amount: -3.96,
          rowKey: '9',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'Fixed closing fee SGST',
          amount: -3.96,
          rowKey: '10',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'Promo rebates',
          amount: -17.57,
          rowKey: '11',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'TCS',
          amount: -1.67,
          rowKey: '12',
        },
        {
          settlementId: 'S1',
          orderId: '407-8218802-8199559',
          transactionType: 'Order',
          amountDescription: 'TDS',
          amount: -0.68,
          rowKey: '13',
        },
      ]);

      const fees = rows[0].feeComponents ?? [];
      expect(fees).toHaveLength(13);
      const feeTotal =
        (rows[0].commission ?? 0) + (rows[0].marketplaceFee ?? 0);
      expect(Number(feeTotal.toFixed(2))).toBe(-261.84);
      expect(fees.map((f) => f.key).sort()).toEqual(
        [
          'commission',
          'fba_pick_and_pack_fee',
          'fba_pick_and_pack_fee_cgst',
          'fba_pick_and_pack_fee_sgst',
          'fba_weight_handling_fee',
          'fba_weight_handling_fee_cgst',
          'fba_weight_handling_fee_sgst',
          'fixed_closing_fee',
          'fixed_closing_fee_cgst',
          'fixed_closing_fee_sgst',
          'promo_rebates',
          'tcs',
          'tds',
        ].sort(),
      );
    });

    it('maps aggregated settlement buckets with identical financials', () => {
      const components = [
        {
          _id: '1',
          settlementId: 'SETTLE-1',
          depositDate: '2026-06-10',
          transactionType: 'Order',
          orderId: '403-agg',
          amountDescription: 'Principal',
          amount: 500,
          gstin: '24AAAAA0000A1Z5',
          reportMonth: '2026-06',
        },
        {
          _id: '2',
          settlementId: 'SETTLE-1',
          depositDate: '2026-06-10',
          transactionType: 'Order',
          orderId: '403-agg',
          amountDescription: 'Commission',
          amount: -50,
          reportMonth: '2026-06',
        },
        {
          _id: '3',
          settlementId: 'SETTLE-1',
          depositDate: '2026-06-10',
          transactionType: 'Order',
          orderId: '403-agg',
          amountDescription: 'Shipping',
          amount: -20,
          reportMonth: '2026-06',
        },
        {
          _id: '4',
          settlementId: 'SETTLE-1',
          depositDate: '2026-06-10',
          transactionType: 'Order',
          orderId: '403-agg',
          amountDescription: 'TCS',
          amount: -5,
          reportMonth: '2026-06',
        },
      ];
      const fromComponents =
        mapAmazonPaymentComponentsToAnalyticsRows(components);
      const fromAgg = mapAmazonAggregatedSettlementsToAnalyticsRows([
        {
          orderId: '403-agg',
          settlementId: 'SETTLE-1',
          saleAmount: 500,
          refundAbs: 0,
          commission: -50,
          tcs: -5,
          tds: 0,
          otherFees: -25,
          bankSettlementValue: 425,
          gstin: '24AAAAA0000A1Z5',
          reportMonth: '2026-06',
          depositDate: '2026-06-10',
          idSeed: '1',
          feeLines: [{ amountDescription: 'Shipping', amount: -20 }],
        },
      ]);

      expect(fromAgg).toHaveLength(1);
      expect(fromAgg[0].saleAmount).toBe(fromComponents[0].saleAmount);
      expect(fromAgg[0].commission).toBe(fromComponents[0].commission);
      expect(fromAgg[0].marketplaceFee).toBe(fromComponents[0].marketplaceFee);
      expect(fromAgg[0].tcs).toBe(fromComponents[0].tcs);
      expect(fromAgg[0].bankSettlementValue).toBe(
        fromComponents[0].bankSettlementValue,
      );
      expect(
        fromAgg[0].feeComponents?.find((c) => c.key === 'commission')?.amount,
      ).toBe(-50);
    });
  });
});
