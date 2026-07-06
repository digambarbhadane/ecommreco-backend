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

  it('rejects invalid compact dates', () => {
    expect(parseImportDate('20251399')).toBeUndefined();
    expect(parseImportDate('abcdefgh')).toBeUndefined();
  });
});
