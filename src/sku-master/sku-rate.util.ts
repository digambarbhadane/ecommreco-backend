/** Parse a numeric Rate value from Excel or API input. Stored as entered. */
export function parseSkuRate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return roundRate(value);
  }
  const text = String(value).trim();
  if (
    !text ||
    /^[-–—?/]$/.test(text) ||
    /^(n\/a|na|null|none|nil)$/i.test(text)
  ) {
    return null;
  }
  const cleaned = text
    .replace(/[%₹$€£]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned) return null;
  const rate = Number(cleaned);
  if (!Number.isFinite(rate) || rate < 0) return null;
  return roundRate(rate);
}

function roundRate(rate: number): number {
  return Math.round(rate * 10000) / 10000;
}
