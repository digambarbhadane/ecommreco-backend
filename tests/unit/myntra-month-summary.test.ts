import {
  classifyMyntraReturnSubType,
  isMyntraSaleRow,
} from '../../src/report-import/utils/workflow-month-summary.aggregation';

describe('classifyMyntraReturnSubType', () => {
  it('treats SALE rows as gross sales', () => {
    expect(isMyntraSaleRow('SALE')).toBe(true);
    expect(classifyMyntraReturnSubType('SALE')).toBeNull();
  });

  it('classifies RTO returns from GSTR Report RTO match', () => {
    expect(classifyMyntraReturnSubType('RTO Return', 'RTO Return')).toBe('rto');
  });

  it('classifies customer returns from GSTR Report RT match', () => {
    expect(classifyMyntraReturnSubType('Customer Return', 'Customer Return')).toBe(
      'customer_return',
    );
  });
});
