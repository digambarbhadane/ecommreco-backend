/** Normalize marketplace order keys for cross-file joins (Excel number/date quirks). */
export const normalizeOrderKey = (raw: unknown): string => {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (Number.isInteger(raw)) return String(raw);
    const truncated = Math.trunc(raw);
    if (Math.abs(raw - truncated) < 1e-6) return String(truncated);
    return String(raw);
  }
  let text = String(raw).trim();
  if (!text) return '';
  text = text.replace(/^['`]+/, '').trim();
  if (/^\d+\.0+$/.test(text)) {
    return text.replace(/\.0+$/, '');
  }
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num) && Number.isInteger(num)) return String(num);
  }
  return text;
};
