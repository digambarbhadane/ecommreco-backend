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

  it('parses DMY strings without MDY reversal', () => {
    expect(repairDateToIso('12-06-2026')).toBe('2026-06-12');
  });

  it('prefers order_packed_date as invoiceDate when present', () => {
    const row = repairImportRowDates({
      invoiceNo: 'I2427MX000000699',
      invoiceDate: '2026-12-06',
      order_packed_date: '12-06-2026',
      reportMonth: '2026-06',
    });
    expect(row.order_packed_date).toBe('2026-06-12');
    expect(row.invoiceDate).toBe('2026-06-12');
  });

  it('maps RTO Return invoiceDate from orderCancelDate', () => {
    const row = repairImportRowDates({
      documentType: 'RTO Return',
      invoiceDate: '2026-01-01',
      orderCancelDate: '30-06-2026',
      order_packed_date: '01-01-2026',
      reportMonth: '2026-06',
    });
    expect(row.orderCancelDate).toBe('2026-06-30');
    expect(row.invoiceDate).toBe('2026-06-30');
  });

  it('maps Customer Return invoiceDate from frRefundedDate', () => {
    const row = repairImportRowDates({
      documentType: 'Customer Return',
      invoiceDate: '2026-01-01',
      frRefundedDate: '05-12-2025',
      order_packed_date: '01-01-2026',
      reportMonth: '2025-12',
    });
    expect(row.frRefundedDate).toBe('2025-12-05');
    expect(row.invoiceDate).toBe('2025-12-05');
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
