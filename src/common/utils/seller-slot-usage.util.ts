export type GstSlotRecord = {
  panNumber?: string;
  gstNumber?: string;
};

export function extractPanFromGstRecord(record: GstSlotRecord): string | null {
  const panNumber = String(record.panNumber ?? '')
    .trim()
    .toUpperCase();
  if (panNumber) {
    return panNumber;
  }
  const gstNumber = String(record.gstNumber ?? '')
    .trim()
    .toUpperCase();
  return gstNumber.length >= 12 ? gstNumber.slice(2, 12) : null;
}

/** Count active GST registrations and distinct PANs from Gst documents. */
export function computeSlotUsageFromGstRecords(records: GstSlotRecord[]) {
  const panSet = new Set<string>();
  for (const record of records) {
    const pan = extractPanFromGstRecord(record);
    if (pan) {
      panSet.add(pan);
    }
  }
  return {
    gstUsed: records.length,
    panUsed: panSet.size,
  };
}
