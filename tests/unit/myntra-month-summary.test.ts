import {
  buildMyntraInReportMonthMatch,
  buildMyntraWorkflowMonthSummaryPipeline,
  myntraRowBelongsToReportMonth,
} from '../../src/report-import/utils/workflow-month-summary.aggregation';

describe('buildMyntraWorkflowMonthSummaryPipeline', () => {
  it('counts sales and returns for rows scoped by uploadId', () => {
    const pipeline = buildMyntraWorkflowMonthSummaryPipeline(
      {
        uploadId: 'upload-1',
        sellerId: 'seller-1',
        marketplace: 'mp-1',
      },
      '2025-03',
    );

    const matchStage = pipeline[0] as { $match: Record<string, unknown> };
    expect(matchStage.$match).toEqual({
      uploadId: 'upload-1',
      sellerId: 'seller-1',
      marketplace: 'mp-1',
    });
    expect(pipeline.length).toBeGreaterThan(3);
  });
});

describe('myntraRowBelongsToReportMonth', () => {
  it('includes rows uploaded for the selected month even when summary month differs', () => {
    expect(
      myntraRowBelongsToReportMonth(
        { reportMonth: '2025-03', myntraSummaryMonth: '2025-02' },
        '2025-03',
      ),
    ).toBe(true);
  });

  it('falls back to summary month for legacy rows without reportMonth', () => {
    expect(
      myntraRowBelongsToReportMonth(
        { reportMonth: '', myntraSummaryMonth: '2025-03' },
        '2025-03',
      ),
    ).toBe(true);
    expect(
      myntraRowBelongsToReportMonth(
        { reportMonth: null, myntraSummaryMonth: '2025-02' },
        '2025-03',
      ),
    ).toBe(false);
  });
});

describe('buildMyntraInReportMonthMatch', () => {
  it('prioritizes stored reportMonth over transaction summary month', () => {
    expect(buildMyntraInReportMonthMatch('2025-03')).toEqual({
      $or: [
        { $eq: ['$reportMonth', '2025-03'] },
        {
          $and: [
            {
              $or: [
                { $eq: [{ $ifNull: ['$reportMonth', null] }, null] },
                { $eq: ['$reportMonth', ''] },
              ],
            },
            { $eq: ['$myntraSummaryMonth', '2025-03'] },
          ],
        },
      ],
    });
  });
});
