/** Normalize Excel header labels for alias matching (case/space/punctuation insensitive). */
export const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s*=\s*/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
