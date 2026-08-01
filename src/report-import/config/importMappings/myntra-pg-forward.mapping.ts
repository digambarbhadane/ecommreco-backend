/** Minimum header groups for Myntra PG Forward Settled report. */
export const MYNTRA_PG_FORWARD_REQUIRED_HEADER_GROUPS = [
  ['order_release_id', 'Order Release ID', 'order release id'],
  ['order_line_id', 'Order Line ID', 'order line id'],
] as const;

/** Anchor headers used to detect PG Forward vs PG Reverse exports. */
export const MYNTRA_PG_FORWARD_ANCHOR_HEADERS = [
  'order_release_id',
  'total_actual_settlement',
  'total_expected_settlement',
  'seller_gstn',
] as const;

export const MYNTRA_PG_REVERSE_ANCHOR_HEADERS = [
  'order_release_id',
  'return_type',
  'return_date',
] as const;
