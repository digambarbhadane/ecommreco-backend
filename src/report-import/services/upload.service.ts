import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { parseObjectId } from '../../common/mongo-id.util';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UploadReportDto } from '../dto/upload-report.dto';
import {
  ImportUpload,
  ImportUploadDocument,
} from '../schemas/import-upload.schema';
import { ImportRow, ImportRowDocument } from '../schemas/import-row.schema';
import {
  ImportRowError,
  ImportRowErrorDocument,
} from '../schemas/import-row-error.schema';
import { FileParserService } from './file-parser.service';
import { MeeshoImportService } from './meesho-import.service';
import { MyntraImportService } from './myntra-import.service';
import {
  MappingService,
  MEESHO_ORDER_ID_ALIASES,
  NormalizedImportRow,
} from './mapping.service';
import { amazonImportMapping } from '../config/importMappings/amazon.mapping';
import { flipkartImportMapping } from '../config/importMappings/flipkart.mapping';
import { meeshoImportMapping } from '../config/importMappings/meesho.mapping';
import { ValidationService } from './validation.service';
import {
  formatMyntraEmptyImport,
  formatMyntraJoinIssues,
  MYNTRA_GSTR_PACKED_HEADERS,
  MYNTRA_GSTR_RTO_HEADERS,
  MYNTRA_GSTR_RT_HEADERS,
  MYNTRA_MDIRECT_ORDERS_HEADERS,
  MYNTRA_MDIRECT_RETURNS_HEADERS,
  MYNTRA_SALES_REVENUE_HEADERS,
} from '../utils/myntra-import.validation';
import { insertImportRowsInBatches } from './upload-row.util';

type UploadContext = Awaited<
  ReturnType<ValidationService['validateOwnership']>
>;

type UploadedFileInput = { buffer: Buffer; originalname: string };

