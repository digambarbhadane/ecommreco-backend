import {
  buildStateWiseSalesMatch,
  mapAggregationResults,
} from '../../src/report-import/utils/state-wise-report.aggregation';

describe('state-wise-report.aggregation', () => {
  it('buildStateWiseSalesMatch includes Meesho returns for net sales math', () => {
    const filter = buildStateWiseSalesMatch({
      sellerId: { $in: ['seller-1'] },
      gstin: '24AAFCB9264M1Z9',
    });
    expect(filter).toMatchObject({
      gstin: '24AAFCB9264M1Z9',
    });
    expect(filter.$or).toEqual([
      {
        meeshoIsGrossSale: { $exists: false },
        documentType: { $not: /^RETURN$/i },
      },
      { meeshoIsGrossSale: true },
      { meeshoIsGrossSale: false },
    ]);
  });

  it('mapAggregationResults maps grouped rows', () => {
    const rows = mapAggregationResults([
      {
        _id: { stateName: 'GUJARAT', gstRate: 18 },
        qty: 245,
        taxableValue: 245800,
        igst: 0,
        cgst: 22122,
        sgst: 22122,
        invoiceAmount: 290044,
      },
    ]);
    expect(rows).toEqual([
      {
        stateName: 'GUJARAT',
        gstRate: 18,
        qty: 245,
        taxableValue: 245800,
        igst: 0,
        cgst: 22122,
        sgst: 22122,
        invoiceAmount: 290044,
      },
    ]);
  });
});
