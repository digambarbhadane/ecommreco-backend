import { normalizeHeader } from '../../../utils/header.util';

export type FlipkartPaymentSecondarySheetKind =
  | 'mpFeeRebate'
  | 'nonOrderSpf'
  | 'storageRecall'
  | 'valueAddedServices'
  | 'googleAdsServices'
  | 'ads'
  | 'tcsRecovery'
  | 'tds';

export type FlipkartPaymentSecondarySheetDef = {
  kind: FlipkartPaymentSecondarySheetKind;
  /** Canonical display label for UI */
  label: string;
  /** Collection name */
  collection: string;
  /** Sheet name aliases (match loosely after normalize) */
  sheetNameAliases: string[];
  /** Excel labels to store; settlementValue aliases include formula headers */
  fields: {
    neftId: string[];
    paymentDate?: string[];
    settlementValue: string[];
    // extra string fields keyed by property name
    [extra: string]: string[] | undefined;
  };
};

/** Flipkart payment workbooks put column headers on Excel row 2 (1-based). */
export const FLIPKART_PAYMENT_SECONDARY_HEADER_ROW_INDEX = 1;

export const FLIPKART_PAYMENT_SECONDARY_SHEETS: FlipkartPaymentSecondarySheetDef[] =
  [
    {
      kind: 'mpFeeRebate',
      label: 'MP Fee Rebate',
      collection: 'flipkart_payment_mp_fee_rebate',
      sheetNameAliases: ['MP Fee Rebate', 'MP_Fee_Rebate', 'MPFeeRebate'],
      fields: {
        neftId: ['NEFT ID', 'NEFT_ID', 'Neft Id', 'NEFTID'],
        paymentDate: ['Payment Date', 'Settlement Date'],
        settlementValue: [
          'Settlement Value (Rs.)',
          'Settlement Value(Rs.)',
          'Settlement Value',
        ],
        neftType: ['Neft Type', 'NEFT Type'],
        orderId: ['Order ID', 'Order Id', 'OrderID'],
      },
    },
    {
      kind: 'nonOrderSpf',
      label: 'Non Order SPF',
      collection: 'flipkart_payment_non_order_spf',
      sheetNameAliases: ['Non_Order_SPF', 'Non Order SPF', 'NonOrderSPF'],
      fields: {
        neftId: ['NEFT ID', 'NEFT_ID', 'Neft Id', 'NEFTID'],
        paymentDate: ['Payment Date', 'Settlement Date'],
        settlementValue: [
          'Settlement Value (Rs.)',
          'Settlement Value(Rs.)',
          'Settlement Value',
        ],
        claimId: ['Claim ID', 'Claim Id', 'ClaimID'],
      },
    },
    {
      kind: 'storageRecall',
      label: 'Storage Recall',
      collection: 'flipkart_payment_storage_recall',
      sheetNameAliases: ['Storage_Recall', 'Storage Recall', 'StorageRecall'],
      fields: {
        neftId: ['NEFT ID', 'NEFT_ID', 'Neft Id', 'NEFTID'],
        paymentDate: ['Payment Date', 'Settlement Date'],
        settlementValue: [
          'Settlement Value(Rs.) = SUM(J:K)',
          'Settlement Value (Rs.) = SUM(J:K)',
          'Settlement Value (Rs.)',
          'Settlement Value(Rs.)',
          'Settlement Value',
        ],
        serviceName: ['Service Name', 'Service'],
      },
    },
    {
      kind: 'valueAddedServices',
      label: 'Value Added Services',
      collection: 'flipkart_payment_value_added_services',
      sheetNameAliases: [
        'Value Added Services',
        'Value_Added_Services',
        'ValueAddedServices',
      ],
      fields: {
        neftId: ['NEFT ID', 'NEFT_ID', 'Neft Id', 'NEFTID'],
        paymentDate: ['Payment Date', 'Settlement Date'],
        settlementValue: [
          'Settlement Value(Rs.)',
          'Settlement Value (Rs.)',
          'Settlement Value',
        ],
        serviceName: ['Service Name', 'Service'],
      },
    },
    {
      kind: 'googleAdsServices',
      label: 'Google Ads Services',
      collection: 'flipkart_payment_google_ads_services',
      sheetNameAliases: [
        'Google Ads Services',
        'Google_Ads_Services',
        'GoogleAdsServices',
      ],
      fields: {
        neftId: ['NEFT ID', 'NEFT_ID', 'Neft Id', 'NEFTID'],
        paymentDate: ['Payment Date', 'Settlement Date'],
        settlementValue: [
          'Settlement Value(Rs.)',
          'Settlement Value (Rs.)',
          'Settlement Value',
        ],
        serviceName: ['Service Name', 'Service'],
      },
    },
    {
      kind: 'ads',
      label: 'Ads',
      collection: 'flipkart_payment_ads',
      sheetNameAliases: ['Ads'],
      fields: {
        neftId: ['NEFT ID', 'NEFT_ID', 'Neft Id', 'NEFTID'],
        paymentDate: ['Payment Date', 'Settlement Date'],
        settlementValue: [
          'Settlement Value (Rs.) = SUM(G:K)',
          'Settlement Value(Rs.) = SUM(G:K)',
          'Settlement Value (Rs.)',
          'Settlement Value(Rs.)',
          'Settlement Value',
        ],
        campaignTransactionId: [
          'Campaign / Transaction ID',
          'Campaign/Transaction ID',
          'Campaign Transaction ID',
          'Transaction ID',
        ],
      },
    },
    {
      kind: 'tcsRecovery',
      label: 'TCS Recovery',
      collection: 'flipkart_payment_tcs_recovery',
      sheetNameAliases: ['TCS_Recovery', 'TCS Recovery', 'TCSRecovery'],
      fields: {
        neftId: ['NEFT ID', 'NEFT_ID', 'Neft Id', 'NEFTID'],
        settlementValue: [
          'Settlement Value (Rs.)',
          'Settlement Value(Rs.)',
          'Settlement Value',
        ],
        settlementType: ['Settlement Type'],
        transactionId: ['Transaction ID', 'Transaction Id'],
      },
    },
    {
      kind: 'tds',
      label: 'TDS',
      collection: 'flipkart_payment_tds',
      sheetNameAliases: ['TDS'],
      fields: {
        neftId: ['NEFT ID', 'NEFT_ID', 'Neft Id', 'NEFTID'],
        paymentDate: ['Payment Date', 'Settlement Date'],
        settlementValue: [
          'Settlement Value (Rs.)',
          'Settlement Value(Rs.)',
          'Settlement Value',
        ],
        refId: ['ID', 'Id'],
        claimDate: ['Claim Date'],
      },
    },
  ];

