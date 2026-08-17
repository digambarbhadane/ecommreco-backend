export function extractPanFromGstin(gstNumber?: string): string {
  return String(gstNumber ?? '')
    .trim()
    .toUpperCase()
    .slice(2, 12);
}

export function resolveGstPan(gst: {
  panNumber?: string;
  gstNumber?: string;
}): string {
  const pan = String(gst.panNumber ?? '')
    .trim()
    .toUpperCase();
  return pan || extractPanFromGstin(gst.gstNumber);
}

/** GSTIN 13th character (index 12) is the entity number; `1` is the first registration. */
export function isEntityNumberOne(gstNumber?: string): boolean {
  const value = String(gstNumber ?? '')
    .trim()
    .toUpperCase();
  return value.length >= 13 && value[12] === '1';
}

function gstIdentity(gst: { _id?: unknown; id?: string }): string {
  return String(gst._id ?? gst.id ?? '');
}

function createdAtMs(value?: Date | string): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

export function pickPrincipalGst<
  T extends {
    _id?: unknown;
    id?: string;
    gstNumber?: string;
    panNumber?: string;
    createdAt?: Date | string;
  },
>(gsts: T[]): T | undefined {
  if (!gsts.length) return undefined;
  const withEntityOne = gsts.filter((gst) => isEntityNumberOne(gst.gstNumber));
  const pool = withEntityOne.length > 0 ? withEntityOne : gsts;
  return [...pool].sort((a, b) => {
    const byCreated = createdAtMs(a.createdAt) - createdAtMs(b.createdAt);
    if (byCreated !== 0) return byCreated;
    return String(a.gstNumber ?? '').localeCompare(String(b.gstNumber ?? ''));
  })[0];
}

export function isPrincipalGst<
  T extends {
    _id?: unknown;
    id?: string;
    gstNumber?: string;
    panNumber?: string;
    createdAt?: Date | string;
  },
>(gst: T, allGsts: T[]): boolean {
  const pan = resolveGstPan(gst);
  if (!pan) return true;
  const siblings = allGsts.filter((item) => resolveGstPan(item) === pan);
  if (siblings.length <= 1) return true;
  const principal = pickPrincipalGst(siblings);
  return gstIdentity(principal ?? {}) === gstIdentity(gst);
}
