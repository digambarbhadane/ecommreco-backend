import type { ParsedSheetRow } from '../services/mapping.service';

type UploadedFileInput = { buffer: Buffer; originalname: string };

export type MarketplaceFilesInput = {
  file?: UploadedFileInput;
  mtrB2bFile?: UploadedFileInput;
  mtrB2cFile?: UploadedFileInput;
  tcsSalesFile?: UploadedFileInput;
  tcsSalesReturnFile?: UploadedFileInput;
  orderReportFile?: UploadedFileInput;
  returnInTransitReportFile?: UploadedFileInput;
  returnOutForDeliveryReportFile?: UploadedFileInput;
  returnDeliveryCompleteReportFile?: UploadedFileInput;
  paymentReportFile?: UploadedFileInput;
  returnReportFile?: UploadedFileInput;
  amazonReturnReportFile?: UploadedFileInput;
  gstrReportPackedFile?: UploadedFileInput;
  mDirectOrdersReportFile?: UploadedFileInput;
  salesRevenuePackedB2cFile?: UploadedFileInput;
  gstrReportRtoFile?: UploadedFileInput;
  gstrReportRtFile?: UploadedFileInput;
  mDirectReturnsReportFile?: UploadedFileInput;
};

export type SlotUploadDetail = {
  fileName: string;
  fileSize?: number;
  totalRecords: number;
  salesRecords?: number;
  cashbackRecords?: number;
  includeDbBreakdown: boolean;
};

type ParsedMeeshoBundle = {
  tcsSales: { rows: ParsedSheetRow[] };
  tcsSalesReturn: { rows: ParsedSheetRow[] };
  orderReport: { rows: ParsedSheetRow[] };
  returnInTransit: { rows: ParsedSheetRow[] };
  returnOutForDelivery: { rows: ParsedSheetRow[] };
  returnDeliveryComplete: { rows: ParsedSheetRow[] };
};

type ParsedMyntraBundle = {
  gstrReportPacked: { rows: ParsedSheetRow[] };
  mDirectOrders: { rows: ParsedSheetRow[] };
  salesRevenueB2c: { rows: ParsedSheetRow[] };
  gstrReportRto: { rows: ParsedSheetRow[] };
  gstrReportRt: { rows: ParsedSheetRow[] };
  mDirectReturns: { rows: ParsedSheetRow[] };
};

function fileDetail(
  file: UploadedFileInput | undefined,
  totalRecords: number,
  includeDbBreakdown: boolean,
  extra?: Pick<SlotUploadDetail, 'salesRecords' | 'cashbackRecords'>,
): SlotUploadDetail | null {
  if (!file) return null;
  return {
    fileName: file.originalname,
    fileSize: file.buffer.length,
    totalRecords,
    includeDbBreakdown,
    ...extra,
  };
}

