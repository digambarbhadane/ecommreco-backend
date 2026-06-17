/**
 * Build a MongoDB Atlas URI with a URL-encoded password and explicit database path.
 */
export function encodeMongoPassword(password: string): string {
  return encodeURIComponent(password);
}

export function buildAtlasMongoUri(params: {
  username: string;
  password: string;
  host: string;
  database: string;
  options?: string;
}): string {
  const user = encodeURIComponent(params.username.trim());
  const pass = encodeMongoPassword(params.password);
  const host = params.host.replace(/^\/+|\/+$/g, '');
  const db = params.database.replace(/^\/+|\/+$/g, '');
  const query = params.options?.replace(/^\?/, '') ?? 'retryWrites=true&w=majority';
  return `mongodb+srv://${user}:${pass}@${host}/${db}?${query}`;
}

export type MongoStorageMode = 'atlas' | 'fallback' | 'memory';

let activeStorageMode: MongoStorageMode = 'memory';

export function setMongoStorageMode(mode: MongoStorageMode): void {
  activeStorageMode = mode;
  process.env.MONGO_STORAGE_MODE = mode;
}

export function getMongoStorageMode(): MongoStorageMode {
  return activeStorageMode;
}

export function isInMemoryMongo(): boolean {
  return activeStorageMode === 'memory';
}
