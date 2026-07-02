import type { MarketplaceUploadKey } from '../marketplace-upload.routes';
import { MARKETPLACE_COMPLETION_SLOTS } from '../import-slot.constants';

export type ReportDefinition = {
  /** Backend multipart / session slot id */
  slot: string;
  /** User-facing report name */
  label: string;
  required: boolean;
  description?: string;
};

/**
 * Configurable required reports per marketplace — consumed by API + UI (not hardcoded in frontend).
 */
export const MARKETPLACE_REPORT_DEFINITIONS: Record<
  MarketplaceUploadKey,
  ReportDefinition[]
> = {
  flipkart: [
    {
      slot: 'file',
      label: 'Sales Report',
      required: true,
      description: 'Flipkart sales workbook with Sales Report and Cash Back sheets',
    },
    {
      slot: 'paymentReportFile',
      label: 'Payment Report',
      required: false,
      description:
        'Flipkart settlement / payment report — can be added later in a separate import for the same month',
    },
  ],
  amazon: [
    {
      slot: 'mtrB2cFile',
      label: 'Settlement Report',
      required: true,
      description: 'Amazon MTR B2C settlement report',
    },
    {
      slot: 'mtrB2bFile',
      label: 'B2B Settlement Report',
      required: false,
      description: 'Optional Amazon MTR B2B report',
    },
  ],
  meesho: [
    {
      slot: 'tcsSalesFile',
      label: 'TCS Sales Report',
      required: true,
      description: 'Meesho TCS sales report for the selected month',
    },
    {
      slot: 'orderReportFile',
      label: 'Order Report',
      required: true,
      description: 'Meesho order-level report',
    },
    {
      slot: 'tcsSalesReturnFile',
      label: 'TCS Sales Return',
      required: true,
      description: 'Meesho TCS sales return report',
    },
    {
      slot: 'returnInTransitReportFile',
      label: 'Return In-Transit Report',
      required: true,
      description: 'Meesho return in-transit report — Type of Return matched to TCS Sales Return orders',
    },
    {
      slot: 'returnOutForDeliveryReportFile',
      label: 'Return Out for Delivery Report',
      required: true,
      description: 'Meesho return out-for-delivery report — Type of Return matched to TCS Sales Return orders',
    },
    {
      slot: 'returnDeliveryCompleteReportFile',
      label: 'Return Delivery Complete Report',
      required: true,
      description: 'Meesho return delivery-complete report — Type of Return matched to TCS Sales Return orders',
    },
    {
      slot: 'paymentReportFile',
      label: 'Payment Report',
      required: false,
      description:
        'Meesho payment report — can be added later in a separate import for the same month',
    },
  ],
  myntra: [
    {
      slot: 'gstrReportPackedFile',
      label: 'Settlement Report',
      required: true,
      description: 'Myntra GSTR packed report',
    },
    {
      slot: 'salesRevenuePackedB2cFile',
      label: 'Sales Revenue Report',
      required: true,
      description: 'Myntra sales revenue packed B2C',
    },
    {
      slot: 'gstrReportRtoFile',
      label: 'RTO Report',
      required: true,
      description: 'Myntra GSTR RTO report',
    },
    {
      slot: 'gstrReportRtFile',
      label: 'Return Report',
      required: true,
      description: 'Myntra GSTR RT report',
    },
    {
      slot: 'mDirectOrdersReportFile',
      label: 'MDirect Orders Report',
      required: false,
      description: 'Optional SKU enrichment via order release id',
    },
    {
      slot: 'mDirectReturnsReportFile',
      label: 'MDirect Returns Report',
      required: false,
      description: 'Optional return reasons via order id',
    },
  ],
};

export function getRequiredReportSlots(
  marketplace: MarketplaceUploadKey,
): string[] {
  return MARKETPLACE_COMPLETION_SLOTS[marketplace] ?? [];
}

export function getReportDefinitions(
  marketplace: MarketplaceUploadKey,
): ReportDefinition[] {
  return MARKETPLACE_REPORT_DEFINITIONS[marketplace] ?? [];
}

export function isSupportedMarketplaceKey(
  value: string,
): value is MarketplaceUploadKey {
  return ['flipkart', 'amazon', 'meesho', 'myntra'].includes(value);
}
