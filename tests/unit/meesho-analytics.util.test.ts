import {
  classifyMeeshoImportRow,
  classifyMeeshoReturnSubType,
  isMeeshoCancellationStatus,
  isMeeshoNaTypeOfReturn,
  resolveMeeshoReturnSubType,
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

  it('prefers lifecycle subtype over cancellation status', () => {
    const result = classifyMeeshoImportRow({
      meeshoHasTcsReturn: true,
      meeshoOrderStatus: 'Cancelled by customer',
      typeOfReturn: 'Customer Return',
      subType: 'RTO',
    });
    expect(result.meeshoReturnSubType).toBe('rto');
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
      typeOfReturn: 'Customer Return',
      subType: 'RTO',
    });
    expect(result.meeshoHasTcsReturn).toBe(true);
    expect(result.meeshoReturnSubType).toBe('rto');
  });

  it('classifies return sub types in priority order', () => {
    expect(classifyMeeshoReturnSubType('CANCELLED', '')).toBe('cancellation');
    expect(classifyMeeshoReturnSubType('Courier Return (RTO)', '')).toBe('rto');
    expect(classifyMeeshoReturnSubType('Customer Return', 'RTO')).toBe('rto');
    expect(classifyMeeshoReturnSubType('Courier Return', '')).toBe('rto');
    expect(classifyMeeshoReturnSubType('Customer Return', '')).toBe('customer_return');
    expect(classifyMeeshoReturnSubType('#N/A', '')).toBe('na');
    expect(classifyMeeshoReturnSubType('N/A', '')).toBe('na');
    expect(isMeeshoNaTypeOfReturn('#N/A')).toBe(true);
  });

  it('classifies TCS return rows with Type of Return #N/A as na', () => {
    const result = classifyMeeshoImportRow({
      meeshoHasTcsReturn: true,
      typeOfReturn: '#N/A',
    });
    expect(result.meeshoReturnSubType).toBe('na');
    expect(result.meeshoIsPreviousMonthReturn).toBe(true);
  });

  it('prefers TCS Sales Return Type of Return over lifecycle subtype', () => {
    const result = resolveMeeshoReturnSubType({
      tcsReturnTypeOfReturn: 'Customer Return',
      meeshoReturnSubType: 'rto',
      isReturnDocument: true,
    });
    expect(result).toBe('customer_return');
  });

  it('defaults to na when TCS return exists but type of return is missing everywhere', () => {
    const result = resolveMeeshoReturnSubType({
      meeshoHasTcsReturn: true,
      returnInvoiceDate: '2026-04-10',
    });
    expect(result).toBe('na');
  });

  it('detects cancellation status', () => {
    expect(isMeeshoCancellationStatus('Cancelled by customer')).toBe(true);
    expect(isMeeshoCancellationStatus('Delivered')).toBe(false);
  });
});
