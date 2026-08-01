export type GstNameRecord = {
  tradeName?: string | null;
  businessName?: string | null;
};

/** Prefer GST trade name over legal/owner name for user-facing labels. */
export function resolveGstDisplayName(
  gst?: GstNameRecord | null,
  fallback = '',
): string {
  return (
    String(gst?.tradeName ?? '').trim() ||
    String(gst?.businessName ?? '').trim() ||
    fallback
  );
}
