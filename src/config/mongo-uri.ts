import type { ConfigService } from '@nestjs/config';

/** Ordered URIs to try (standard URI first when set — avoids Node querySrv issues on Windows). */
export function getMongoUriCandidates(config: ConfigService): string[] {
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      return trimmed;
    }
    return null;
  };

  const ordered: string[] = [];
  for (const key of [
    'MONGODB_URI_STANDARD',
    'MONGODB_URI',
    'MONGODB_FALLBACK_URI',
  ] as const) {
    const uri = add(config.get<string>(key));
    if (uri) ordered.push(uri);
  }
  return ordered;
}

export function isSrvDnsRefusedError(message: string): boolean {
  return /querySrv\s+ECONNREFUSED/i.test(message);
}

export function mongoConnectionHint(message: string): string | null {
  if (isSrvDnsRefusedError(message)) {
    return (
      'Node.js cannot resolve mongodb+srv (querySrv ECONNREFUSED). ' +
      'Use a standard mongodb:// connection string from Atlas (Connect → Drivers → "Standard connection string"), ' +
      'or set MONGODB_URI_STANDARD in your .env file.'
    );
  }
  return null;
}
