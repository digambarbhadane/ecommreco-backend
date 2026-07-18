import {
  computeTrialPayable,
  getTrialAllowedReportMonths,
  extractPanFromGstin,
} from '../../src/trial/trial.constants';
import { classifyFlipkartSettlementRow } from '../../src/settlement/utils/flipkart-settlement-classifier.util';

describe('trial.constants', () => {
  it('computes trial payable with 18% GST', () => {
    expect(computeTrialPayable(499)).toEqual({
      basePrice: 499,
      gstPercentage: 18,
      gstAmount: 89.82,
      totalPayable: 588.82,
    });
  });

  it('extracts PAN from GSTIN', () => {
    expect(extractPanFromGstin('07BSGPB0667M2ZL')).toBe('BSGPB0667M');
  });

  it('allows registration month plus previous 3 months', () => {
    const months = getTrialAllowedReportMonths(new Date('2026-07-15T00:00:00Z'));
    expect(months).toEqual(['2026-07', '2026-06', '2026-05', '2026-04']);
  });
});

describe('flipkart classifier still works', () => {
  it('keeps sales cancellation as return', () => {
    expect(
      classifyFlipkartSettlementRow('Return', 'Cancellation'),
    ).toMatchObject({ role: 'return', sign: 1 });
  });
});
