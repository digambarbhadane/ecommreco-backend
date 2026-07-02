import {
  classifyMeeshoImportRow,
  classifyMeeshoReturnSubType,
  isMeeshoCancellationStatus,
} from '../../src/report-import/utils/meesho-analytics.util';

describe('meesho-analytics.util', () => {
  it('counts every TCS sales row as gross sale', () => {
    const result = classifyMeeshoImportRow({
      invoiceDate: '2026-03-15',
    });
    expect(result.meeshoIsGrossSale).toBe(true);
    expect(result.meeshoIsPreviousMonthReturn).toBe(false);
    expect(result.meeshoHasTcsReturn).toBe(false);
  });

  it('marks TCS return rows and classifies cancellation from order status', () => {
    const result = classifyMeeshoImportRow({
      meeshoHasTcsReturn: true,
      meeshoOrderStatus: 'Cancelled',
    });
    expect(result.meeshoIsGrossSale).toBe(true);
    expect(result.meeshoHasTcsReturn).toBe(true);
    expect(result.meeshoReturnSubType).toBe('cancellation');
  });

  it('classifies cancellation from Reason for Credit Entry value', () => {
    const result = classifyMeeshoImportRow({
      meeshoHasTcsReturn: true,
      meeshoOrderStatus: 'Cancellation',
    });
    expect(result.meeshoReturnSubType).toBe('cancellation');
  });

  it('classifies return sub types from lifecycle Type of Return', () => {
    const result = classifyMeeshoImportRow({
      meeshoHasTcsReturn: true,
      typeOfReturn: 'Customer Return',
      subType: 'RTO',
    });
    expect(result.meeshoReturnSubType).toBe('rto');
  });

  it('classifies return sub types in priority order', () => {
    expect(classifyMeeshoReturnSubType('Cancellation', '')).toBe('cancellation');
    expect(classifyMeeshoReturnSubType('Customer Return', 'RTO')).toBe('rto');
    expect(classifyMeeshoReturnSubType('Customer Return', '')).toBe('customer_return');
  });

  it('detects cancellation status', () => {
    expect(isMeeshoCancellationStatus('Cancelled by customer')).toBe(true);
    expect(isMeeshoCancellationStatus('Delivered')).toBe(false);
  });
});
