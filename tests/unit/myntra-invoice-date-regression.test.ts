import { mapImportRowToPaymentAnalyticsRow } from '../../src/report-import/payments/payment-analytics.types';
import {
  resolveMyntraAnalyticsInvoiceDate,
  resolveMyntraOrderReportInvoiceDate,
  resolveMyntraReturnTransactionDate,
} from '../../src/report-import/payments/myntra/myntra-invoice-date.util';
import { asImportDateIso } from '../../src/report-import/utils/import-date.util';

describe('myntra invoice date regression', () => {
  it('keeps invoiceDate when packed and invoice agree', () => {
    const mapped = mapImportRowToPaymentAnalyticsRow({
      _id: '1',
      orderID: '5609787070',
      documentType: 'SALE',
      invoiceDate: '2025-09-23',
      order_packed_date: '23-09-2025',
      invoiceAmount: 1338,
      marketplace: 'myntra',
    });
    expect(mapped.invoiceDate).toBe('2025-09-23');
  });

  it('keeps invoiceDate when packed is missing', () => {
    const mapped = mapImportRowToPaymentAnalyticsRow({
      _id: '1',
      orderID: '5609787070',
      documentType: 'SALE',
      invoiceDate: '2025-09-23',
      invoiceAmount: 1338,
      marketplace: 'myntra',
    });
    expect(mapped.invoiceDate).toBe('2025-09-23');
  });

  it('parses packed DMY and ISO invoiceDate', () => {
    expect(asImportDateIso('23-09-2025')).toBe('2025-09-23');
    expect(asImportDateIso('2025-09-23')).toBe('2025-09-23');
    expect(asImportDateIso('06-12-2026')).toBe('2026-12-06');
    expect(asImportDateIso('2026-12-06')).toBe('2026-12-06');
  });

  it('does not blank SALE dates', () => {
    expect(
      resolveMyntraAnalyticsInvoiceDate({
        documentType: 'SALE',
        invoiceDate: '2025-09-23',
        order_packed_date: '23-09-2025',
      }),
    ).toBe('2025-09-23');
  });

  it('maps RTO orderCancelDate onto return paymentDate', () => {
    expect(
      resolveMyntraReturnTransactionDate({
        documentType: 'RTO Return',
        orderCancelDate: '2026-06-30',
      }),
    ).toBe('2026-06-30');

    const mapped = mapImportRowToPaymentAnalyticsRow({
      _id: 'rto-1',
      orderID: '5935708474',
      documentType: 'RTO Return',
      orderCancelDate: '2026-06-30',
      invoiceAmount: -855,
      marketplace: 'myntra',
    });
    expect(mapped.paymentDate).toBe('2026-06-30');
    expect(mapped.invoiceDate).toBeUndefined();
  });

  it('maps Customer Return frRefundedDate onto return paymentDate', () => {
    const mapped = mapImportRowToPaymentAnalyticsRow({
      _id: 'rt-1',
      orderID: '5691081908',
      documentType: 'Customer Return',
      frRefundedDate: '2025-12-05',
      invoiceAmount: -817,
      marketplace: 'myntra',
    });
    expect(mapped.paymentDate).toBe('2025-12-05');
  });

  it('Order Report: RTO uses orderCancelDate; Customer Return uses frRefundedDate', () => {
    expect(
      resolveMyntraOrderReportInvoiceDate({
        documentType: 'RTO Return',
        orderCancelDate: '30-06-2026',
        invoiceDate: '2026-01-01',
        order_packed_date: '01-01-2026',
      }),
    ).toBe('2026-06-30');

    expect(
      resolveMyntraOrderReportInvoiceDate({
        documentType: 'Customer Return',
        frRefundedDate: '05-12-2025',
        invoiceDate: '2026-01-01',
        order_packed_date: '01-01-2026',
      }),
    ).toBe('2025-12-05');

    expect(
      resolveMyntraOrderReportInvoiceDate({
        documentType: 'SALE',
        invoiceDate: '2026-12-06',
        order_packed_date: '12-06-2026',
      }),
    ).toBe('2026-06-12');
  });
});
