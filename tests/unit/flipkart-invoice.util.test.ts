import {
  applyFlipkartInvoiceAmount,
  computeFlipkartInvoiceAmount,
} from '../../src/report-import/utils/flipkart-invoice.util';
import { MappingService } from '../../src/report-import/services/mapping.service';

describe('flipkart-invoice.util', () => {
  it('computes invoice as taxable + IGST + CGST + SGST', () => {
    expect(
      computeFlipkartInvoiceAmount({
        taxableAmount: 1000,
        igstAmount: 180,
        cgstAmount: 0,
        sgstAmount: 0,
      }),
    ).toBe(1180);
  });

  it('computes invoice with CGST/SGST for intra-state rows', () => {
    expect(
      computeFlipkartInvoiceAmount({
        taxableAmount: 100,
        igstAmount: 0,
        cgstAmount: 9,
        sgstAmount: 9,
      }),
    ).toBe(118);
  });

  it('preserves negative component signs for return rows', () => {
    expect(
      computeFlipkartInvoiceAmount({
        taxableAmount: -200,
        igstAmount: 0,
        cgstAmount: -18,
        sgstAmount: -18,
      }),
    ).toBe(-236);
  });

  it('applyFlipkartInvoiceAmount sets invoiceAmount on the row', () => {
    const row = applyFlipkartInvoiceAmount({
      taxableAmount: 500,
      igstAmount: 90,
    });
    expect(row.invoiceAmount).toBe(590);
  });
});

describe('MappingService Flipkart invoice', () => {
  const mapping = new MappingService();

  it('does not read Final Invoice Amount from sales sheet', () => {
    const mapped = mapping.mapSalesRow({
      __sheetName: 'Sales Report',
      __rowNumber: 2,
      'Seller GSTIN': '07AAAAA0000A1Z5',
      'Order ID': 'ORD-1',
      'Taxable Value': 1000,
      'IGST Amount': 180,
      'Final Invoice Amount (Price after discount+Shipping Charges)': 9999,
      'Event Type': 'Sale',
    });

    expect(mapped.invoiceAmount).toBe(1180);
    expect(mapped.taxableAmount).toBe(1000);
  });

  it('does not read Invoice Amount from cashback sheet', () => {
    const mapped = mapping.mapCashbackRow({
      __sheetName: 'Cash Back Report',
      __rowNumber: 2,
      'Seller GSTIN': '07AAAAA0000A1Z5',
      'Order ID': 'ORD-2',
      'Taxable Value': 50,
      'CGST Amount': 4.5,
      'SGST Amount': 4.5,
      'Invoice Amount': 9999,
      'Document Type': 'Credit Note',
    });

    expect(mapped.invoiceAmount).toBe(59);
  });
});
