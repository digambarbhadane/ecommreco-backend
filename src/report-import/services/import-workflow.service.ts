import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import type { MarketplaceUploadKey } from '../marketplace-upload.routes';
import {
  getReportDefinitions,
  getRequiredReportSlots,
  isSupportedMarketplaceKey,
} from '../config/marketplace-report-config';
import {
  inferUploadedSlotsFromFileHash,
  isMonthComplete,
  PRIMARY_IMPORT_SLOT,
} from '../import-slot.constants';
import { ImportUpload } from '../schemas/import-upload.schema';
import { ImportRow } from '../schemas/import-row.schema';
import { ImportRowError } from '../schemas/import-row-error.schema';
import {
  ImportSlotRecord,
} from '../schemas/import-slot-record.schema';
import { ValidationService } from './validation.service';
import type { SlotUploadDetail } from '../utils/slot-upload-details';
import {
  inferMarketplaceKeyFromFileHash,
  resolveSlotSummary,
} from '../utils/slot-summary-resolver';
import {
  buildMeeshoWorkflowMonthSummaryPipeline,
  buildWorkflowMonthSummaryPipeline,
  PAYMENT_AMOUNT_FIELDS,
  type MeeshoMonthTotalsRow,
  type WorkflowMonthTotalsRow,
} from '../utils/workflow-month-summary.aggregation';
import { ReconAdjustment } from '../schemas/recon-adjustment.schema';

const MEESHO_PAYMENT_FIELDS = [
  'liveOrderStatus',
  'transactionId',
  'paymentDate',
  'finalSettlementAmount',
  'priceType',
  'totalSaleAmountInclShippingGst',
  'totalSaleReturnAmountInclShippingGst',
  'fixedFeeInclGst',
  'warehousingFeeInclGst',
  'returnPremiumInclGst',
  'returnPremiumInclGstOfReturn',
  'meeshoCommissionPercentage',
  'meeshoCommissionInclGst',
  'meeshoGoldPlatformFeeInclGst',
  'meeshoMallPlatformFeeInclGst',
  'returnShippingChargeInclGst',
  'gstCompensationPrpShipping',
  'shippingChargeInclGst',
  'otherSupportServiceChargesExclGst',
  'waiversExclGst',
  'netOtherSupportServiceChargesExclGst',
  'gstOnNetOtherSupportServiceCharges',
  'paymentTcs',
  'tdsRatePercent',
  'tds',
  'compensation',
  'claims',
  'recovery',
  'compensationReason',
  'claimsReason',
  'recoveryReason',
] as const;

const FLIPKART_PAYMENT_FIELDS = [
  'finalSettlementAmount',
  'transactionId',
  'paymentDate',
] as const;

const PAYMENT_FIELDS_BY_MARKETPLACE: Record<
  MarketplaceUploadKey,
  readonly string[]
> = {
  flipkart: FLIPKART_PAYMENT_FIELDS,
  meesho: MEESHO_PAYMENT_FIELDS,
  amazon: [],
  myntra: [],
};

type SlotUploadInfo = {
  slot: string;
  label: string;
  required: boolean;
  status: 'uploaded' | 'pending' | 'processing' | 'failed';
  uploadId?: string;
  fileName?: string;
  fileSize?: number;
  uploadedBy?: string;
  uploadedAt?: string;
  importBatchId?: string;
};

@Injectable()
export class ImportWorkflowService {
  constructor(
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUpload>,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRow>,
    @InjectModel(ImportRowError.name)
    private readonly rowErrorModel: Model<ImportRowError>,
    @InjectModel(ImportSlotRecord.name)
    private readonly slotRecordModel: Model<ImportSlotRecord>,
    @InjectModel(ReconAdjustment.name)
    private readonly adjustmentModel: Model<ReconAdjustment>,
    private readonly validationService: ValidationService,
  ) {}

  getRequiredReports(marketplace: string) {
    if (!isSupportedMarketplaceKey(marketplace)) {
      throw new BadRequestException(
        'marketplace must be flipkart, amazon, meesho, or myntra',
      );
    }
    const definitions = getReportDefinitions(marketplace);
    const requiredSlots = getRequiredReportSlots(marketplace);
    return {
      success: true,
      data: {
        marketplace,
        reports: definitions,
        requiredSlots,
      },
    };
  }

  async recordSlotUploads(params: {
    sellerId: string;
    gstId: string;
    marketplaceId: string;
    reportMonth: string;
    uploadId: string;
    uploadedSlots: string[];
    fileName: string;
    fileSize?: number;
    uploadedBy?: string;
    importBatchId?: string;
    status?: ImportSlotRecord['status'];
    slotDetails?: Record<string, SlotUploadDetail>;
  }) {
    const {
      sellerId,
      gstId,
      marketplaceId,
      reportMonth,
      uploadId,
      uploadedSlots,
      fileName,
      fileSize,
      uploadedBy,
      importBatchId,
      status = 'completed',
      slotDetails,
    } = params;

    if (!reportMonth || !uploadedSlots.length) return;

    for (const slot of uploadedSlots) {
      const detail = slotDetails?.[slot];
      const $set: Record<string, unknown> = {
        sellerId,
        gstId,
        marketplaceId,
        reportMonth,
        slot,
        uploadId,
        fileName: detail?.fileName ?? fileName,
        fileSize: detail?.fileSize ?? fileSize,
        uploadedBy,
        importBatchId: importBatchId ?? uploadId,
        status,
        includeDbBreakdown: detail?.includeDbBreakdown ?? false,
      };
      if (detail?.totalRecords != null) {
        $set.totalRecords = detail.totalRecords;
      }
      if (detail?.salesRecords != null) {
        $set.salesRecords = detail.salesRecords;
      }
      if (detail?.cashbackRecords != null) {
        $set.cashbackRecords = detail.cashbackRecords;
      }

      await this.slotRecordModel.findOneAndUpdate(
        {
          sellerId,
          gstId,
          marketplaceId,
          reportMonth,
          slot,
          status: { $in: ['completed', 'processing', 'failed'] },
        },
        { $set },
        { upsert: true, new: true },
      );
    }
  }

