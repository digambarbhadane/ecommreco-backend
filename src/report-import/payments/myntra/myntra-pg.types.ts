import type { PaymentUploadContext } from '../core/payment-upload-summary.types';

export type MyntraPgReportKind = 'forward' | 'reverse';

export type MyntraPgReverseTopLevelFields = {
  returnId?: string;
  returnDate?: Date | string;
  packingDate?: Date | string;
  deliveryDate?: Date | string;
  invoiceNumber?: string;
  packetId?: string;
  hsnCode?: string;
  ecommercePortalName?: string;
  sellerProductAmount?: number;
  postpaidAmount?: number;
  prepaidAmount?: number;
  mrp?: number;
  totalDiscountAmount?: number;
  taxableAmount?: number;
  igstAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  tcsAmount?: number;
  tdsAmount?: number;
  totalCommission?: number;
  totalLogisticsDeduction?: number;
  customerPaidAmt?: number;
  totalSettlement?: number;
  amountPendingSettlement?: number;
  prepaidPayment?: number;
  postpaidPayment?: number;
  sellerName?: string;
  myntraGstn?: string;
  sellerTier?: string;
  settlementColumns?: Record<string, number>;
};

export type MyntraPgParsedRow = {
  reportKind: MyntraPgReportKind;
  sourceRowNumber: number;
  rowKey: string;
  orderReleaseId: string;
  orderLineId: string;
  sellerOrderId: string;
  skuCode: string;
  sellerGstn: string;
  returnType: string;
  totalActualSettlement: number;
  totalExpectedSettlement: number;
  settlementDate?: Date | string;
  rowData: Record<string, unknown>;
} & Partial<MyntraPgReverseTopLevelFields>;

export type MyntraPgInsertPayload = MyntraPgParsedRow &
  PaymentUploadContext & {
    uploadId: string;
    uploadedFileName: string;
    uploadedAt: Date;
  };

export type MyntraPgParseResult = {
  rows: MyntraPgParsedRow[];
  headers: string[];
  fieldKeys: string[];
  totalRawRows: number;
  blankRows: number;
  invalidRowCount: number;
  validationErrors: string[];
  sheetName: string;
};
