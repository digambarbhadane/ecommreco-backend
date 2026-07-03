import {
  classifyAmazonReturnReportType,
  resolveAmazonReturnDetails,
} from '../../src/report-import/utils/amazon-return.util';

describe('amazon-return.util', () => {
  it('maps known Amazon return report labels', () => {
    expect(classifyAmazonReturnReportType('C-Returns')).toBe('customer_return');
    expect(classifyAmazonReturnReportType('Amazon CS')).toBe('customer_return');
    expect(classifyAmazonReturnReportType('Rejected')).toBe('rto');
    expect(classifyAmazonReturnReportType('Undelivered')).toBe('rto');
  });

  it('stores #N/A when order id is missing for unknown return type', () => {
    expect(resolveAmazonReturnDetails('Unknown Type', '')).toEqual({
      typeOfReturn: '#N/A',
      amazonReturnSubType: 'na',
    });
  });

  it('stores normalized customer return details when order id is present', () => {
    expect(resolveAmazonReturnDetails('C-Returns', '123-456')).toEqual({
      typeOfReturn: 'Customer Return',
      amazonReturnSubType: 'customer_return',
    });
  });

  it('marks unknown return types with order id as NA subtype', () => {
    expect(resolveAmazonReturnDetails('Warehouse Damage', '123-456')).toEqual({
      typeOfReturn: 'Warehouse Damage',
      amazonReturnSubType: 'na',
    });
  });
});
