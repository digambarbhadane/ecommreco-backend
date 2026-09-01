import {
  countDistinctOrderReportKeysByDocumentTypeStages,
  countDistinctOrderReportKeysByMarketplaceStages,
  countDistinctOrderReportKeysStages,
  distinctOrderReportGroupIdExpression,
  distinctOrderReportKeyExpression,
} from '../../src/report-import/utils/order-report-count.util';

describe('order-report-count.util', () => {
  it('uses trimmed orderID when present', () => {
    expect(distinctOrderReportKeyExpression()).toEqual({
      $cond: [
        {
          $gt: [
            {
              $strLenCP: {
                $trim: { input: { $ifNull: ['$orderID', ''] } },
              },
            },
            0,
          ],
        },
        { $trim: { input: '$orderID' } },
        '$_id',
      ],
    });
  });

  it('groups distinct orders by marketplace link and order key', () => {
    expect(distinctOrderReportGroupIdExpression()).toEqual({
      marketplace: '$marketplace',
      orderKey: distinctOrderReportKeyExpression(),
    });
  });

  it('builds count pipelines for totals and marketplace breakdown', () => {
    const match = { sellerId: 'seller-1' };
    expect(countDistinctOrderReportKeysStages(match)).toEqual([
      { $match: match },
      { $group: { _id: distinctOrderReportGroupIdExpression() } },
      { $count: 'count' },
    ]);
    expect(countDistinctOrderReportKeysByMarketplaceStages(match)[1]).toEqual({
      $group: {
        _id: {
          marketplace: '$marketplace',
          orderKey: distinctOrderReportKeyExpression(),
        },
      },
    });
    expect(countDistinctOrderReportKeysByDocumentTypeStages(match)[1]).toEqual({
      $group: {
        _id: {
          documentType: { $ifNull: ['$documentType', 'Unknown'] },
          marketplace: '$marketplace',
          orderKey: distinctOrderReportKeyExpression(),
        },
      },
    });
  });
});
