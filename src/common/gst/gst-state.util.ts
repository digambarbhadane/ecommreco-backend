/** Canonical lowercase state keys used for GST place-of-supply comparison. */
const GST_STATE_CODE_TO_KEY: Record<string, string> = {
  '01': 'jammu and kashmir',
  '02': 'himachal pradesh',
  '03': 'punjab',
  '04': 'chandigarh',
  '05': 'uttarakhand',
  '06': 'haryana',
  '07': 'delhi',
  '08': 'rajasthan',
  '09': 'uttar pradesh',
  '10': 'bihar',
  '11': 'sikkim',
  '12': 'arunachal pradesh',
  '13': 'nagaland',
  '14': 'manipur',
  '15': 'mizoram',
  '16': 'tripura',
  '17': 'meghalaya',
  '18': 'assam',
  '19': 'west bengal',
  '20': 'jharkhand',
  '21': 'odisha',
  '22': 'chhattisgarh',
  '23': 'madhya pradesh',
  '24': 'gujarat',
  '25': 'daman and diu',
  '26': 'dadra and nagar haveli and daman and diu',
  '27': 'maharashtra',
  '28': 'andhra pradesh',
  '29': 'karnataka',
  '30': 'goa',
  '31': 'lakshadweep',
  '32': 'kerala',
  '33': 'tamil nadu',
  '34': 'puducherry',
  '35': 'andaman and nicobar islands',
  '36': 'telangana',
  '37': 'andhra pradesh',
  '38': 'ladakh',
};

const STATE_ALIAS_TO_KEY: Record<string, string> = {
  ...Object.fromEntries(
    Object.values(GST_STATE_CODE_TO_KEY).map((key) => [key, key]),
  ),
  jammu: 'jammu and kashmir',
  'jammu & kashmir': 'jammu and kashmir',
  'j and k': 'jammu and kashmir',
  orissa: 'odisha',
  pondicherry: 'puducherry',
  'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman & diu': 'daman and diu',
  'dadra & nagar haveli & daman & diu':
    'dadra and nagar haveli and daman and diu',
  'andaman & nicobar islands': 'andaman and nicobar islands',
  'andaman and nicobar': 'andaman and nicobar islands',
  'nct of delhi': 'delhi',
  'new delhi': 'delhi',
  uttaranchal: 'uttarakhand',
  ap: 'andhra pradesh',
  ar: 'arunachal pradesh',
  as: 'assam',
  br: 'bihar',
  cg: 'chhattisgarh',
  ch: 'chandigarh',
  dd: 'dadra and nagar haveli and daman and diu',
  dl: 'delhi',
  dn: 'dadra and nagar haveli and daman and diu',
  ga: 'goa',
  gj: 'gujarat',
  hp: 'himachal pradesh',
  hr: 'haryana',
  jh: 'jharkhand',
  jk: 'jammu and kashmir',
  ka: 'karnataka',
  kl: 'kerala',
  la: 'ladakh',
  ld: 'lakshadweep',
  mh: 'maharashtra',
  ml: 'meghalaya',
  mn: 'manipur',
  mp: 'madhya pradesh',
  mz: 'mizoram',
  nl: 'nagaland',
  od: 'odisha',
  or: 'odisha',
  pb: 'punjab',
  py: 'puducherry',
  rj: 'rajasthan',
  sk: 'sikkim',
  tg: 'telangana',
  tn: 'tamil nadu',
  tr: 'tripura',
  ts: 'telangana',
  uk: 'uttarakhand',
  up: 'uttar pradesh',
  wb: 'west bengal',
  an: 'andaman and nicobar islands',
};

const normalizeStateText = (value?: string): string => {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const lookupStateKey = (normalized: string): string => {
  if (!normalized) return '';
  if (STATE_ALIAS_TO_KEY[normalized]) return STATE_ALIAS_TO_KEY[normalized];

  const codeMatch = normalized.match(/\b(0[1-9]|[1-3][0-9])\b/);
  if (codeMatch && GST_STATE_CODE_TO_KEY[codeMatch[1]]) {
    return GST_STATE_CODE_TO_KEY[codeMatch[1]];
  }

  if (/^\d{2}$/.test(normalized) && GST_STATE_CODE_TO_KEY[normalized]) {
    return GST_STATE_CODE_TO_KEY[normalized];
  }

  if (normalized.length === 2 && STATE_ALIAS_TO_KEY[normalized]) {
    return STATE_ALIAS_TO_KEY[normalized];
  }

  return normalized;
};

/** Normalize state label for comparison (trim + lowercase canonical key). */
export const normalizeState = (value?: string | number | null): string =>
  resolveIndianStateKey(value ?? '');

/** Resolve any Indian state label/code/abbreviation to a canonical comparison key. */
export const resolveIndianStateKey = (value?: string | number): string => {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value).trim();
  if (/^\d{1,2}$/.test(raw)) {
    const padded = raw.padStart(2, '0');
    if (GST_STATE_CODE_TO_KEY[padded]) return GST_STATE_CODE_TO_KEY[padded];
  }
  const normalized = normalizeStateText(raw);
  if (!normalized) return '';
  return lookupStateKey(normalized);
};

