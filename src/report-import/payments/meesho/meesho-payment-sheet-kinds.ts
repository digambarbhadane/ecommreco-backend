import { normalizePaymentHeader } from '../core/payment-header-normalizer.util';

export type MeeshoPaymentSheetKind =
  | 'orderPayments'
  | 'adsCost'
  | 'referralPayments'
  | 'compensationRecovery';

export type MeeshoPaymentSheetDef = {
  kind: MeeshoPaymentSheetKind;
  label: string;
  collection: string;
  sheetNameAliases: string[];
};

/** Meesho payment workbooks: headers on Excel row 2 (index 1), data from row 4 (index 3). */
export const MEESHO_PAYMENT_HEADER_ROW_INDEX = 1;
export const MEESHO_PAYMENT_DATA_START_OFFSET = 2;

export const MEESHO_PAYMENT_SHEETS: MeeshoPaymentSheetDef[] = [
  {
    kind: 'orderPayments',
    label: 'Order Payments',
    collection: 'meesho_order_payments',
    sheetNameAliases: ['Order Payments', 'order payments'],
  },
  {
    kind: 'adsCost',
    label: 'Ads Cost',
    collection: 'meesho_ads_cost',
    sheetNameAliases: ['Ads Cost', 'ads cost'],
  },
  {
    kind: 'referralPayments',
    label: 'Referral Payments',
    collection: 'meesho_referral_payments',
    sheetNameAliases: ['Referral Payments', 'referral payments'],
  },
  {
    kind: 'compensationRecovery',
    label: 'Compensation and Recovery',
    collection: 'meesho_compensation_recovery',
    sheetNameAliases: [
      'Compensation and Recovery',
      'Compensation And Recovery',
      'compensation and recovery',
    ],
  },
];

export function findMeeshoPaymentSheetDef(
  kind: MeeshoPaymentSheetKind,
): MeeshoPaymentSheetDef | undefined {
  return MEESHO_PAYMENT_SHEETS.find((def) => def.kind === kind);
}

export function matchMeeshoPaymentSheetKind(
  sheetName: string,
): MeeshoPaymentSheetKind | null {
  const normalized = normalizePaymentHeader(sheetName);
  for (const def of MEESHO_PAYMENT_SHEETS) {
    if (
      def.sheetNameAliases.some(
        (alias) => normalizePaymentHeader(alias) === normalized,
      )
    ) {
      return def.kind;
    }
  }
  return null;
}

export function resolveMeeshoPaymentSheetName(
  sheetNames: string[],
  kind: MeeshoPaymentSheetKind,
): string | null {
  const def = findMeeshoPaymentSheetDef(kind);
  if (!def) return null;
  for (const name of sheetNames) {
    if (matchMeeshoPaymentSheetKind(name) === kind) return name;
  }
  return null;
}