type MarketplaceFilesInput = {
  file?: UploadedFileInput;
  mtrB2bFile?: UploadedFileInput;
  mtrB2cFile?: UploadedFileInput;
  tcsSalesFile?: UploadedFileInput;
  tcsSalesReturnFile?: UploadedFileInput;
  orderReportFile?: UploadedFileInput;
  returnReportFile?: UploadedFileInput;
  gstrReportPackedFile?: UploadedFileInput;
  mDirectOrdersReportFile?: UploadedFileInput;
  salesRevenuePackedB2cFile?: UploadedFileInput;
  gstrReportRtoFile?: UploadedFileInput;
  gstrReportRtFile?: UploadedFileInput;
  mDirectReturnsReportFile?: UploadedFileInput;
};

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly parser: FileParserService,
    private readonly meeshoImport: MeeshoImportService,
    private readonly myntraImport: MyntraImportService,
    private readonly validation: ValidationService,
    private readonly mapping: MappingService,
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUploadDocument>,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(ImportRowError.name)
    private readonly rowErrorModel: Model<ImportRowErrorDocument>,
  ) {}

  async getUploadStatus(uploadId: string, sellerId: string) {
    const upload = await this.uploadModel
      .findById(parseObjectId(uploadId, 'upload id'))
      .lean()
      .exec();
    if (!upload || String(upload.sellerId) !== String(sellerId).trim()) {
      throw new NotFoundException('Import upload not found');
    }
    const savedSoFar = upload.totalRecords ?? 0;
    return {
      success: upload.status !== 'failed',
      uploadId,
      status: upload.status,
      count: savedSoFar,
      totalRecords: upload.totalRecords,
      fileName: upload.fileName,
      errorMessage: upload.errorMessage,
      message:
        upload.status === 'processing'
          ? savedSoFar > 0
            ? `Import in progress… ${savedSoFar} row(s) saved so far.`
            : 'Parsing and matching Myntra reports — large files may take a few minutes.'
          : upload.status === 'failed'
            ? upload.errorMessage ?? 'Import failed'
            : `Import completed with ${savedSoFar} record(s).`,
    };
  }

  async uploadMarketplaceReport(
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    files: {
      file?: UploadedFileInput;
      mtrB2bFile?: UploadedFileInput;
      mtrB2cFile?: UploadedFileInput;
      tcsSalesFile?: UploadedFileInput;
      tcsSalesReturnFile?: UploadedFileInput;
      orderReportFile?: UploadedFileInput;
      returnReportFile?: UploadedFileInput;
      gstrReportPackedFile?: UploadedFileInput;
      mDirectOrdersReportFile?: UploadedFileInput;
      salesRevenuePackedB2cFile?: UploadedFileInput;
      gstrReportRtoFile?: UploadedFileInput;
      gstrReportRtFile?: UploadedFileInput;
      mDirectReturnsReportFile?: UploadedFileInput;
    },
    dto: UploadReportDto,
  ) {
    const ctx = await this.validation.validateOwnership(dto);
    const { marketplaceIdentifier } = ctx;
    if (!marketplaceIdentifier.includes(expectedMarketplace)) {
      throw new BadRequestException(
        `Selected marketplace does not match ${expectedMarketplace} upload. Use the correct marketplace or upload endpoint.`,
      );
    }

    const isAmazon = marketplaceIdentifier.includes('amazon');
    const isMeesho = marketplaceIdentifier.includes('meesho');
    const isMyntra = marketplaceIdentifier.includes('myntra');

    if (isAmazon || isMeesho || isMyntra) {
      return this.startInMemoryBackgroundImport(
        expectedMarketplace,
        files,
        dto,
        ctx,
        { isAmazon, isMeesho, isMyntra },
      );
    }

    return this.processImport(
      expectedMarketplace,
      files,
      dto,
      ctx,
      null,
    );
  }

  /** Respond immediately; parse/validate/insert from in-memory buffers (no disk). */
  private async startInMemoryBackgroundImport(
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    flags: { isAmazon: boolean; isMeesho: boolean; isMyntra: boolean },
  ) {
    this.assertRequiredFiles(flags, files);

    const marketplaceId =
      ctx.marketplace._id?.toString?.() ?? dto.marketplaceId;
    const label = expectedMarketplace.charAt(0).toUpperCase() + expectedMarketplace.slice(1);

    const upload = await this.uploadModel.create({
      sellerId: dto.sellerId,
      gstId: dto.gstId,
      gstin: ctx.gst.gstNumber,
      marketplace: marketplaceId,
      fileName: `${label} import (processing)`,
      fileHash: `processing:${Date.now()}`,
      totalRecords: 0,
      salesRecords: 0,
      cashbackRecords: 0,
      status: 'processing',
    });
    const uploadId = upload._id?.toString?.() ?? '';
    const fileSnapshot = this.cloneFileBuffers(files);

    setImmediate(() => {
      void this.runInMemoryBackgroundJob(
        uploadId,
        expectedMarketplace,
        fileSnapshot,
        dto,
        ctx,
        flags,
      );
    });

    return {
      success: true,
      status: 'processing' as const,
      uploadId,
      count: 0,
      message:
        'Import started. Parsing and saving rows in the background — stay on this page to see progress.',
    };
  }

  private async runInMemoryBackgroundJob(
    uploadId: string,
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    flags: { isAmazon: boolean; isMeesho: boolean; isMyntra: boolean },
  ) {
    try {
      const marketplaceId =
        ctx.marketplace._id?.toString?.() ?? dto.marketplaceId;
      const { fileHashes, fileName } = this.buildFileHashBundle(
        files,
        flags.isAmazon,
        flags.isMeesho,
        flags.isMyntra,
      );

      await this.validation.ensureNoDuplicateFileHashes({
        sellerId: dto.sellerId,
        gstin: ctx.gst.gstNumber,
        marketplace: marketplaceId,
        fileHashes,
        excludeUploadId: uploadId,
      });

      await this.uploadModel.findByIdAndUpdate(uploadId, {
        $set: { fileName },
      });

      await this.processImport(
        expectedMarketplace,
        files,
        dto,
        ctx,
        uploadId,
      );
    } catch (err) {
      this.logger.error(
        `Background import failed (${expectedMarketplace}, upload ${uploadId})`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.markUploadFailed(uploadId, err);
    }
  }

  private cloneFile(file?: UploadedFileInput): UploadedFileInput | undefined {
    if (!file) return undefined;
    return {
      buffer: Buffer.from(file.buffer),
      originalname: file.originalname,
    };
  }

  private cloneFileBuffers(files: MarketplaceFilesInput): MarketplaceFilesInput {
    return {
      file: this.cloneFile(files.file),
      mtrB2bFile: this.cloneFile(files.mtrB2bFile),
      mtrB2cFile: this.cloneFile(files.mtrB2cFile),
      tcsSalesFile: this.cloneFile(files.tcsSalesFile),
      tcsSalesReturnFile: this.cloneFile(files.tcsSalesReturnFile),
      orderReportFile: this.cloneFile(files.orderReportFile),
      returnReportFile: this.cloneFile(files.returnReportFile),
      gstrReportPackedFile: this.cloneFile(files.gstrReportPackedFile),
      mDirectOrdersReportFile: this.cloneFile(files.mDirectOrdersReportFile),
      salesRevenuePackedB2cFile: this.cloneFile(files.salesRevenuePackedB2cFile),
      gstrReportRtoFile: this.cloneFile(files.gstrReportRtoFile),
      gstrReportRtFile: this.cloneFile(files.gstrReportRtFile),
      mDirectReturnsReportFile: this.cloneFile(files.mDirectReturnsReportFile),
    };
  }

  private async markUploadFailed(uploadId: string, err: unknown) {
    const errorMessage = this.extractErrorMessage(err);
    await this.uploadModel.findByIdAndUpdate(uploadId, {
      $set: { status: 'failed', errorMessage },
    });
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof BadRequestException) {
      const response = err.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message: string | string[] }).message;
        return Array.isArray(message) ? message.join('\n') : String(message);
      }
    }
    return err instanceof Error ? err.message : 'Import failed';
  }

  private assertRequiredFiles(
    flags: { isAmazon: boolean; isMeesho: boolean; isMyntra: boolean },
    files: MarketplaceFilesInput,
  ) {
    const { isAmazon, isMeesho, isMyntra } = flags;
    if (isAmazon) {
      if (!files.mtrB2cFile) {
        throw new BadRequestException('Amazon upload requires MTR B2C Report file');
      }
    } else if (isMeesho) {
      if (
        !files.tcsSalesFile ||
        !files.tcsSalesReturnFile ||
        !files.orderReportFile ||
        !files.returnReportFile
      ) {
        throw new BadRequestException(
          'Meesho upload requires all files: TCS Sales, TCS Sales Return, Order Report, Return Report',
        );
      }
    } else if (isMyntra) {
      if (
        !files.gstrReportPackedFile ||
        !files.salesRevenuePackedB2cFile ||
        !files.gstrReportRtoFile ||
        !files.gstrReportRtFile
      ) {
        throw new BadRequestException(
          'Myntra upload requires: GSTR Report Packed, Sales Revenue Packed B2C, GSTR Report RTO, and GSTR Report RT. MDirect Orders and MDirect Returns are optional.',
        );
      }
    } else if (!files.file) {
      throw new BadRequestException('Flipkart upload requires report file');
    }
  }

  private buildFileHashBundle(
    files: MarketplaceFilesInput,
    isAmazon: boolean,
    isMeesho: boolean,
    isMyntra: boolean,
  ) {
    const singleFileHash = files.file
      ? this.validation.computeFileHash(files.file.buffer)
      : '';
    const b2bFileHash = files.mtrB2bFile
      ? this.validation.computeFileHash(files.mtrB2bFile.buffer)
      : '';
    const b2cFileHash = files.mtrB2cFile
      ? this.validation.computeFileHash(files.mtrB2cFile.buffer)
      : '';
    const tcsSalesFileHash = files.tcsSalesFile
      ? this.validation.computeFileHash(files.tcsSalesFile.buffer)
      : '';
    const tcsSalesReturnFileHash = files.tcsSalesReturnFile
      ? this.validation.computeFileHash(files.tcsSalesReturnFile.buffer)
      : '';
    const orderReportFileHash = files.orderReportFile
      ? this.validation.computeFileHash(files.orderReportFile.buffer)
      : '';
    const returnReportFileHash = files.returnReportFile
      ? this.validation.computeFileHash(files.returnReportFile.buffer)
      : '';
    const gstrReportPackedFileHash = files.gstrReportPackedFile
      ? this.validation.computeFileHash(files.gstrReportPackedFile.buffer)
      : '';
    const mDirectOrdersReportFileHash = files.mDirectOrdersReportFile
      ? this.validation.computeFileHash(files.mDirectOrdersReportFile.buffer)
      : '';
    const salesRevenuePackedB2cFileHash = files.salesRevenuePackedB2cFile
      ? this.validation.computeFileHash(files.salesRevenuePackedB2cFile.buffer)
      : '';
    const gstrReportRtoFileHash = files.gstrReportRtoFile
      ? this.validation.computeFileHash(files.gstrReportRtoFile.buffer)
      : '';
    const gstrReportRtFileHash = files.gstrReportRtFile
      ? this.validation.computeFileHash(files.gstrReportRtFile.buffer)
      : '';
    const mDirectReturnsReportFileHash = files.mDirectReturnsReportFile
      ? this.validation.computeFileHash(files.mDirectReturnsReportFile.buffer)
      : '';

    const fileHash = isAmazon
      ? `amazon|b2c:${b2cFileHash}|b2b:${b2bFileHash || 'none'}`
      : isMeesho
        ? `meesho|tcsSales:${tcsSalesFileHash}|tcsSalesReturn:${tcsSalesReturnFileHash}|order:${orderReportFileHash}|return:${returnReportFileHash}`
        : isMyntra
          ? `myntra|gstr:${gstrReportPackedFileHash}|mdirect:${mDirectOrdersReportFileHash}|sales:${salesRevenuePackedB2cFileHash}|rto:${gstrReportRtoFileHash}|rt:${gstrReportRtFileHash}|returns:${mDirectReturnsReportFileHash}`
          : `single:${singleFileHash}`;

    const fileHashes = isAmazon
      ? [b2cFileHash, b2bFileHash].filter(Boolean)
      : isMeesho
        ? [
            tcsSalesFileHash,
            tcsSalesReturnFileHash,
            orderReportFileHash,
            returnReportFileHash,
          ].filter(Boolean)
        : isMyntra
          ? [
              gstrReportPackedFileHash,
              mDirectOrdersReportFileHash,
              salesRevenuePackedB2cFileHash,
              gstrReportRtoFileHash,
              gstrReportRtFileHash,
              mDirectReturnsReportFileHash,
            ].filter(Boolean)
          : [singleFileHash].filter(Boolean);

    const fileName = isAmazon
      ? `${files.mtrB2bFile?.originalname ?? 'MTR-B2B'} + ${files.mtrB2cFile?.originalname ?? 'MTR-B2C'}`
      : isMeesho
        ? `${files.tcsSalesFile?.originalname ?? 'TCS-Sales'} + ${files.tcsSalesReturnFile?.originalname ?? 'TCS-Sales-Return'} + ${files.orderReportFile?.originalname ?? 'Order-Report'} + ${files.returnReportFile?.originalname ?? 'Return-Report'}`
        : isMyntra
          ? `${files.gstrReportPackedFile?.originalname ?? 'GSTR-Packed'} + ${files.mDirectOrdersReportFile?.originalname ?? 'MDirect-Orders'} + ${files.salesRevenuePackedB2cFile?.originalname ?? 'Sales-Revenue-B2C'} + ${files.gstrReportRtoFile?.originalname ?? 'GSTR-RTO'} + ${files.gstrReportRtFile?.originalname ?? 'GSTR-RT'} + ${files.mDirectReturnsReportFile?.originalname ?? 'MDirect-Returns'}`
          : (files.file?.originalname ?? 'report.xlsx');

    return { fileHash, fileHashes, fileName };
  }

  async processImport(
    expectedMarketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra',
    files: MarketplaceFilesInput,
    dto: UploadReportDto,
    ctx: UploadContext,
    existingUploadId: string | null,
  ) {
    const { gst, marketplace, marketplaceIdentifier } = ctx;
    const isAmazon = marketplaceIdentifier.includes('amazon');
    const isMeesho = marketplaceIdentifier.includes('meesho');
    const isMyntra = marketplaceIdentifier.includes('myntra');
    if (!existingUploadId) {
      this.assertRequiredFiles(
        { isAmazon, isMeesho, isMyntra },
        files,
      );
    }

    const parsedFlipkart =
      !isAmazon && !isMeesho && !isMyntra && files.file
        ? this.parser.parseFlipkartWorkbook(files.file.buffer)
        : null;
    const parsedAmazonB2b = isAmazon && files.mtrB2bFile
      ? this.parser.parseAmazonWorkbook(files.mtrB2bFile.buffer)
      : null;
    const parsedAmazonB2c = isAmazon && files.mtrB2cFile
      ? this.parser.parseAmazonWorkbook(files.mtrB2cFile.buffer)
      : null;
    const parsedMeesho =
      isMeesho &&
      files.tcsSalesFile &&
      files.tcsSalesReturnFile &&
      files.orderReportFile &&
      files.returnReportFile
        ? this.meeshoImport.parseFiles({
            tcsSalesFile: files.tcsSalesFile,
            tcsSalesReturnFile: files.tcsSalesReturnFile,
            orderReportFile: files.orderReportFile,
            returnReportFile: files.returnReportFile,
          })
        : null;
    // parseFiles is async — yields the event loop between each of the 6 XLSX.read() calls
    const parsedMyntra =
      isMyntra &&
      files.gstrReportPackedFile &&
      files.salesRevenuePackedB2cFile &&
      files.gstrReportRtoFile &&
      files.gstrReportRtFile
        ? await this.myntraImport.parseFiles({
            gstrReportPackedFile: files.gstrReportPackedFile,
            mDirectOrdersReportFile: files.mDirectOrdersReportFile,
            salesRevenuePackedB2cFile: files.salesRevenuePackedB2cFile,
            gstrReportRtoFile: files.gstrReportRtoFile,
            gstrReportRtFile: files.gstrReportRtFile,
            mDirectReturnsReportFile: files.mDirectReturnsReportFile,
          })
        : null;

    if (isAmazon && parsedAmazonB2c) {
      const requiredAmazonHeaderGroups = [
        [...amazonImportMapping.gstin.excelColumns],
        ['Order Id', 'Order ID'],
        ['Sku', 'SKU'],
        ['Hsn/sac', 'HSN Code'],
        ['Transaction Type'],
        ['Payment Method', 'Payment Mode', 'Payment Method Code'],
        ['Fulfillment Channel', 'Fullfilment Channel', 'Fulfilment Type'],
        ['Quantity'],
        ['Invoice Amount'],
        ['Tax Exclusive Gross', 'Taxable Amount', 'Taxable Value'],
        ['Igst Rate', 'IGST Rate'],
        ['Igst Tax', 'IGST Amount'],
        ['Cgst Rate', 'CGST Rate'],
        ['Cgst Tax', 'CGST Amount'],
        ['Sgst Rate', 'SGST Rate'],
        ['Sgst Tax', 'SGST Amount'],
        ['Invoice Number', 'Invoice No'],
        ['Invoice Date'],
        ['Ship To Postal Code', 'Pincode'],
        ['Ship To State', 'State Name'],
      ];
      this.validation.validateRequiredHeaderGroups(
        parsedAmazonB2c.headers,
        requiredAmazonHeaderGroups,
        'Amazon MTR B2C Report',
      );
      this.validation.validateGstinMatch(
        parsedAmazonB2c.rows,
        gst.gstNumber,
        marketplaceIdentifier,
        parsedAmazonB2c.headers,
        [],
        amazonImportMapping,
      );

      if (parsedAmazonB2b) {
        this.validation.validateRequiredHeaderGroups(
          parsedAmazonB2b.headers,
          requiredAmazonHeaderGroups,
          'Amazon MTR B2B Report',
        );
        this.validation.validateRequiredHeaderGroups(
          parsedAmazonB2b.headers,
          [['Customer Bill To Gstid'], ['Buyer Name']],
          'Amazon MTR B2B Report',
        );
        this.validation.validateGstinMatch(
          parsedAmazonB2b.rows,
          gst.gstNumber,
          marketplaceIdentifier,
          parsedAmazonB2b.headers,
          [],
          amazonImportMapping,
        );
      }
    } else if (parsedFlipkart) {
      const requiredSalesHeaderGroups = [
        [...flipkartImportMapping.gstin.excelColumns],
        ['Order ID'],
        ['Invoice No', 'Buyer Invoice ID'],
        ['Buyer Invoice Date'],
        [
          'Invoice Amount',
          'Final Invoice Amount',
          'Final Invoice Amount (Price after discount+Shipping Charges)',
        ],
        ['Taxable Amount', 'Taxable Value'],
        ['Document Type', 'Event Type'],
      ];
      const requiredCashbackHeaderGroups = [
        [...flipkartImportMapping.gstin.excelColumns],
        ['Order ID'],
        [
          'Invoice No',
          'Credit Note ID',
          'Debit Note ID',
          'Credit Note ID / Debit Note ID',
        ],
        ['Invoice Date'],
        ['Invoice Amount'],
        ['Taxable Amount', 'Taxable Value'],
        ['Payment Mode', 'Document Type'],
      ];
      this.validation.validateRequiredHeaderGroups(
        parsedFlipkart.headers['Sales Report'],
        requiredSalesHeaderGroups,
        'Sales Report',
      );
      this.validation.validateRequiredHeaderGroups(
        parsedFlipkart.headers['Cash Back Report'],
        requiredCashbackHeaderGroups,
        'Cash Back Report',
      );
      this.validation.validateGstinMatch(
        [...parsedFlipkart.salesRows, ...parsedFlipkart.cashbackRows],
        gst.gstNumber,
        marketplaceIdentifier,
        [
          ...parsedFlipkart.headers['Sales Report'],
          ...parsedFlipkart.headers['Cash Back Report'],
        ],
        parsedFlipkart.gstinValues,
        flipkartImportMapping,
      );
    } else if (isMeesho && parsedMeesho) {
      const requiredTcsSalesHeaderGroups = [
        ['gstin', 'GST NO'],
        [...MEESHO_ORDER_ID_ALIASES],
        ['hsn_code', 'HSN Code'],
        ['quantity', 'Quantity'],
        ['total_invoice_value', 'Invoice Amount'],
        ['total_taxable_sale_value', 'Taxable Amount'],
        ['gst_rate', 'IGST Rate'],
        ['tax_amount', 'IGST Amount'],
        ['order_date', 'Invoice Date'],
        ['end_customer_state_new', 'State Name'],
      ];
      this.validation.validateRequiredHeaderGroups(
        parsedMeesho.tcsSales.headers,
        requiredTcsSalesHeaderGroups,
        'TCS Sales Report',
      );
      this.validation.validateRequiredHeaderGroups(
        parsedMeesho.orderReport.headers,
        [
          ['Sub Order No', ...MEESHO_ORDER_ID_ALIASES],
          ['SKU', 'SKU ID'],
          ['Reason for Credit Entry', 'Document Type'],
        ],
        'Order Report',
      );
      this.validation.validateRequiredHeaderGroups(
        parsedMeesho.tcsSalesReturn.headers,
        [
          [...MEESHO_ORDER_ID_ALIASES],
          ['cancel_return_date', 'Return Invoice Date'],
        ],
        'TCS Sales Return Report',
      );
      this.validation.validateRequiredHeaderGroups(
        parsedMeesho.returnReport.headers,
        [
          [...MEESHO_ORDER_ID_ALIASES],
          ['Type of Return'],
          ['Sub Type'],
          ['Qty', 'Return Qty'],
          ['Return Reason'],
          ['Detailed Return Reason'],
        ],
        'Return Report',
      );
      this.validation.validateGstinMatch(
        parsedMeesho.tcsSales.rows,
        gst.gstNumber,
        marketplaceIdentifier,
        parsedMeesho.tcsSales.headers,
        [],
        meeshoImportMapping,
      );
      // Seller state optional: when missing, CGST/SGST stay blank (inter-state / IGST only).
    } else if (isMyntra && parsedMyntra) {
      // eslint-disable-next-line no-console
      console.log('[MYNTRA_VALIDATE] checking headers, row counts, and GSTIN…');
      const myntraValidationReports = [
        {
          reportLabel: 'GSTR Report Packed',
          fileName: files.gstrReportPackedFile?.originalname ?? '',
          headers: parsedMyntra.gstrReportPacked.headers,
          rows: parsedMyntra.gstrReportPacked.rows,
          requiredHeaderGroups: MYNTRA_GSTR_PACKED_HEADERS,
          checkGstin: true,
        },
        {
          reportLabel: 'Sales Revenue Packed B2C',
          fileName: files.salesRevenuePackedB2cFile?.originalname ?? '',
          headers: parsedMyntra.salesRevenueB2c.headers,
          rows: parsedMyntra.salesRevenueB2c.rows,
          requiredHeaderGroups: MYNTRA_SALES_REVENUE_HEADERS,
        },
        {
          reportLabel: 'GSTR Report RTO',
          fileName: files.gstrReportRtoFile?.originalname ?? '',
          headers: parsedMyntra.gstrReportRto.headers,
          rows: parsedMyntra.gstrReportRto.rows,
          requiredHeaderGroups: MYNTRA_GSTR_RTO_HEADERS,
        },
        {
          reportLabel: 'GSTR Report RT',
          fileName: files.gstrReportRtFile?.originalname ?? '',
          headers: parsedMyntra.gstrReportRt.headers,
          rows: parsedMyntra.gstrReportRt.rows,
          requiredHeaderGroups: MYNTRA_GSTR_RT_HEADERS,
        },
      ];
      if (files.mDirectOrdersReportFile) {
        myntraValidationReports.splice(1, 0, {
          reportLabel: 'MDirect Orders Report',
          fileName: files.mDirectOrdersReportFile.originalname,
          headers: parsedMyntra.mDirectOrders.headers,
          rows: parsedMyntra.mDirectOrders.rows,
          requiredHeaderGroups: MYNTRA_MDIRECT_ORDERS_HEADERS,
        });
      }
      if (files.mDirectReturnsReportFile) {
        myntraValidationReports.push({
          reportLabel: 'MDirect Returns Report',
          fileName: files.mDirectReturnsReportFile.originalname,
          headers: parsedMyntra.mDirectReturns.headers,
          rows: parsedMyntra.mDirectReturns.rows,
          requiredHeaderGroups: MYNTRA_MDIRECT_RETURNS_HEADERS,
        });
      }
      this.validation.validateMyntraImportBundle(myntraValidationReports, gst.gstNumber);
      // eslint-disable-next-line no-console
      console.log('[MYNTRA_VALIDATE] passed');
    }

    const { fileHash, fileHashes, fileName } = this.buildFileHashBundle(
      files,
      isAmazon,
      isMeesho,
      isMyntra,
    );
    const normalizedRows: Array<
      NormalizedImportRow & {
        __sheetName: string;
        __rowNumber: number;
      }
    > = [];
    const rowErrors: Array<{
      sheetName: string;
      rowNumber: number;
      error: string;
    }> = [];

    if (isAmazon && parsedAmazonB2c) {
      [...(parsedAmazonB2b?.rows ?? []), ...parsedAmazonB2c.rows].forEach((row) => {
        try {
          normalizedRows.push({
            ...this.mapping.mapAmazonRow(row),
            __sheetName: row.__sheetName,
            __rowNumber: row.__rowNumber,
          });
        } catch {
          rowErrors.push({
            sheetName: row.__sheetName,
            rowNumber: row.__rowNumber,
            error: 'Failed to normalize amazon row',
          });
        }
      });
    } else if (isMeesho && parsedMeesho) {
      // eslint-disable-next-line no-console
      console.log(
        `[MEESHO_BUILD] tcsSales=${parsedMeesho.tcsSales.rows.length} tcsReturn=${parsedMeesho.tcsSalesReturn.rows.length} order=${parsedMeesho.orderReport.rows.length} return=${parsedMeesho.returnReport.rows.length}`,
      );
      const meeshoResult = this.meeshoImport.buildNormalizedRows(
        parsedMeesho,
        gst.state,
      );
      normalizedRows.push(...meeshoResult.rows);
      rowErrors.push(...meeshoResult.errors);
    } else if (isMyntra && parsedMyntra) {
      if (existingUploadId) {
        await this.uploadModel.findByIdAndUpdate(existingUploadId, {
          $set: { totalRecords: 0 },
        });
      }
      // buildNormalizedRows is async — yields every 2000 rows so status-check requests can be served
      const myntraResult = await this.myntraImport.buildNormalizedRows(parsedMyntra);
      if (myntraResult.joinIssues && myntraResult.rows.length === 0) {
        throw new BadRequestException(
          formatMyntraJoinIssues(myntraResult.joinIssues),
        );
      }
      if (myntraResult.joinIssues && myntraResult.rows.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[MYNTRA_BUILD] partial import: built=${myntraResult.rows.length} joinSkipped=${myntraResult.joinIssues.missingInGstr + myntraResult.joinIssues.missingInMdirect + myntraResult.joinIssues.missingOrderIdInSales}`,
        );
      }
      normalizedRows.push(...myntraResult.rows);
      rowErrors.push(...myntraResult.errors);
    } else if (parsedFlipkart) {
      parsedFlipkart.salesRows.forEach((row) => {
        try {
          normalizedRows.push({
            ...this.mapping.mapSalesRow(row),
            __sheetName: row.__sheetName,
            __rowNumber: row.__rowNumber,
          });
        } catch {
          rowErrors.push({
            sheetName: row.__sheetName,
            rowNumber: row.__rowNumber,
            error: 'Failed to normalize sales row',
          });
        }
      });

      parsedFlipkart.cashbackRows.forEach((row) => {
        try {
          normalizedRows.push({
            ...this.mapping.mapCashbackRow(row),
            __sheetName: row.__sheetName,
            __rowNumber: row.__rowNumber,
          });
        } catch {
          rowErrors.push({
            sheetName: row.__sheetName,
            rowNumber: row.__rowNumber,
            error: 'Failed to normalize cashback row',
          });
        }
      });
    }

    const invoiceDates = normalizedRows
      .map((row) => row.invoiceDate)
      .filter(
        (item): item is string => typeof item === 'string' && item.length > 0,
      )
      .sort();

    const minInvoiceDate = invoiceDates[0];
    const maxInvoiceDate = invoiceDates[invoiceDates.length - 1];
    if (normalizedRows.length === 0) {
      if (isMyntra && parsedMyntra) {
        throw new BadRequestException(
          formatMyntraEmptyImport({
            'GSTR Report Packed': parsedMyntra.gstrReportPacked.rows.length,
            'MDirect Orders Report': parsedMyntra.mDirectOrders.rows.length,
            'Sales Revenue Packed B2C': parsedMyntra.salesRevenueB2c.rows.length,
            'GSTR Report RTO': parsedMyntra.gstrReportRto.rows.length,
            'GSTR Report RT': parsedMyntra.gstrReportRt.rows.length,
            'MDirect Returns Report': parsedMyntra.mDirectReturns.rows.length,
          }),
        );
      }
      const hint = rowErrors.length
        ? `${rowErrors.length} row(s) failed validation/mapping.`
        : 'No data rows found in uploaded file(s). Check sheet names and required columns.';
      throw new BadRequestException(
        `Import produced no records. ${hint}`,
      );
    }
    const marketplaceId = marketplace._id?.toString?.() ?? dto.marketplaceId;
    await this.validation.ensureNoDuplicateFileHashes({
      sellerId: dto.sellerId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      fileHashes,
      excludeUploadId: existingUploadId ?? undefined,
    });
    await this.validation.ensureNotDuplicate({
      sellerId: dto.sellerId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      fileHash,
      minInvoiceDate,
      maxInvoiceDate,
      totalRecords: normalizedRows.length,
      excludeUploadId: existingUploadId ?? undefined,
    });

    let uploadId = existingUploadId ?? '';
    if (!uploadId) {
      const upload = await this.uploadModel.create({
        sellerId: dto.sellerId,
        gstId: dto.gstId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
        fileName,
        fileHash,
        totalRecords: normalizedRows.length,
        minInvoiceDate,
        maxInvoiceDate,
        salesRecords: normalizedRows.filter((row) => row.reportType === 'sales')
          .length,
        cashbackRecords: normalizedRows.filter(
          (row) => row.reportType === 'cashback',
        ).length,
        status: 'processing',
      });
      uploadId = upload._id?.toString?.() ?? '';
    }

    await insertImportRowsInBatches(
      this.rowModel,
      normalizedRows,
      {
        uploadId,
        sellerId: dto.sellerId,
        gstin: gst.gstNumber,
        marketplace: marketplaceId,
      },
      async (savedCount) => {
        await this.uploadModel.findByIdAndUpdate(uploadId, {
          $set: { totalRecords: savedCount },
        });
      },
    );

    if (rowErrors.length) {
      await this.rowErrorModel.insertMany(
        rowErrors.map((err) => ({ uploadId, ...err })),
      );
    }

    const salesRecords = normalizedRows.filter(
      (row) => row.reportType === 'sales',
    ).length;
    const cashbackRecords = normalizedRows.filter(
      (row) => row.reportType === 'cashback',
    ).length;

    await this.uploadModel.findByIdAndUpdate(uploadId, {
      $set: {
        status: 'completed',
        totalRecords: normalizedRows.length,
        minInvoiceDate,
        maxInvoiceDate,
        salesRecords,
        cashbackRecords,
        fileHash,
        fileName,
      },
      $unset: { errorMessage: 1 },
    });

    return {
      success: true,
      status: 'completed' as const,
      message: 'File uploaded successfully',
      uploadId,
      count: normalizedRows.length,
      rowErrorCount: rowErrors.length,
    };
  }
}
