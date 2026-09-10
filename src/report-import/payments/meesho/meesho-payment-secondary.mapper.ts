import { normalizePaymentHeader } from '../core/payment-header-normalizer.util';
import {
  coerceMeeshoDate,
  coerceMeeshoNumber,
  coerceMeeshoString,
  normalizeMeeshoHeader,
} from './meesho-payment-coercion.util';
import type { MeeshoPaymentSheetKind } from './meesho-payment-sheet-kinds';
import type { ParsedSheetRow } from '../../services/mapping.service';

type SecondaryFieldDef = {
  field: string;
  aliases: string[];
  type: 'string' | 'number' | 'date';
};

const SECONDARY_SHEET_FIELDS: Record<
  Exclude<MeeshoPaymentSheetKind, 'orderPayments'>,
  SecondaryFieldDef[]
> = {
  adsCost: [
    {
      field: 'deductionDuration',
      aliases: ['Deduction Duration'],
      type: 'string',
    },
    { field: 'deductionDate', aliases: ['Deduction Date'], type: 'date' },
    {
      field: 'campaignId',
      aliases: ['Campaign ID', 'Campaign Id'],
      type: 'string',
    },
    { field: 'adCost', aliases: ['Ad Cost'], type: 'number' },
    {
      field: 'creditsWaiversDiscounts',
      aliases: [
        'Credits / Waivers / Discounts',
        'Credits/Waivers/Discounts',
        'Credits Waivers Discounts',
      ],
      type: 'number',
    },
    {
      field: 'adCostInclCreditsWaiversDiscounts',
      aliases: [
        'Ad Cost (Incl. Credits, Waivers & Discounts)',
        'Ad Cost (Incl Credits Waivers Discounts)',
      ],
      type: 'number',
    },
    { field: 'gst', aliases: ['GST'], type: 'number' },
    { field: 'totalAdsCost', aliases: ['Total Ads Cost'], type: 'number' },
  ],
  referralPayments: [
    { field: 'rewardId', aliases: ['Reward ID', 'Reward Id'], type: 'string' },
    { field: 'paymentDate', aliases: ['Payment Date'], type: 'date' },
    { field: 'storeName', aliases: ['Store Name'], type: 'string' },
    { field: 'reason', aliases: ['Reason'], type: 'string' },
    {
      field: 'netReferralAmount',
      aliases: ['Net Referral Amount'],
      type: 'number',
    },
    {
      field: 'taxesGstTds',
      aliases: ['Taxes (GST/TDS)', 'Taxes GST TDS', 'Taxes(GST/TDS)'],
      type: 'number',
    },
  ],
  compensationRecovery: [
    { field: 'date', aliases: ['Date'], type: 'date' },
    { field: 'programName', aliases: ['Program Name'], type: 'string' },
    { field: 'reason', aliases: ['Reason'], type: 'string' },
    {
      field: 'amountInclGstInr',
      aliases: [
        'Amount (Incl. GST) INR',
        'Amount (Incl GST) INR',
        'Amount Incl GST INR',
      ],
      type: 'number',
    },
  ],
};

function buildSecondaryLookup(
  kind: Exclude<MeeshoPaymentSheetKind, 'orderPayments'>,
): Map<string, SecondaryFieldDef> {
  const lookup = new Map<string, SecondaryFieldDef>();
  for (const def of SECONDARY_SHEET_FIELDS[kind]) {
    for (const alias of def.aliases) {
      lookup.set(normalizePaymentHeader(alias), def);
    }
  }
  return lookup;
}

function coerceSecondaryValue(
  def: SecondaryFieldDef,
  value: unknown,
): string | number | Date | null {
  if (value === null || value === undefined || value === '') return null;
  switch (def.type) {
    case 'date':
      return coerceMeeshoDate(value);
    case 'number':
      return coerceMeeshoNumber(value);
    default:
      return coerceMeeshoString(value);
  }
}

export function mapMeeshoSecondarySheetRow(
  kind: Exclude<MeeshoPaymentSheetKind, 'orderPayments'>,
  rawRow: ParsedSheetRow,
): Record<string, string | number | Date | null> {
  const lookup = buildSecondaryLookup(kind);
  const mapped: Record<string, string | number | Date | null> = {};

  for (const [header, value] of Object.entries(rawRow)) {
    if (header.startsWith('__')) continue;
    const def =
      lookup.get(normalizePaymentHeader(header)) ??
      lookup.get(normalizePaymentHeader(normalizeMeeshoHeader(header)));
    if (!def) continue;
    if (mapped[def.field] !== undefined && mapped[def.field] !== null) continue;
    mapped[def.field] = coerceSecondaryValue(def, value);
  }

  return mapped;
}

export function isMeeshoSecondaryRowEmpty(
  row: Record<string, string | number | Date | null>,
): boolean {
  return Object.values(row).every(
    (value) => value === null || value === undefined || value === '',
  );
}
