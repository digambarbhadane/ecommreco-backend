export type InvoiceLineItem = {
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
};

export type InvoiceDocument = {
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  status: string;
  sellerName: string;
  sellerEmail: string;
  sellerGstNumber?: string;
  sellerAddress?: string;
  sellerFirmName?: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  paymentReference?: string;
  paymentDate?: string;
  notes?: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export function buildInvoiceHtml(invoice: InvoiceDocument): string {
  const lineRows = invoice.lineItems
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.description)}</td>
          <td class="num">${item.quantity ?? 1}</td>
          <td class="num">${item.unitPrice != null ? formatCurrency(item.unitPrice) : '—'}</td>
          <td class="num">${formatCurrency(item.amount)}</td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; padding: 32px; background: #f8fafc; }
    .sheet { max-width: 820px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px; }
    .header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
    .brand { font-size: 24px; font-weight: 700; color: #003c54; }
    .brand small { display: block; font-size: 12px; font-weight: 400; color: #64748b; margin-top: 4px; }
    .meta { text-align: right; font-size: 13px; color: #475569; }
    .meta strong { display: block; color: #0f172a; font-size: 18px; margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; }
    .box h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
    .box p { margin: 0 0 4px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 8px; text-align: left; font-size: 13px; }
    th { background: #f8fafc; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .num { text-align: right; white-space: nowrap; }
    .totals { margin-top: 16px; margin-left: auto; width: 280px; }
    .totals div { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .totals .grand { border-top: 2px solid #0f172a; margin-top: 8px; padding-top: 10px; font-size: 16px; font-weight: 700; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; background: #ecfdf5; color: #047857; }
    .notes { margin-top: 24px; font-size: 12px; color: #64748b; line-height: 1.6; }
    @media print { body { background: #fff; padding: 0; } .sheet { border: none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="brand">EcommReco<span>Tax Invoice</span></div>
      </div>
      <div class="meta">
        <strong>INVOICE</strong>
        <div># ${escapeHtml(invoice.invoiceNumber)}</div>
        <div>Issue date: ${formatDate(invoice.issueDate)}</div>
        ${invoice.dueDate ? `<div>Due date: ${formatDate(invoice.dueDate)}</div>` : ''}
        <div style="margin-top:8px"><span class="badge">${escapeHtml(invoice.status)}</span></div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <h3>Bill To</h3>
        <p><strong>${escapeHtml(invoice.sellerFirmName || invoice.sellerName)}</strong></p>
        <p>${escapeHtml(invoice.sellerName)}</p>
        <p>${escapeHtml(invoice.sellerEmail)}</p>
        ${invoice.sellerGstNumber ? `<p>GSTIN: ${escapeHtml(invoice.sellerGstNumber)}</p>` : ''}
        ${invoice.sellerAddress ? `<p>${escapeHtml(invoice.sellerAddress)}</p>` : ''}
      </div>
      <div class="box">
        <h3>Payment Details</h3>
        ${invoice.paymentDate ? `<p>Payment date: ${formatDate(invoice.paymentDate)}</p>` : ''}
        ${invoice.paymentReference ? `<p>Reference: ${escapeHtml(invoice.paymentReference)}</p>` : ''}
        <p>Amount: ${formatCurrency(invoice.totalAmount)}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Qty</th>
          <th class="num">Unit Price</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div class="totals">
      <div><span>Subtotal</span><span>${formatCurrency(invoice.subtotal)}</span></div>
      <div><span>GST (18%)</span><span>${formatCurrency(invoice.gstAmount)}</span></div>
      <div class="grand"><span>Total</span><span>${formatCurrency(invoice.totalAmount)}</span></div>
    </div>

    ${
      invoice.notes
        ? `<div class="notes"><strong>Notes:</strong> ${escapeHtml(invoice.notes)}</div>`
        : ''
    }

    <div class="notes">
      This is a computer-generated invoice from EcommReco. For billing queries contact billing@ecommreco.com.
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
