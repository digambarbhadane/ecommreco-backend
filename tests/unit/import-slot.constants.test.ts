import {
  inferUploadedSlotsFromFileHash,
} from '../../src/report-import/import-slot.constants';
import { getUploadedSlotsInFilenameOrder } from '../../src/report-import/utils/slot-summary-resolver';

describe('import slot inference', () => {
  it('maps Amazon composite hash return segment to amazonReturnReportFile', () => {
    const hash =
      'amazon|b2c:abc123|b2b:none|return:def456|month:2026-04';
    expect(inferUploadedSlotsFromFileHash(hash)).toEqual([
      'mtrB2cFile',
      'amazonReturnReportFile',
    ]);
  });

  it('maps Amazon return-only hash to amazonReturnReportFile', () => {
    const hash = 'amazon-return|def456|month:2026-04';
    expect(inferUploadedSlotsFromFileHash(hash)).toEqual([
      'amazonReturnReportFile',
    ]);
  });

  it('does not map Amazon return segment to Flipkart returnReportFile', () => {
    const hash = 'amazon|b2c:abc|b2b:none|return:def|month:2026-04';
    const slots = inferUploadedSlotsFromFileHash(hash);
    expect(slots).not.toContain('returnReportFile');
    expect(slots).not.toContain('returnDeliveryCompleteReportFile');
  });

  it('orders Amazon filename slots including return report', () => {
    const hash = 'amazon|b2c:abc|b2b:def|return:ghi|month:2026-04';
    expect(getUploadedSlotsInFilenameOrder('amazon', hash)).toEqual([
      'mtrB2bFile',
      'mtrB2cFile',
      'amazonReturnReportFile',
    ]);
  });
});
