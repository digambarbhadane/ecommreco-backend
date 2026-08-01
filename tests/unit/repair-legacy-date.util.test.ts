import {
  repairDateToIso,
  repairImportRowDates,
  repairLegacyCorruptedDate,
} from '../../src/common/utils/repair-legacy-date.util';

describe('repair-legacy-date.util', () => {
  it('repairs Date.UTC(2000+day, month-1, year) corruption (2036-09-15 → 2026-03-31)', () => {
    expect(repairDateToIso('2036-09-15')).toBe('2026-03-31');
    expect(
      repairLegacyCorruptedDate(new Date('2036-09-15T00:00:00.000Z'))
        ?.toISOString()
        .slice(0, 10),
    ).toBe('2026-03-31');
  });

  it('leaves reasonable dates unchanged', () => {
    expect(repairDateToIso('2026-03-31')).toBe('2026-03-31');
  });

  it('repairs invoiceDate on import rows', () => {
    const row = repairImportRowDates({
      invoiceDate: '2036-09-15',
      paymentDate: '2026-01-15',
      orderID: 'ORD-1',
    });
    expect(row.invoiceDate).toBe('2026-03-31');
    expect(row.paymentDate).toBe('2026-01-15');
  });
});
