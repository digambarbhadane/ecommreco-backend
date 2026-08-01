export const MONGO_IN_BATCH_SIZE = 5000;

export function chunkArray<T>(items: T[], size = MONGO_IN_BATCH_SIZE): T[][] {
  if (!items.length) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
