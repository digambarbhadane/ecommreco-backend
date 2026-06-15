/**
 * Lightweight in-process TTL cache for hot read paths (seller alias resolution, etc.).
 */
export class TtlCache<K, V> {
  private readonly store = new Map<K, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Shared cache: seller id → alias list (avoids repeated Mongo lookups per request). */
export const sellerAliasCache = new TtlCache<string, string[]>(5 * 60 * 1000);

export function cacheKey(value: string): string {
  return value.trim().toLowerCase();
}
