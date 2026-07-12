import {
  applyAmazonReturnDetailsToRow,
  applyAmazonReturnTransactionDefaults,
  classifyAmazonReturnReportType,
  isAmazonReturnTransaction,
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

  it('detects B2C refund/return/cancel transaction types', () => {
    expect(isAmazonReturnTransaction('Refund', 'Refund')).toBe(true);
    expect(isAmazonReturnTransaction('Shipment', 'Shipment')).toBe(false);
    expect(isAmazonReturnTransaction('Cancel', 'Cancel')).toBe(true);
  });

  it('stamps refund rows with NA subtype when return report does not match', () => {
    expect(
      applyAmazonReturnTransactionDefaults({
        documentType: 'Refund',
        voucherType: 'Refund',
        amazonMtrSource: 'b2c',
      }),
    ).toEqual({
      documentType: 'Refund',
      voucherType: 'Refund',
      amazonMtrSource: 'b2c',
      typeOfReturn: 'Refund',
      amazonReturnSubType: 'na',
    });
  });

  it('does not stamp Cancel rows as returns', () => {
    expect(
      applyAmazonReturnTransactionDefaults({
        documentType: 'Cancel',
        voucherType: 'Cancel',
        amazonMtrSource: 'b2c',
      }),
    ).toEqual({
      documentType: 'Cancel',
      voucherType: 'Cancel',
      amazonMtrSource: 'b2c',
    });
  });

  it('does not stamp B2B Cancel rows as returns', () => {
    expect(
      applyAmazonReturnTransactionDefaults({
        documentType: 'Cancel',
        voucherType: 'Cancel',
        amazonMtrSource: 'b2b',
        customerGstNo: '29ABCDE1234F1Z5',
      }),
    ).toEqual({
      documentType: 'Cancel',
      voucherType: 'Cancel',
      amazonMtrSource: 'b2b',
      customerGstNo: '29ABCDE1234F1Z5',
    });
  });

  it('applies return report details including return reason', () => {
    expect(
      applyAmazonReturnDetailsToRow(
        { documentType: 'Refund', voucherType: 'Refund' },
        {
          typeOfReturn: 'Customer Return',
          amazonReturnSubType: 'customer_return',
          returnReason: 'Size issue',
        },
      ),
    ).toEqual({
      documentType: 'Refund',
      voucherType: 'Refund',
      typeOfReturn: 'Customer Return',
      amazonReturnSubType: 'customer_return',
      returnReason: 'Size issue',
    });
  });
});
