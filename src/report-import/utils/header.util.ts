/** Strip invisible Unicode characters that often appear in Excel exports. */
export const stripInvisibleChars = (value: string) =>
  value.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');

/** Normalize Excel header labels for alias matching (case/space/punctuation insensitive). */
export const normalizeHeader = (value: string) =>
  stripInvisibleChars(value)
    .trim()
    .toLowerCase()
    .replace(/\s*=\s*/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** True when a normalized cell value looks like data, not a column title. */
export const cellLooksLikeDataValue = (normalizedCell: string): boolean => {
  const s = normalizedCell.trim();
  if (!s) return false;
  if (/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return true;
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(s)) return true;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  ) {
    return true;
  }
  if (/\d/.test(s) && s.length >= 10 && /[a-z]/i.test(s)) return true;
  return false;
};

/** Header rows are mostly text labels; data rows are mostly IDs, dates, and numbers. */
export const rowLooksLikeHeaderRow = (normalizedCells: string[]): boolean => {
  const nonEmpty = normalizedCells.filter((c) => c.length > 0);
  if (nonEmpty.length < 2) return false;
  const dataLike = nonEmpty.filter((c) => cellLooksLikeDataValue(c)).length;
  return dataLike / nonEmpty.length < 0.4;
};

/** Match alias to a cell without treating data values (e.g. "Return") as column names. */
export const headerAliasMatchesCell = (cell: string, alias: string): boolean => {
  if (!cell || !alias) return false;
  if (cellLooksLikeDataValue(cell)) return false;
  if (cell === alias) return true;
  if (cell.includes(alias)) return true;
  if (alias.includes(cell) && cell.length >= 8) return true;
  return false;
};