  async hasCompletedSlot(params: {
    sellerId: string;
    gstId: string;
    marketplaceId: string;
    reportMonth: string;
    slot: string;
  }): Promise<boolean> {
    const sellerId = String(params.sellerId ?? '').trim();
    const gstId = String(params.gstId ?? '').trim();
    const marketplaceId = String(params.marketplaceId ?? '').trim();
    const reportMonth = String(params.reportMonth ?? '').trim();
    const slot = String(params.slot ?? '').trim();
    if (!sellerId || !gstId || !marketplaceId || !reportMonth || !slot) {
      return false;
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);
    const record = await this.slotRecordModel
      .findOne({
        sellerId: { $in: sellerAliases },
        gstId,
        marketplaceId,
        reportMonth,
        slot,
        status: 'completed',
      })
      .lean()
      .exec();
    return Boolean(record);
  }

  async getWorkflowStatus(query: {
    sellerId: string;
    gstId: string;
    reportMonth: string;
    marketplaceId?: string;
    marketplace?: MarketplaceUploadKey;
    uploadedByName?: string;
    marketplaces?: Array<{ marketplaceId: string; marketplaceKey: MarketplaceUploadKey }>;
  }) {
    const sellerId = String(query.sellerId ?? '').trim();
    const gstId = String(query.gstId ?? '').trim();
    const reportMonth = String(query.reportMonth ?? '').trim();

    if (!sellerId || !gstId || !reportMonth) {
      throw new BadRequestException('sellerId, gstId, and reportMonth are required');
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);

    const slotRecords = await this.slotRecordModel
      .find({
        sellerId: { $in: sellerAliases },
        gstId,
        reportMonth,
        status: { $in: ['completed', 'processing', 'failed'] },
        ...(query.marketplaceId ? { marketplaceId: query.marketplaceId } : {}),
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    await this.backfillSlotRecordsFromUploads({
      sellerAliases,
      gstId,
      reportMonth,
      marketplaceId: query.marketplaceId,
    });

    const refreshedRecords = await this.slotRecordModel
      .find({
        sellerId: { $in: sellerAliases },
        gstId,
        reportMonth,
        status: { $in: ['completed', 'processing', 'failed'] },
        ...(query.marketplaceId ? { marketplaceId: query.marketplaceId } : {}),
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    if (query.marketplaceId && query.marketplace) {
      const detail = this.buildMarketplaceStatus(
        query.marketplace,
        query.marketplaceId,
        refreshedRecords.filter((r) => r.marketplaceId === query.marketplaceId),
      );
      return { success: true, data: { reportMonth, marketplace: detail } };
    }

    if (query.marketplaces?.length) {
      await this.backfillSlotRecordsFromUploads({
        sellerAliases,
        gstId,
        reportMonth,
      });

      const allRecords = await this.slotRecordModel
        .find({
          sellerId: { $in: sellerAliases },
          gstId,
          reportMonth,
          status: { $in: ['completed', 'processing', 'failed'] },
        })
        .sort({ updatedAt: -1 })
        .lean()
        .exec();

      const marketplaces = query.marketplaces.map(({ marketplaceId, marketplaceKey }) => {
        const records = allRecords.filter((r) => r.marketplaceId === marketplaceId);
        return this.buildMarketplaceStatus(marketplaceKey, marketplaceId, records);
      });

      const summary = this.buildMonthSummary(marketplaces);
      return { success: true, data: { reportMonth, summary, marketplaces } };
    }

    const byMarketplace = new Map<string, typeof refreshedRecords>();
    for (const record of refreshedRecords) {
      const key = record.marketplaceId;
      if (!byMarketplace.has(key)) byMarketplace.set(key, []);
      byMarketplace.get(key)!.push(record);
    }

    const marketplaces = [...byMarketplace.entries()].map(([marketplaceId, records]) => {
      const mpKey = this.inferMarketplaceKeyFromRecords(records) ?? 'flipkart';
      return this.buildMarketplaceStatus(mpKey, marketplaceId, records);
    });

    const summary = this.buildMonthSummary(marketplaces);

    return {
      success: true,
      data: {
        reportMonth,
        summary,
        marketplaces,
      },
    };
  }

  async getImportHistory(query: {
    sellerId: string;
    gstId: string;
    reportMonth?: string;
    marketplaceId?: string;
  }) {
    const sellerId = String(query.sellerId ?? '').trim();
    const gstId = String(query.gstId ?? '').trim();
    if (!sellerId || !gstId) {
      throw new BadRequestException('sellerId and gstId are required');
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);

    const filter: Record<string, unknown> = {
      sellerId: { $in: sellerAliases },
      gstId,
      status: { $in: ['completed', 'processing', 'failed', 'reuploaded'] },
    };
    if (query.reportMonth) filter.reportMonth = query.reportMonth;
    if (query.marketplaceId) filter.marketplaceId = query.marketplaceId;

    const records = await this.slotRecordModel
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean()
      .exec();

    return {
      success: true,
      data: records.map((record) => ({
        id: String(record._id),
        slot: record.slot,
        marketplaceId: record.marketplaceId,
        reportMonth: record.reportMonth,
        fileName: record.fileName,
        fileSize: record.fileSize,
        uploadedBy: record.uploadedBy,
        uploadedAt: (record as { updatedAt?: Date }).updatedAt
          ? new Date((record as { updatedAt?: Date }).updatedAt!).toISOString()
          : undefined,
        status: record.status,
        uploadId: record.uploadId,
        importBatchId: record.importBatchId,
      })),
    };
  }

  async getReportUploadSummary(query: {
    sellerId: string;
    uploadId: string;
    slot?: string;
    marketplace?: MarketplaceUploadKey;
  }) {
    const sellerId = String(query.sellerId ?? '').trim();
    const uploadId = String(query.uploadId ?? '').trim();
    const requestedSlot = String(query.slot ?? '').trim();
    if (!sellerId || !uploadId) {
      throw new BadRequestException('sellerId and uploadId are required');
    }
    if (!requestedSlot) {
      throw new BadRequestException('slot is required for report summary');
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);

    const upload = await this.uploadModel.findById(uploadId).lean().exec();
    if (
      !upload ||
      !sellerAliases.includes(String(upload.sellerId ?? '').trim())
    ) {
      throw new NotFoundException('Import upload not found');
    }

    const slotRecord = await this.slotRecordModel
      .findOne({
        sellerId: { $in: sellerAliases },
        uploadId,
        slot: requestedSlot,
        status: { $in: ['completed', 'processing', 'failed'] },
      })
      .lean()
      .exec();

    const uploadedSlots = Array.isArray(upload.uploadedSlots)
      ? upload.uploadedSlots
      : inferUploadedSlotsFromFileHash(String(upload.fileHash ?? ''));
    const slot = requestedSlot;
    const isPaymentOnly =
      slot === 'paymentReportFile' && this.isPaymentOnlyUpload(upload);

    const marketplaceKey =
      query.marketplace && isSupportedMarketplaceKey(query.marketplace)
        ? query.marketplace
        : inferMarketplaceKeyFromFileHash(String(upload.fileHash ?? ''));

    let reportLabel = slot;
    if (marketplaceKey) {
      const definition = getReportDefinitions(marketplaceKey).find(
        (item) => item.slot === slot,
      );
      if (definition) {
        reportLabel = definition.label;
      }
    }

    const resolved = resolveSlotSummary({
      slot,
      marketplace: marketplaceKey,
      uploadedSlots,
      isPaymentOnly,
      upload,
      slotRecord,
    });

    const {
      fileName,
      fileSize,
      totalRecords,
      salesRecords,
      cashbackRecords,
      includeDbBreakdown,
      hasStoredStats,
      hasResolvedStats,
    } = resolved;

    if (!hasStoredStats && hasResolvedStats && slotRecord?._id) {
      void this.slotRecordModel
        .updateOne(
          { _id: slotRecord._id },
          {
            $set: {
              fileName,
              ...(fileSize != null ? { fileSize } : {}),
              totalRecords,
              salesRecords,
              cashbackRecords,
              includeDbBreakdown,
            },
          },
        )
        .exec();
    } else if (
      hasStoredStats &&
      slotRecord?._id &&
      slotRecord.fileName?.includes(' + ') &&
      fileName &&
      !fileName.includes(' + ')
    ) {
      void this.slotRecordModel
        .updateOne({ _id: slotRecord._id }, { $set: { fileName } })
        .exec();
    }

    const rowErrorCount = includeDbBreakdown
      ? await this.rowErrorModel.countDocuments({ uploadId }).exec()
      : 0;

    let byDocumentType: Array<{ documentType: string; count: number }> = [];
    let byReportType: Array<{ reportType: string; count: number }> = [];

    if (includeDbBreakdown && !isPaymentOnly) {
      const [docAgg, typeAgg] = await Promise.all([
        this.rowModel
          .aggregate<{ _id: string; count: number }>([
            { $match: { uploadId } },
            { $group: { _id: '$documentType', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 25 },
          ])
          .exec(),
        this.rowModel
          .aggregate<{ _id: string; count: number }>([
            { $match: { uploadId } },
            { $group: { _id: '$reportType', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .exec(),
      ]);

      byDocumentType = docAgg.map((item) => ({
        documentType: String(item._id ?? 'Unknown'),
        count: item.count,
      }));
      byReportType = typeAgg.map((item) => ({
        reportType: String(item._id ?? 'unknown'),
        count: item.count,
      }));
    }

    const uploadDoc = upload as ImportUpload & { createdAt?: Date; updatedAt?: Date };
    const slotRecordDoc = slotRecord as
      | (typeof slotRecord & { updatedAt?: Date })
      | null;
    const isBundledPayment =
      slot === 'paymentReportFile' &&
      uploadedSlots.includes('paymentReportFile') &&
      !isPaymentOnly;
    const isEnrichmentOnly =
      !includeDbBreakdown && !isPaymentOnly && !isBundledPayment;
    const legacyImport = isEnrichmentOnly && !hasResolvedStats;

    return {
      success: true,
      data: {
        slot,
        reportLabel,
        fileName,
        fileSize,
        status: upload.status,
        reportMonth: upload.reportMonth,
        uploadedAt: slotRecordDoc?.updatedAt
          ? new Date(slotRecordDoc.updatedAt).toISOString()
          : uploadDoc.updatedAt
            ? new Date(uploadDoc.updatedAt).toISOString()
            : uploadDoc.createdAt
              ? new Date(uploadDoc.createdAt).toISOString()
              : undefined,
        totalRecords,
        salesRecords,
        cashbackRecords,
        rowErrorCount,
        minInvoiceDate: includeDbBreakdown ? upload.minInvoiceDate : undefined,
        maxInvoiceDate: includeDbBreakdown ? upload.maxInvoiceDate : undefined,
        isPaymentOnly: isPaymentOnly || isBundledPayment,
        isEnrichmentOnly,
        legacyImport,
        summaryMessage: legacyImport
          ? 'Row count for this enrichment file was not stored for this import. Re-upload this report to refresh the count.'
          : isPaymentOnly || isBundledPayment
            ? 'Payment data was applied to existing sales orders for this month.'
            : isEnrichmentOnly
              ? 'This report was used to enrich sales orders for the month. Row counts below reflect rows in this file.'
              : undefined,
        byDocumentType,
        byReportType,
        uploadedSlots: [slot],
      },
    };
  }

  async getWorkflowMonthSummary(query: {
    sellerId: string;
    gstId: string;
    marketplaceId: string;
    marketplace: MarketplaceUploadKey;
    reportMonth: string;
  }) {
    const sellerId = String(query.sellerId ?? '').trim();
    const gstId = String(query.gstId ?? '').trim();
    const marketplaceId = String(query.marketplaceId ?? '').trim();
    const reportMonth = String(query.reportMonth ?? '').trim();
    const marketplace = query.marketplace;

    if (!sellerId || !gstId || !marketplaceId || !reportMonth) {
      throw new BadRequestException(
        'sellerId, gstId, marketplaceId, and reportMonth are required',
      );
    }
    if (!isSupportedMarketplaceKey(marketplace)) {
      throw new BadRequestException(
        'marketplace must be flipkart, amazon, meesho, or myntra',
      );
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);

    const slotRecords = await this.slotRecordModel
      .find({
        sellerId: { $in: sellerAliases },
        gstId,
        marketplaceId,
        reportMonth,
        status: { $in: ['completed', 'processing', 'failed'] },
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    const uploadedReports = slotRecords.filter((r) => r.status === 'completed');
    const requiredSlots = getRequiredReportSlots(marketplace);
    const uploadedRequired = requiredSlots.filter((slot) =>
      uploadedReports.some((r) => r.slot === slot),
    ).length;

    const primaryUploadId = this.resolvePrimaryUploadId(marketplace, slotRecords);
    const paymentUploaded = uploadedReports.some(
      (r) => r.slot === 'paymentReportFile',
    );

    let totals: WorkflowMonthTotalsRow | MeeshoMonthTotalsRow = {};
    let byDocumentType: Array<{
      documentType: string;
      count: number;
      invoiceAmount: number;
      taxableAmount: number;
    }> = [];
    let byReportType: Array<{
      reportType: string;
      count: number;
      invoiceAmount: number;
      taxableAmount: number;
    }> = [];
    let rowErrorCount = 0;
    let hasImportedData = false;

    if (primaryUploadId) {
      const rowFilter = {
        uploadId: primaryUploadId,
        sellerId: { $in: sellerAliases },
        marketplace: marketplaceId,
      };

      const summaryPipeline =
        marketplace === 'meesho'
          ? buildMeeshoWorkflowMonthSummaryPipeline(rowFilter)
          : buildWorkflowMonthSummaryPipeline(rowFilter);

      const [agg, errors] = await Promise.all([
        this.rowModel
          .aggregate<{
            totals: Array<WorkflowMonthTotalsRow | MeeshoMonthTotalsRow>;
            byDocumentType: Array<{
              _id: string;
              count: number;
              invoiceAmount: number;
              taxableAmount: number;
            }>;
            byReportType: Array<{
              _id: string;
              count: number;
              invoiceAmount: number;
              taxableAmount: number;
            }>;
          }>(summaryPipeline)
          .exec(),
        this.rowErrorModel.countDocuments({ uploadId: primaryUploadId }).exec(),
      ]);

      const facet = agg[0] ?? {
        totals: [],
        byDocumentType: [],
        byReportType: [],
      };
      totals = facet.totals[0] ?? {};
      rowErrorCount = errors;
      hasImportedData = Number(totals.totalRows ?? 0) > 0;

      byDocumentType = facet.byDocumentType.map((item) => ({
        documentType: String(item._id ?? 'Unknown'),
        count: item.count,
        invoiceAmount: Number(item.invoiceAmount ?? 0),
        taxableAmount: Number(item.taxableAmount ?? 0),
      }));
      byReportType = facet.byReportType.map((item) => ({
        reportType: String(item._id ?? 'unknown'),
        count: item.count,
        invoiceAmount: Number(item.invoiceAmount ?? 0),
        taxableAmount: Number(item.taxableAmount ?? 0),
      }));
    }

    const totalTax =
      Number(totals.totalIgst ?? 0) +
      Number(totals.totalCgst ?? 0) +
      Number(totals.totalSgst ?? 0);

    const paymentAmounts = PAYMENT_AMOUNT_FIELDS.map(({ key, label }) => ({
      key,
      label,
      amount: Number(totals[key] ?? 0),
    })).filter((item) => item.amount !== 0);

    const hasPaymentData =
      paymentUploaded || Number(totals.ordersWithSettlement ?? 0) > 0;

    const latestUploadAt = uploadedReports.reduce<string | undefined>(
      (latest, record) => {
        const updatedAt = (record as { updatedAt?: Date }).updatedAt;
        if (!updatedAt) return latest;
        const iso = new Date(updatedAt).toISOString();
        return !latest || iso > latest ? iso : latest;
      },
      undefined,
    );

    const adjustments = await this.adjustmentModel
      .find({
        sellerId: { $in: sellerAliases },
        gstId,
        marketplace: marketplaceId,
        sourceReportMonth: reportMonth,
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
      .exec();
    const groupedAlerts = new Map<string, number>();
    for (const item of adjustments) {
      groupedAlerts.set(
        item.affectedReportMonth,
        (groupedAlerts.get(item.affectedReportMonth) ?? 0) + 1,
      );
    }
    const alerts = [...groupedAlerts.entries()].map(([month, count]) => ({
      affectedMonth: month,
      impactedTransactions: count,
      message: `${count} ${month} order(s) received updates from this upload cycle.`,
    }));

    const meeshoTotals = marketplace === 'meesho' ? (totals as MeeshoMonthTotalsRow) : null;
    const meeshoReturnTotalRows = Number(meeshoTotals?.meeshoTcsReturnRows ?? 0);
    const meeshoReturnTotalPcs = Number(meeshoTotals?.meeshoTcsReturnPcs ?? 0);
    const meeshoReturnTotalTaxable = Number(meeshoTotals?.meeshoTcsReturnTaxable ?? 0);
    const meeshoReturnTotalIgst = Number(meeshoTotals?.meeshoTcsReturnIgst ?? 0);
    const meeshoReturnTotalCgst = Number(meeshoTotals?.meeshoTcsReturnCgst ?? 0);
    const meeshoReturnTotalSgst = Number(meeshoTotals?.meeshoTcsReturnSgst ?? 0);
    const meeshoReturnTotalInvoice = Number(meeshoTotals?.meeshoTcsReturnInvoice ?? 0);

    const salesReturnTable =
      marketplace === 'meesho' && meeshoTotals
        ? {
            sales: {
              totalRows: Number(meeshoTotals.meeshoGrossSalesRows ?? 0),
              pcs: Number(meeshoTotals.meeshoGrossSalesPcs ?? 0),
              taxableValue: Number(meeshoTotals.meeshoGrossSalesTaxable ?? 0),
              igst: Number(meeshoTotals.meeshoGrossSalesIgst ?? 0),
              cgst: Number(meeshoTotals.meeshoGrossSalesCgst ?? 0),
              sgst: Number(meeshoTotals.meeshoGrossSalesSgst ?? 0),
              invoiceAmount: Number(meeshoTotals.meeshoGrossSalesInvoice ?? 0),
            },
            returns: {
              totalRows: meeshoReturnTotalRows,
              pcs: meeshoReturnTotalPcs,
              taxableValue: meeshoReturnTotalTaxable,
              igst: meeshoReturnTotalIgst,
              cgst: meeshoReturnTotalCgst,
              sgst: meeshoReturnTotalSgst,
              invoiceAmount: meeshoReturnTotalInvoice,
            },
            meeshoReturns: {
              cancellation: {
                totalRows: Number(meeshoTotals.meeshoReturnCancellationRows ?? 0),
                pcs: Number(meeshoTotals.meeshoReturnCancellationPcs ?? 0),
                taxableValue: Number(meeshoTotals.meeshoReturnCancellationTaxable ?? 0),
                igst: Number(meeshoTotals.meeshoReturnCancellationIgst ?? 0),
                cgst: Number(meeshoTotals.meeshoReturnCancellationCgst ?? 0),
                sgst: Number(meeshoTotals.meeshoReturnCancellationSgst ?? 0),
                invoiceAmount: Number(meeshoTotals.meeshoReturnCancellationInvoice ?? 0),
              },
              rto: {
                totalRows: Number(meeshoTotals.meeshoReturnRtoRows ?? 0),
                pcs: Number(meeshoTotals.meeshoReturnRtoPcs ?? 0),
                taxableValue: Number(meeshoTotals.meeshoReturnRtoTaxable ?? 0),
                igst: Number(meeshoTotals.meeshoReturnRtoIgst ?? 0),
                cgst: Number(meeshoTotals.meeshoReturnRtoCgst ?? 0),
                sgst: Number(meeshoTotals.meeshoReturnRtoSgst ?? 0),
                invoiceAmount: Number(meeshoTotals.meeshoReturnRtoInvoice ?? 0),
              },
              customerReturn: {
                totalRows: Number(meeshoTotals.meeshoReturnCustomerRows ?? 0),
                pcs: Number(meeshoTotals.meeshoReturnCustomerPcs ?? 0),
                taxableValue: Number(meeshoTotals.meeshoReturnCustomerTaxable ?? 0),
                igst: Number(meeshoTotals.meeshoReturnCustomerIgst ?? 0),
                cgst: Number(meeshoTotals.meeshoReturnCustomerCgst ?? 0),
                sgst: Number(meeshoTotals.meeshoReturnCustomerSgst ?? 0),
                invoiceAmount: Number(meeshoTotals.meeshoReturnCustomerInvoice ?? 0),
              },
              na: {
                totalRows: Number(meeshoTotals.meeshoReturnNaRows ?? 0),
                pcs: Number(meeshoTotals.meeshoReturnNaPcs ?? 0),
                taxableValue: Number(meeshoTotals.meeshoReturnNaTaxable ?? 0),
                igst: Number(meeshoTotals.meeshoReturnNaIgst ?? 0),
                cgst: Number(meeshoTotals.meeshoReturnNaCgst ?? 0),
                sgst: Number(meeshoTotals.meeshoReturnNaSgst ?? 0),
                invoiceAmount: Number(meeshoTotals.meeshoReturnNaInvoice ?? 0),
              },
            },
          }
        : {
            sales: {
              totalRows: Number(totals.salesDocRows ?? 0),
              pcs: Number(totals.salesPcs ?? 0),
              taxableValue: Number(totals.salesTaxableAmount ?? 0),
              igst: Number(totals.salesIgst ?? 0),
              cgst: Number(totals.salesCgst ?? 0),
              sgst: Number(totals.salesSgst ?? 0),
              invoiceAmount: Number(totals.salesInvoiceAmount ?? 0),
            },
            returns: {
              totalRows: Number(totals.returnsDocRows ?? 0),
              pcs: Number(totals.returnsPcs ?? 0),
              taxableValue: Number(totals.returnsTaxableAmount ?? 0),
              igst: Number(totals.returnsIgst ?? 0),
              cgst: Number(totals.returnsCgst ?? 0),
              sgst: Number(totals.returnsSgst ?? 0),
              invoiceAmount: Number(totals.returnsInvoiceAmount ?? 0),
            },
          };

    return {
      success: true,
      data: {
        reportMonth,
        marketplaceId,
        marketplaceKey: marketplace,
        reportsUploaded: uploadedReports.length,
        reportsRequired: requiredSlots.length,
        uploadedRequired,
        isComplete: isMonthComplete(
          marketplace,
          new Set(uploadedReports.map((r) => r.slot)),
        ),
        latestUploadAt,
        hasImportedData,
        hasPaymentData,
        overview: {
          totalRows: Number(totals.totalRows ?? 0),
          salesRows: Number(totals.salesRows ?? 0),
          cashbackRows: Number(totals.cashbackRows ?? 0),
          salesDocRows: Number(totals.salesDocRows ?? 0),
          returnsDocRows: Number(totals.returnsDocRows ?? 0),
          cancelledDocRows: Number(totals.cancelledDocRows ?? 0),
          rowErrorCount,
          minInvoiceDate: totals.minInvoiceDate,
          maxInvoiceDate: totals.maxInvoiceDate,
          ordersWithSettlement: Number(totals.ordersWithSettlement ?? 0),
        },
        amounts: {
          totalInvoiceAmount: Number(totals.totalInvoiceAmount ?? 0),
          salesInvoiceAmount: Number(totals.salesInvoiceAmount ?? 0),
          returnsInvoiceAmount: Number(totals.returnsInvoiceAmount ?? 0),
          cancelledInvoiceAmount: Number(totals.cancelledInvoiceAmount ?? 0),
          totalTaxableAmount: Number(totals.totalTaxableAmount ?? 0),
          totalIgst: Number(totals.totalIgst ?? 0),
          totalCgst: Number(totals.totalCgst ?? 0),
          totalSgst: Number(totals.totalSgst ?? 0),
          totalTax,
          finalSettlementAmount: Number(totals.finalSettlementAmount ?? 0),
        },
        gstBreakdown: {
          cgstTotal: Number(totals.totalCgst ?? 0),
          sgstTotal: Number(totals.totalSgst ?? 0),
          igstTotal: Number(totals.totalIgst ?? 0),
          intraStateSales: Number(totals.intraStateSalesRows ?? 0),
          interStateSales: Number(totals.interStateSalesRows ?? 0),
          taxableValueIntraState: Number(totals.intraStateTaxableAmount ?? 0),
          taxableValueInterState: Number(totals.interStateTaxableAmount ?? 0),
        },
        salesReturnTable,
        paymentAmounts,
        byDocumentType,
        byReportType,
        alerts,
      },
    };
  }

  private resolvePrimaryUploadId(
    marketplace: MarketplaceUploadKey,
    slotRecords: Array<{ slot: string; uploadId: string; status: string }>,
  ): string | null {
    const completed = slotRecords.filter((r) => r.status === 'completed');
    const primarySlot = PRIMARY_IMPORT_SLOT[marketplace];
    const primary = completed.find((r) => r.slot === primarySlot);
    if (primary?.uploadId) return primary.uploadId;

    if (marketplace === 'amazon') {
      const b2b = completed.find((r) => r.slot === 'mtrB2bFile');
      if (b2b?.uploadId) return b2b.uploadId;
    }

    return null;
  }

  private isPaymentOnlyUpload(upload: {
    fileHash?: string;
    uploadedSlots?: string[];
  }): boolean {
    const hash = String(upload.fileHash ?? '');
    if (
      hash.startsWith('meesho-payment|') ||
      hash.startsWith('flipkart-payment|')
    ) {
      return true;
    }
    const slots = Array.isArray(upload.uploadedSlots) ? upload.uploadedSlots : [];
    return slots.length === 1 && slots[0] === 'paymentReportFile';
  }

  async deleteSlotData(query: {
    sellerId: string;
    gstId: string;
    marketplaceId: string;
    marketplace: MarketplaceUploadKey;
    reportMonth: string;
    slot: string;
  }) {
    const {
      sellerId,
      gstId,
      marketplaceId,
      marketplace,
      reportMonth,
      slot,
    } = query;

    const definitions = getReportDefinitions(marketplace);
    if (!definitions.some((d) => d.slot === slot)) {
      throw new BadRequestException(`Unknown report slot "${slot}" for ${marketplace}`);
    }

    const sellerAliases =
      await this.validationService.resolveSellerIdAliases(sellerId);

    const slotRecord = await this.slotRecordModel
      .findOne({
        sellerId: { $in: sellerAliases },
        gstId,
        marketplaceId,
        reportMonth,
        slot,
        status: { $in: ['completed', 'processing', 'failed'] },
      })
      .lean()
      .exec();

    if (!slotRecord) {
      return {
        success: true,
        message: 'No previous uploaded data found for this slot',
      };
    }

    const upload = await this.uploadModel.findById(slotRecord.uploadId).lean().exec();
    if (!upload) {
      await this.slotRecordModel.updateOne(
        { _id: slotRecord._id },
        { $set: { status: 'deleted' } },
      );
      return { success: true, message: 'Report tracking cleared' };
    }

    const uploadSlots = Array.isArray(upload.uploadedSlots)
      ? upload.uploadedSlots
      : inferUploadedSlotsFromFileHash(String(upload.fileHash ?? ''));

    if (slot === 'paymentReportFile') {
      const salesUploads = await this.uploadModel
        .find({
          sellerId: { $in: sellerAliases },
          gstId,
          marketplace: marketplaceId,
          reportMonth,
          status: 'completed',
        })
        .select('_id uploadedSlots fileHash')
        .lean()
        .exec();

      const salesUploadIds = salesUploads
        .filter((item) => {
          const slots = Array.isArray(item.uploadedSlots) && item.uploadedSlots.length
            ? item.uploadedSlots
            : inferUploadedSlotsFromFileHash(String(item.fileHash ?? ''));
          return slots.some((s) => s !== 'paymentReportFile');
        })
        .map((item) => String(item._id));

      if (salesUploadIds.length) {
        const unset: Record<string, 1> = {};
        const paymentFields =
          PAYMENT_FIELDS_BY_MARKETPLACE[marketplace] ?? MEESHO_PAYMENT_FIELDS;
        for (const field of paymentFields) {
          unset[field] = 1;
        }
        await this.rowModel
          .updateMany({ uploadId: { $in: salesUploadIds } }, { $unset: unset })
          .exec();
      }

      if (upload) {
        await this.uploadModel.findByIdAndUpdate(upload._id, {
          $set: {
            status: 'failed',
            lifecycleStatus: 'deleted',
            errorMessage: 'Payment report deleted for re-upload',
          },
        });
      }
    } else if (uploadSlots.length === 1 && uploadSlots[0] === slot) {
      await this.rowModel.deleteMany({ uploadId: String(upload._id) }).exec();
      await this.rowErrorModel.deleteMany({ uploadId: String(upload._id) }).exec();
      await this.uploadModel.findByIdAndUpdate(upload._id, {
        $set: {
          status: 'failed',
          lifecycleStatus: 'deleted',
          errorMessage: 'Deleted for re-upload',
        },
      });
    } else {
      // Legacy/import-all uploads can carry multiple slots in a single upload id.
      // For re-upload, clear that whole upload atomically so each slot can be uploaded again.
      await this.rowModel.deleteMany({ uploadId: String(upload._id) }).exec();
      await this.rowErrorModel.deleteMany({ uploadId: String(upload._id) }).exec();
      await this.uploadModel.findByIdAndUpdate(upload._id, {
        $set: {
          status: 'failed',
          lifecycleStatus: 'deleted',
          errorMessage: 'Deleted full multi-slot upload for re-upload',
        },
      });

      await this.slotRecordModel.updateMany(
        {
          sellerId: { $in: sellerAliases },
          gstId,
          marketplaceId,
          reportMonth,
          uploadId: String(upload._id),
          status: { $in: ['completed', 'processing', 'failed'] },
        },
        { $set: { status: 'deleted' } },
      );

      return {
        success: true,
        message:
          'Previous batch import data removed. You can upload fresh files for all slots now.',
        deletedUploadId: String(upload._id),
      };
    }

    await this.slotRecordModel.updateMany(
      {
        sellerId: { $in: sellerAliases },
        gstId,
        marketplaceId,
        reportMonth,
        slot,
        status: { $in: ['completed', 'processing', 'failed'] },
      },
      { $set: { status: 'deleted' } },
    );

    return {
      success: true,
      message: 'Previous report data removed. You can upload the new file now.',
      deletedUploadId: String(upload._id),
    };
  }

  createImportBatchId() {
    return randomUUID();
  }

  private async backfillSlotRecordsFromUploads(params: {
    sellerAliases: string[];
    gstId: string;
    reportMonth: string;
    marketplaceId?: string;
  }) {
    const uploads = await this.uploadModel
      .find({
        sellerId: { $in: params.sellerAliases },
        gstId: params.gstId,
        reportMonth: params.reportMonth,
        status: 'completed',
        ...(params.marketplaceId ? { marketplace: params.marketplaceId } : {}),
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    for (const upload of uploads) {
      const slots = Array.isArray(upload.uploadedSlots) && upload.uploadedSlots.length
        ? upload.uploadedSlots
        : inferUploadedSlotsFromFileHash(String(upload.fileHash ?? ''));
      if (!slots.length) continue;

      const marketplaceKey = inferMarketplaceKeyFromFileHash(
        String(upload.fileHash ?? ''),
      );
      const uploadId = String(upload._id);

      for (const slot of slots) {
        const existing = await this.slotRecordModel
          .findOne({
            sellerId: upload.sellerId,
            gstId: params.gstId,
            marketplaceId: upload.marketplace,
            reportMonth: params.reportMonth,
            slot,
            status: { $in: ['completed', 'processing', 'failed'] },
          })
          .lean()
          .exec();

        const isPaymentOnly =
          slot === 'paymentReportFile' &&
          (String(upload.fileHash ?? '').startsWith('meesho-payment|') ||
            String(upload.fileHash ?? '').startsWith('flipkart-payment|') ||
            (slots.length === 1 && slots[0] === 'paymentReportFile'));

        const resolved = resolveSlotSummary({
          slot,
          marketplace: marketplaceKey,
          uploadedSlots: slots,
          isPaymentOnly,
          upload,
          slotRecord: existing,
        });

        if (existing) {
          if (existing.totalRecords != null) {
            if (
              existing.fileName?.includes(' + ') &&
              resolved.fileName &&
              !resolved.fileName.includes(' + ')
            ) {
              await this.slotRecordModel.updateOne(
                { _id: existing._id },
                { $set: { fileName: resolved.fileName } },
              );
            }
            continue;
          }

          if (resolved.hasResolvedStats) {
            await this.slotRecordModel.updateOne(
              { _id: existing._id },
              {
                $set: {
                  fileName: resolved.fileName,
                  ...(resolved.fileSize != null
                    ? { fileSize: resolved.fileSize }
                    : {}),
                  totalRecords: resolved.totalRecords,
                  salesRecords: resolved.salesRecords,
                  cashbackRecords: resolved.cashbackRecords,
                  includeDbBreakdown: resolved.includeDbBreakdown,
                },
              },
            );
          }
          continue;
        }

        await this.slotRecordModel.create({
          sellerId: upload.sellerId,
          gstId: params.gstId,
          marketplaceId: upload.marketplace,
          reportMonth: params.reportMonth,
          slot,
          uploadId,
          fileName: resolved.fileName,
          fileSize: resolved.fileSize,
          status: 'completed',
          importBatchId: uploadId,
          ...(resolved.hasResolvedStats
            ? {
                totalRecords: resolved.totalRecords,
                salesRecords: resolved.salesRecords,
                cashbackRecords: resolved.cashbackRecords,
                includeDbBreakdown: resolved.includeDbBreakdown,
              }
            : {}),
        });
      }
    }
  }

  private buildMarketplaceStatus(
    marketplace: MarketplaceUploadKey,
    marketplaceId: string,
    records: Array<{
      slot: string;
      uploadId: string;
      fileName: string;
      fileSize?: number;
      uploadedBy?: string;
      updatedAt?: Date;
      status: string;
      importBatchId?: string;
    }>,
  ) {
    const definitions = getReportDefinitions(marketplace);
    const requiredSlots = getRequiredReportSlots(marketplace);
    const recordBySlot = new Map(records.map((r) => [r.slot, r]));

    const reports: SlotUploadInfo[] = definitions.map((def) => {
      const record = recordBySlot.get(def.slot);
      const uploaded = Boolean(record && record.status === 'completed');
      return {
        slot: def.slot,
        label: def.label,
        required: def.required,
        status: record?.status === 'processing'
          ? 'processing'
          : record?.status === 'failed'
            ? 'failed'
            : uploaded
              ? 'uploaded'
              : 'pending',
        uploadId: record?.uploadId,
        fileName: record?.fileName,
        fileSize: record?.fileSize,
        uploadedBy: record?.uploadedBy,
        uploadedAt: record?.updatedAt
          ? new Date(record.updatedAt).toISOString()
          : undefined,
        importBatchId: record?.importBatchId,
      };
    });

    const requiredReports = reports.filter((r) => requiredSlots.includes(r.slot));
    const uploadedRequired = requiredReports.filter((r) => r.status === 'uploaded').length;
    const totalRequired = requiredReports.length;
    const uploadedSet = new Set(
      reports.filter((r) => r.status === 'uploaded').map((r) => r.slot),
    );
    const isComplete = isMonthComplete(marketplace, uploadedSet);

    let marketplaceStatus: 'completed' | 'pending' | 'partial' = 'pending';
    if (isComplete) marketplaceStatus = 'completed';
    else if (uploadedRequired > 0) marketplaceStatus = 'partial';

    const progressPercent =
      totalRequired > 0 ? Math.round((uploadedRequired / totalRequired) * 100) : 0;

    return {
      marketplaceId,
      marketplaceKey: marketplace,
      status: marketplaceStatus,
      isComplete,
      uploadedRequired,
      totalRequired,
      progressPercent,
      reports,
    };
  }

  private buildMonthSummary(
    marketplaces: Array<{
      isComplete: boolean;
      uploadedRequired: number;
      totalRequired: number;
    }>,
  ) {
    const totalMarketplaces = marketplaces.length;
    const completedMarketplaces = marketplaces.filter((m) => m.isComplete).length;
    const reportsUploaded = marketplaces.reduce((sum, m) => sum + m.uploadedRequired, 0);
    const reportsRequired = marketplaces.reduce((sum, m) => sum + m.totalRequired, 0);
    const pendingReports = Math.max(0, reportsRequired - reportsUploaded);
    const overallProgress =
      reportsRequired > 0 ? Math.round((reportsUploaded / reportsRequired) * 100) : 0;

    return {
      marketplacesCompleted: completedMarketplaces,
      totalMarketplaces,
      reportsUploaded,
      reportsRequired,
      pendingReports,
      overallProgress,
    };
  }

  private inferMarketplaceKeyFromRecords(
    records: Array<{ slot: string }>,
  ): MarketplaceUploadKey | null {
    const slots = new Set(records.map((r) => r.slot));
    if (slots.has('file')) return 'flipkart';
    if (slots.has('mtrB2cFile') || slots.has('mtrB2bFile')) return 'amazon';
    if (
      slots.has('tcsSalesFile') ||
      slots.has('paymentReportFile') ||
      slots.has('orderReportFile')
    ) {
      return 'meesho';
    }
    if (slots.has('gstrReportPackedFile') || slots.has('salesRevenuePackedB2cFile')) {
      return 'myntra';
    }
    return null;
  }
}
