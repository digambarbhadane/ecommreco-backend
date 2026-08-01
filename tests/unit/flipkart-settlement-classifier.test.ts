import { classifyFlipkartSettlementRow } from '../../src/settlement/utils/flipkart-settlement-classifier.util';

describe('classifyFlipkartSettlementRow', () => {
  it.each([
    ['Sale', 'Sale', 'sale', 1],
    ['Credit Note', 'Credit Note', 'sale', 1],
    ['Return', 'Return', 'return', 1],
    ['Debit Note', 'Debit Note', 'return', 1],
    ['Return', 'Cancellation', 'return', 1],
    ['Return', 'Return Cancellation', 'return', -1],
  ] as const)(
    'classifies %s / %s as %s with sign %s',
    (documentType, voucherType, role, sign) => {
      expect(
        classifyFlipkartSettlementRow(documentType, voucherType),
      ).toMatchObject({ role, sign });
    },
  );
});
