import {
  asImportDateDmy,
  asImportDateIso,
  parseImportDate,
} from '../../src/report-import/utils/import-date.util';

describe('import-date.util', () => {
  it('parses YYYYMMDD string and number', () => {
    expect(asImportDateDmy('20250617')).toBe('17-06-2025');
    expect(asImportDateIso('20250617')).toBe('2025-06-17');
    expect(asImportDateDmy(20250617)).toBe('17-06-2025');
    expect(asImportDateIso(20250617)).toBe('2025-06-17');
  });

  it('parses DD/MM/YYYY', () => {
    expect(asImportDateDmy('01/03/2026')).toBe('01-03-2026');
    expect(asImportDateIso('01/03/2026')).toBe('2026-03-01');
  });

  it('parses ISO dates without treating the year as the day', () => {
    expect(asImportDateIso('2025-03-15')).toBe('2025-03-15');
    expect(asImportDateDmy('2025-03-15')).toBe('15-03-2025');
  });

  it('rejects absurd excel serials that would become year 2036+', () => {
    expect(parseImportDate(50000)).toBeUndefined();
  });

  it('parses valid excel serials', () => {
    // 44927 ≈ 2023-01-01
    const date = parseImportDate(44927);
    expect(date?.getUTCFullYear()).toBe(2023);
  });
});
