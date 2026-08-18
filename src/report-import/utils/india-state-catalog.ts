import { resolveIndianStateCode } from '../../common/gst/gst-state.util';

export type IndiaStateCatalogEntry = {
  gstCode: string;
  isoCode: string;
  name: string;
};

/** GST 2-digit code → ISO 3166-2:IN alpha, plus display name. */
export const INDIA_STATE_CATALOG: IndiaStateCatalogEntry[] = [
  { gstCode: '01', isoCode: 'JK', name: 'Jammu and Kashmir' },
  { gstCode: '02', isoCode: 'HP', name: 'Himachal Pradesh' },
  { gstCode: '03', isoCode: 'PB', name: 'Punjab' },
  { gstCode: '04', isoCode: 'CH', name: 'Chandigarh' },
  { gstCode: '05', isoCode: 'UK', name: 'Uttarakhand' },
  { gstCode: '06', isoCode: 'HR', name: 'Haryana' },
  { gstCode: '07', isoCode: 'DL', name: 'Delhi' },
  { gstCode: '08', isoCode: 'RJ', name: 'Rajasthan' },
  { gstCode: '09', isoCode: 'UP', name: 'Uttar Pradesh' },
  { gstCode: '10', isoCode: 'BR', name: 'Bihar' },
  { gstCode: '11', isoCode: 'SK', name: 'Sikkim' },
  { gstCode: '12', isoCode: 'AR', name: 'Arunachal Pradesh' },
  { gstCode: '13', isoCode: 'NL', name: 'Nagaland' },
  { gstCode: '14', isoCode: 'MN', name: 'Manipur' },
  { gstCode: '15', isoCode: 'MZ', name: 'Mizoram' },
  { gstCode: '16', isoCode: 'TR', name: 'Tripura' },
  { gstCode: '17', isoCode: 'ML', name: 'Meghalaya' },
  { gstCode: '18', isoCode: 'AS', name: 'Assam' },
  { gstCode: '19', isoCode: 'WB', name: 'West Bengal' },
  { gstCode: '20', isoCode: 'JH', name: 'Jharkhand' },
  { gstCode: '21', isoCode: 'OD', name: 'Odisha' },
  { gstCode: '22', isoCode: 'CG', name: 'Chhattisgarh' },
  { gstCode: '23', isoCode: 'MP', name: 'Madhya Pradesh' },
  { gstCode: '24', isoCode: 'GJ', name: 'Gujarat' },
  { gstCode: '26', isoCode: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { gstCode: '27', isoCode: 'MH', name: 'Maharashtra' },
  { gstCode: '28', isoCode: 'AP', name: 'Andhra Pradesh' },
  { gstCode: '29', isoCode: 'KA', name: 'Karnataka' },
  { gstCode: '30', isoCode: 'GA', name: 'Goa' },
  { gstCode: '31', isoCode: 'LD', name: 'Lakshadweep' },
  { gstCode: '32', isoCode: 'KL', name: 'Kerala' },
  { gstCode: '33', isoCode: 'TN', name: 'Tamil Nadu' },
  { gstCode: '34', isoCode: 'PY', name: 'Puducherry' },
  { gstCode: '35', isoCode: 'AN', name: 'Andaman and Nicobar Islands' },
  { gstCode: '36', isoCode: 'TS', name: 'Telangana' },
  { gstCode: '38', isoCode: 'LA', name: 'Ladakh' },
];

const GST_TO_ENTRY = new Map(INDIA_STATE_CATALOG.map((item) => [item.gstCode, item]));
const ISO_TO_ENTRY = new Map(
  INDIA_STATE_CATALOG.map((item) => [item.isoCode, item]),
);

/** Older GST code 25 (Daman and Diu) maps onto the merged UT. */
GST_TO_ENTRY.set('25', GST_TO_ENTRY.get('26')!);
/** Pre-bifurcation Andhra GST 37. */
GST_TO_ENTRY.set('37', GST_TO_ENTRY.get('28')!);

export const UNMAPPED_STATE_CODE = 'UNMAPPED';

export function getIndiaStateByGstCode(code: string): IndiaStateCatalogEntry | undefined {
  return GST_TO_ENTRY.get(String(code ?? '').padStart(2, '0'));
}

export function getIndiaStateByIso(code: string): IndiaStateCatalogEntry | undefined {
  return ISO_TO_ENTRY.get(String(code ?? '').trim().toUpperCase());
}

export function canonicalizeGeographyStateCode(
  customerStateCode?: string | null,
  stateName?: string | null,
): string {
  const resolved = resolveIndianStateCode(customerStateCode || stateName || '');
  if (!resolved) return UNMAPPED_STATE_CODE;
  const entry = getIndiaStateByGstCode(resolved);
  return entry?.gstCode ?? UNMAPPED_STATE_CODE;
}

export function catalogNameForCode(code: string): string {
  if (code === UNMAPPED_STATE_CODE) return 'Unknown / Unmapped';
  return getIndiaStateByGstCode(code)?.name ?? code;
}

export function catalogIsoForCode(code: string): string {
  if (code === UNMAPPED_STATE_CODE) return 'XX';
  return getIndiaStateByGstCode(code)?.isoCode ?? code;
}