export function buildSlotUploadDetails(input: {
  files: MarketplaceFilesInput;
  uploadedSlots: string[];
  normalizedRows: Array<{ reportType: string }>;
  parsedMeesho?: ParsedMeeshoBundle | null;
  parsedFlipkart?: { salesRows: ParsedSheetRow[]; cashbackRows: ParsedSheetRow[] } | null;
  parsedAmazonB2c?: { rows: ParsedSheetRow[] } | null;
  parsedAmazonB2b?: { rows: ParsedSheetRow[] } | null;
  parsedAmazonReturn?: { rows: ParsedSheetRow[] } | null;
  parsedMyntra?: ParsedMyntraBundle | null;
  paymentSourceRowCount?: number;
}): Record<string, SlotUploadDetail> {
  const details: Record<string, SlotUploadDetail> = {};
  const salesPersisted = input.normalizedRows.filter(
    (row) => row.reportType === 'sales',
  ).length;
  const cashbackPersisted = input.normalizedRows.filter(
    (row) => row.reportType === 'cashback',
  ).length;

  if (input.parsedMeesho) {
    const parsed = input.parsedMeesho;
    const tcs = fileDetail(
      input.files.tcsSalesFile,
      input.normalizedRows.length,
      true,
      { salesRecords: salesPersisted, cashbackRecords: 0 },
    );
    if (tcs) details.tcsSalesFile = tcs;

    const tcsReturn = fileDetail(
      input.files.tcsSalesReturnFile,
      parsed.tcsSalesReturn.rows.length,
      false,
    );
    if (tcsReturn) details.tcsSalesReturnFile = tcsReturn;

    const order = fileDetail(
      input.files.orderReportFile,
      parsed.orderReport.rows.length,
      false,
    );
    if (order) details.orderReportFile = order;

    const inTransit = fileDetail(
      input.files.returnInTransitReportFile,
      parsed.returnInTransit.rows.length,
      false,
    );
    if (inTransit) details.returnInTransitReportFile = inTransit;

    const outForDelivery = fileDetail(
      input.files.returnOutForDeliveryReportFile,
      parsed.returnOutForDelivery.rows.length,
      false,
    );
    if (outForDelivery) details.returnOutForDeliveryReportFile = outForDelivery;

    const deliveryComplete = fileDetail(
      input.files.returnDeliveryCompleteReportFile,
      parsed.returnDeliveryComplete.rows.length,
      false,
    );
    if (deliveryComplete) details.returnDeliveryCompleteReportFile = deliveryComplete;

    const payment = fileDetail(
      input.files.paymentReportFile,
      input.paymentSourceRowCount ?? 0,
      false,
    );
    if (payment) details.paymentReportFile = payment;

    return details;
  }

  if (input.parsedFlipkart) {
    const salesCount = input.parsedFlipkart.salesRows.length;
    const cashbackCount = input.parsedFlipkart.cashbackRows.length;
    const salesFile = fileDetail(input.files.file, salesCount + cashbackCount, true, {
      salesRecords: salesPersisted,
      cashbackRecords: cashbackPersisted,
    });
    if (salesFile) details.file = salesFile;

    const returnReport = fileDetail(input.files.returnReportFile, 0, false);
    if (returnReport) details.returnReportFile = returnReport;

    const payment = fileDetail(
      input.files.paymentReportFile,
      input.paymentSourceRowCount ?? 0,
      false,
    );
    if (payment) details.paymentReportFile = payment;

    return details;
  }

  if (input.parsedAmazonB2c || input.parsedAmazonB2b) {
    const b2cCount = input.parsedAmazonB2c?.rows.length ?? 0;
    const b2bCount = input.parsedAmazonB2b?.rows.length ?? 0;
    const breakdownSlot = input.files.mtrB2cFile ? 'mtrB2cFile' : 'mtrB2bFile';

    const b2c = fileDetail(
      input.files.mtrB2cFile,
      b2cCount,
      breakdownSlot === 'mtrB2cFile',
      breakdownSlot === 'mtrB2cFile'
        ? {
            salesRecords: salesPersisted,
            cashbackRecords: cashbackPersisted,
          }
        : undefined,
    );
    if (b2c) details.mtrB2cFile = b2c;

    const b2b = fileDetail(
      input.files.mtrB2bFile,
      b2bCount,
      breakdownSlot === 'mtrB2bFile',
      breakdownSlot === 'mtrB2bFile'
        ? {
            salesRecords: salesPersisted,
            cashbackRecords: cashbackPersisted,
          }
        : undefined,
    );
    if (b2b) details.mtrB2bFile = b2b;

    const returnCount = input.parsedAmazonReturn?.rows.length ?? 0;
    const returnReport = fileDetail(
      input.files.amazonReturnReportFile,
      returnCount,
      false,
    );
    if (returnReport) details.amazonReturnReportFile = returnReport;

    return details;
  }

  if (input.parsedMyntra) {
    const parsed = input.parsedMyntra;
    const slotMap: Array<[keyof MarketplaceFilesInput, keyof ParsedMyntraBundle]> = [
      ['gstrReportPackedFile', 'gstrReportPacked'],
      ['mDirectOrdersReportFile', 'mDirectOrders'],
      ['salesRevenuePackedB2cFile', 'salesRevenueB2c'],
      ['gstrReportRtoFile', 'gstrReportRto'],
      ['gstrReportRtFile', 'gstrReportRt'],
      ['mDirectReturnsReportFile', 'mDirectReturns'],
    ];

    for (const [fileKey, parsedKey] of slotMap) {
      const file = input.files[fileKey];
      if (!file) continue;
      const rowCount = parsed[parsedKey].rows.length;
      const isPrimary = fileKey === 'gstrReportPackedFile';
      const detail = fileDetail(
        file,
        isPrimary ? input.normalizedRows.length : rowCount,
        isPrimary,
        isPrimary
          ? {
              salesRecords: salesPersisted,
              cashbackRecords: cashbackPersisted,
            }
          : undefined,
      );
      if (detail) details[fileKey] = detail;
    }

    return details;
  }

  for (const slot of input.uploadedSlots) {
    const file = input.files[slot as keyof MarketplaceFilesInput];
    if (!file) continue;
    details[slot] = {
      fileName: file.originalname,
      fileSize: file.buffer.length,
      totalRecords: input.normalizedRows.length,
      salesRecords: salesPersisted,
      cashbackRecords: cashbackPersisted,
      includeDbBreakdown: input.uploadedSlots.length === 1,
    };
  }

  return details;
}

export function buildPaymentOnlySlotDetail(file: UploadedFileInput, matchedOrders: number): SlotUploadDetail {
  return {
    fileName: file.originalname,
    fileSize: file.buffer.length,
    totalRecords: matchedOrders,
    salesRecords: matchedOrders,
    cashbackRecords: 0,
    includeDbBreakdown: false,
  };
}
