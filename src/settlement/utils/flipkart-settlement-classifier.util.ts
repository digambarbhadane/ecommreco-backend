export type FlipkartSettlementClassification = {
  role: 'sale' | 'return';
  sign: 1 | -1;
  transactionName: string;
};

export function classifyFlipkartSettlementRow(
  documentType: unknown,
  voucherType: unknown,
): FlipkartSettlementClassification {
  const document = String(documentType ?? '').trim().toLowerCase();
  const voucher = String(voucherType ?? '').trim().toLowerCase();
  const combined = `${document} ${voucher}`.replace(/\s+/g, ' ').trim();

  if (
    /return cancellation/.test(voucher) ||
    /return cancellation/.test(document)
  ) {
    return {
      role: 'return',
      sign: -1,
      transactionName: 'Return Cancellation',
    };
  }
  if (
    /sales? cancellation/.test(combined) ||
    (/\breturn\b/.test(document) && /^cancell?ation$/.test(voucher))
  ) {
    return {
      role: 'return',
      sign: 1,
      transactionName: 'Sales Cancellation',
    };
  }
  if (/debit note/.test(combined)) {
    return { role: 'return', sign: 1, transactionName: 'Debit Note' };
  }
  if (/\breturn\b/.test(combined)) {
    return { role: 'return', sign: 1, transactionName: 'Order Return' };
  }
  if (/credit note/.test(combined)) {
    return { role: 'sale', sign: 1, transactionName: 'Credit Note' };
  }
  return { role: 'sale', sign: 1, transactionName: 'Order Sale' };
}
