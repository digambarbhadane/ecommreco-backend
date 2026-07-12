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
      slot: 'returnReportFile',
      label: 'Return Report',
      required: false,
      description:
        'Flipkart return report — upload alongside sales or add later for the same month',
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
      label: 'MTR B2C Report',
      required: true,
      description: 'Amazon Merchant Tax Report (B2C)',
    },
    {
      slot: 'mtrB2bFile',
      label: 'MTR B2B Report',
      required: false,
      description: 'Amazon Merchant Tax Report (B2B) — optional if you have B2B orders',
    },
    {
      slot: 'amazonReturnReportFile',
      label: 'Return Report',
      required: false,
      description:
        'Amazon return report — enriches return transactions with Customer Return / RTO classification',
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
      label: 'GSTR Report Packed — Sales',
      required: true,
      description: 'Myntra GSTR packed report (sales / GST amounts)',
    },
    {
      slot: 'salesRevenuePackedB2cFile',
      label: 'Sales Revenue Packed B2C',
      required: true,
      description: 'Invoice number and packing date; primary row driver for import',
    },
    {
      slot: 'gstrReportRtoFile',
      label: 'GSTR Report RTO — RTO',
      required: true,
      description: 'Orders in this file are classified as RTO returns',
    },
    {
      slot: 'gstrReportRtFile',
      label: 'GSTR Report RT — Customer Return',
      required: true,
      description: 'Orders in this file are classified as customer returns',
    },
    {
      slot: 'mDirectOrdersReportFile',
      label: 'MDirect Order Report',
      required: false,
      description: 'Optional SKU enrichment via order_release_id',
    },
    {
      slot: 'mDirectReturnsReportFile',
      label: 'MDirect Return Report',
      required: false,
      description: 'Optional return reasons via order_id',
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