/** Resolve customer_delivery_state_code (or state name) to a 2-digit GST state code. */
export const resolveIndianStateCode = (value?: string | number): string => {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value).trim();
  if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, '0');
  const key = resolveIndianStateKey(raw);
  if (!key) return '';
  for (const [code, stateKey] of Object.entries(GST_STATE_CODE_TO_KEY)) {
    if (stateKey === key) return code;
  }
  return '';
};

export const getGstStateCodeFromGstin = (gstin?: string): string | undefined => {
  if (!gstin) return undefined;
  const cleaned = gstin.trim().toUpperCase();
  if (cleaned.length < 2) return undefined;
  const code = cleaned.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : undefined;
};

export const getGstStateCode = (gstin?: string): string =>
  getGstStateCodeFromGstin(gstin) ?? '';

export const resolveIndianStateKeyFromGstin = (gstin?: string): string => {
  const code = getGstStateCodeFromGstin(gstin);
  if (!code) return '';
  return GST_STATE_CODE_TO_KEY[code] ?? '';
};

export const collectSellerRegistrationStateKeys = (
  states: string[],
  gstins: string[] = [],
): Set<string> => {
  const keys = new Set<string>();
  for (const state of states) {
    const key = resolveIndianStateKey(state);
    if (key) keys.add(key);
  }
  for (const gstin of gstins) {
    const key = resolveIndianStateKeyFromGstin(gstin);
    if (key) keys.add(key);
  }
  return keys;
};

export const isSameIndianState = (
  customerState: string | undefined,
  sellerStateKeys: Set<string>,
): boolean => {
  const customerKey = resolveIndianStateKey(customerState);
  if (!customerKey || sellerStateKeys.size === 0) return false;
  return sellerStateKeys.has(customerKey);
};

/** Compare seller GSTIN state prefix with customer state code. */
export const isSameIndianStateByCode = (
  customerStateCode: string | undefined,
  sellerGstin?: string,
): boolean => {
  const sellerCode = getGstStateCodeFromGstin(sellerGstin);
  const customerCode = resolveIndianStateCode(customerStateCode);
  if (!sellerCode || !customerCode) return false;
  return sellerCode === customerCode;
};

/** Resolve customer state from stored code and/or label (import + summary). */
export const resolveCustomerIndianStateCode = (
  customerStateCode?: string | null,
  stateName?: string | null,
): string => {
  const fromCode = resolveIndianStateCode(customerStateCode ?? '');
  if (fromCode) return fromCode;
  return resolveIndianStateCode(stateName ?? '');
};

type MongoExpr = Record<string, unknown>;

const buildStateLabelToCodeSwitch = (inputExpr: MongoExpr): MongoExpr => {
  const branches: Array<{ case: MongoExpr; then: string }> = [];
  const seen = new Set<string>();

  for (const [code, stateKey] of Object.entries(GST_STATE_CODE_TO_KEY)) {
    const tag = `${stateKey}:${code}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    branches.push({
      case: { $eq: [inputExpr, stateKey] },
      then: code,
    });
  }

  for (const [alias, stateKey] of Object.entries(STATE_ALIAS_TO_KEY)) {
    const code = Object.entries(GST_STATE_CODE_TO_KEY).find(
      ([, key]) => key === stateKey,
    )?.[0];
    if (!code) continue;
    const tag = `${alias}:${code}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    branches.push({
      case: { $eq: [inputExpr, alias] },
      then: code,
    });
  }

  return { $switch: { branches, default: '' } };
};

const buildPaddedOrNamedStateCodeExpr = (rawFieldExpr: MongoExpr): MongoExpr => ({
  $let: {
    vars: {
      raw: { $trim: { input: { $toString: rawFieldExpr } } },
    },
    in: {
      $cond: [
        { $regexMatch: { input: '$$raw', regex: '^\\d{1,2}$' } },
        {
          $cond: [
            { $eq: [{ $strLenCP: '$$raw' }, 1] },
            { $concat: ['0', '$$raw'] },
            '$$raw',
          ],
        },
        buildStateLabelToCodeSwitch({ $toLower: '$$raw' }),
      ],
    },
  },
});

export const buildCustomerIndianStateCodeExpr = (
  codeField = '$customerStateCode',
  nameField = '$stateName',
): MongoExpr => ({
  $let: {
    vars: {
      codeTrim: {
        $trim: { input: { $toString: { $ifNull: [codeField, ''] } } },
      },
    },
    in: {
      $cond: [
        { $ne: ['$$codeTrim', ''] },
        buildPaddedOrNamedStateCodeExpr({ $ifNull: [codeField, ''] }),
        buildPaddedOrNamedStateCodeExpr({ $ifNull: [nameField, ''] }),
      ],
    },
  },
});

export const buildSellerGstStateCodeExpr = (gstinField = '$gstin'): MongoExpr => ({
  $substr: [{ $toUpper: { $ifNull: [gstinField, ''] } }, 0, 2],
});
