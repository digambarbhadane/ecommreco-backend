import {
  classifyFlipkartReturnSubType,
  classifyFlipkartReturnType,
  isFlipkartNaTypeOfReturn,
} from '../../src/report-import/utils/flipkart-analytics.util';
import { aggregateFlipkartMonthSummaryFromRows } from '../../src/report-import/utils/workflow-month-summary.aggregation';
import { MappingService } from '../../src/report-import/services/mapping.service';
import { sellerStateKeysFromRegistration } from '../../src/report-import/utils/state-wise-gst-split.util';

describe('classifyFlipkartReturnSubType', () => {
  it('classifies customer, courier, and NA return types', () => {
    expect(classifyFlipkartReturnSubType('Customer Return')).toBe('customer_return');
    expect(classifyFlipkartReturnSubType(' customer return ')).toBe('customer_return');
    expect(classifyFlipkartReturnSubType('Courier Return')).toBe('courier_return');
    expect(classifyFlipkartReturnSubType('Courier Return (RTO)')).toBe('courier_return');
    expect(classifyFlipkartReturnSubType('RTO')).toBe('courier_return');
    expect(classifyFlipkartReturnSubType('')).toBe('na');
    expect(classifyFlipkartReturnSubType('#N/A')).toBe('na');
    expect(classifyFlipkartReturnSubType('Unknown Type')).toBe('na');
  });

  it('legacy classifyFlipkartReturnType returns null for NA', () => {
    expect(classifyFlipkartReturnType('Customer Return')).toBe('customer_return');
    expect(classifyFlipkartReturnType('')).toBeNull();
    expect(isFlipkartNaTypeOfReturn('#N/A')).toBe(true);
  });
});

describe('aggregateFlipkartMonthSummaryFromRows return subtypes', () => {
  const sellerStates = sellerStateKeysFromRegistration('Delhi', '07AAAAA0000A1Z5');

  it('splits Return bucket counts by typeOfReturn and matches Return total', () => {
    const result = aggregateFlipkartMonthSummaryFromRows(
      [
        {
          documentType: 'Return',
          voucherType: 'Return',
          typeOfReturn: 'Customer Return',
          quantity: 1,
          taxableAmount: 100,
          reportType: 'sales',
        },
        {
          documentType: 'Return',
          voucherType: 'Return',
          typeOfReturn: 'Courier Return',
          quantity: 2,
          taxableAmount: 200,
          reportType: 'sales',
        },
        {
          documentType: 'Return',
          voucherType: 'Return',
          typeOfReturn: 'Courier Return (RTO)',
          quantity: 1,
          taxableAmount: 50,
          reportType: 'sales',
        },
        {
          documentType: 'Sale',
          voucherType: 'Sale',
          typeOfReturn: 'Customer Return',
          quantity: 1,
          taxableAmount: 500,
          reportType: 'sales',
        },
      ],
      sellerStates,
    );

    expect(result.totals.flipkartReturnRows).toBe(3);
    expect(result.totals.flipkartReturnCustomerRows).toBe(1);
    expect(result.totals.flipkartReturnCourierRows).toBe(2);
    expect(result.totals.flipkartReturnNaRows).toBe(0);
    expect(
      Number(result.totals.flipkartReturnCustomerRows ?? 0) +
        Number(result.totals.flipkartReturnCourierRows ?? 0) +
        Number(result.totals.flipkartReturnNaRows ?? 0),
    ).toBe(result.totals.flipkartReturnRows);
  });

  it('counts returns without return type as NA', () => {
    const result = aggregateFlipkartMonthSummaryFromRows(
      [
        {
          documentType: 'Return',
          voucherType: 'Return',
          quantity: 1,
          taxableAmount: 80,
          reportType: 'sales',
        },
        {
          documentType: 'Return',
          voucherType: 'Return',
          typeOfReturn: '#N/A',
          returnReason: 'Size Issue',
          quantity: 1,
          taxableAmount: 40,
          reportType: 'sales',
        },
        {
          documentType: 'Return',
          voucherType: 'Return',
          typeOfReturn: 'Customer Return',
          quantity: 1,
          taxableAmount: 100,
          reportType: 'sales',
        },
      ],
      sellerStates,
    );

    expect(result.totals.flipkartReturnRows).toBe(3);
    expect(result.totals.flipkartReturnNaRows).toBe(2);
    expect(result.totals.flipkartReturnCustomerRows).toBe(1);
    expect(
      Number(result.totals.flipkartReturnCustomerRows ?? 0) +
        Number(result.totals.flipkartReturnCourierRows ?? 0) +
        Number(result.totals.flipkartReturnNaRows ?? 0),
    ).toBe(result.totals.flipkartReturnRows);
  });
});

describe('mapFlipkartReturnFields', () => {
  const mapping = new MappingService();

  it('maps all three return columns and defaults missing Return Type to #N/A', () => {
    const mapped = mapping.mapFlipkartReturnFields({
      __sheetName: 'Return Report',
      __rowNumber: 2,
      'Order ID': '101',
      'Return Reason': 'Quality Issue',
      'Return Sub-reason': 'Damaged',
    });

    expect(mapped.returnReason).toBe('Quality Issue');
    expect(mapped.detailedReturnReason).toBe('Damaged');
    expect(mapped.typeOfReturn).toBe('#N/A');
  });
});
