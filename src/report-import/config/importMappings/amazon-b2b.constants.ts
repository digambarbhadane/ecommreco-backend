/** Amazon MTR B2B buyer GSTIN column labels (Seller Central export variants). */
export const AMAZON_B2B_CUSTOMER_GST_COLUMNS = [
  'Customer Bill To Gstid',
  'Customer Bill to GSTIN',
  'Customer Bill To GSTIN',
  'Customer GST No',
  'Bill To GSTIN',
  'Buyer GSTIN',
  'Customer GSTIN',
] as const;

/** Amazon MTR B2B buyer name column labels. */
export const AMAZON_B2B_BUYER_NAME_COLUMNS = [
  'Buyer Name',
  'Customer Name',
  'Bill To Customer Name',
  'Bill To Name',
] as const;

export const AMAZON_B2B_EXTRA_HEADER_GROUPS: ReadonlyArray<readonly string[]> =
  [AMAZON_B2B_CUSTOMER_GST_COLUMNS, AMAZON_B2B_BUYER_NAME_COLUMNS];