function normalizeSheetNameToken(value: string): string {
  return normalizeHeader(String(value ?? ''))
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function findSecondarySheetDefByKind(
  kind: FlipkartPaymentSecondarySheetKind,
): FlipkartPaymentSecondarySheetDef | undefined {
  return FLIPKART_PAYMENT_SECONDARY_SHEETS.find((def) => def.kind === kind);
}

/**
 * Match workbook sheet tab → secondary kind.
 * Exact match first; then contains for longer aliases.
 * `Ads` / `TDS` stay exact so they don't collide with Google Ads / other names.
 */
export function matchSecondarySheetKind(
  sheetName: string,
): FlipkartPaymentSecondarySheetKind | null {
  const normalized = normalizeSheetNameToken(sheetName);
  if (!normalized) return null;

  // Exact alias match
  for (const def of FLIPKART_PAYMENT_SECONDARY_SHEETS) {
    for (const alias of def.sheetNameAliases) {
      if (normalizeSheetNameToken(alias) === normalized) {
        return def.kind;
      }
    }
  }

  // Contains match for longer names (skip short exact-only kinds: ads, tds)
  // Only when the workbook tab name *contains* a known alias (not the reverse),
  // so "Google Ads" does not match "Google Ads Services".
  const candidates = FLIPKART_PAYMENT_SECONDARY_SHEETS.filter(
    (def) => def.kind !== 'ads' && def.kind !== 'tds',
  );

  let best: { kind: FlipkartPaymentSecondarySheetKind; score: number } | null =
    null;
  for (const def of candidates) {
    for (const alias of def.sheetNameAliases) {
      const aliasNorm = normalizeSheetNameToken(alias);
      if (aliasNorm.length < 8) continue;
      if (normalized.includes(aliasNorm)) {
        const score = aliasNorm.length;
        if (!best || score > best.score) {
          best = { kind: def.kind, score };
        }
      }
    }
  }

  return best?.kind ?? null;
}
