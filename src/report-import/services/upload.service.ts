import { BadRequestException, Injectable } from '@nestjs/common';
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
import {
  MappingService,
  MEESHO_ORDER_ID_ALIASES,
  NormalizedImportRow,
} from './mapping.service';
import { ValidationService } from './validation.service';

@Injectable()
export class UploadService {
  constructor(
    private readonly parser: FileParserService,
    private readonly meeshoImport: MeeshoImportService,
    private readonly validation: ValidationService,
    private readonly mapping: MappingService,
    @InjectModel(ImportUpload.name)
    private readonly uploadModel: Model<ImportUploadDocument>,
    @InjectModel(ImportRow.name)
    private readonly rowModel: Model<ImportRowDocument>,
    @InjectModel(ImportRowError.name)
    private readonly rowErrorModel: Model<ImportRowErrorDocument>,
  ) {}

  async uploadFlipkart(
    files: {
      file?: { buffer: Buffer; originalname: string };
      mtrB2bFile?: { buffer: Buffer; originalname: string };
      mtrB2cFile?: { buffer: Buffer; originalname: string };
      tcsSalesFile?: { buffer: Buffer; originalname: string };
      tcsSalesReturnFile?: { buffer: Buffer; originalname: string };
      orderReportFile?: { buffer: Buffer; originalname: string };
      returnReportFile?: { buffer: Buffer; originalname: string };
    },
    dto: UploadReportDto,
  ) {
    const { gst, marketplace, marketplaceIdentifier } =
      await this.validation.validateOwnership(dto);
    const isAmazon = marketplaceIdentifier.includes('amazon');
    const isMeesho = marketplaceIdentifier.includes('meesho');
    const parsedFlipkart = !isAmazon && files.file
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
    } else if (!files.file) {
      throw new BadRequestException('Flipkart upload requires report file');
    }

    if (isAmazon && parsedAmazonB2c) {
      const requiredAmazonHeaderGroups = [
        ['Seller Gstin', 'Seller GSTIN', 'GST NO'],
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
      this.validation.validateGstinMatch(parsedAmazonB2c.rows, gst.gstNumber);

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
        this.validation.validateGstinMatch(parsedAmazonB2b.rows, gst.gstNumber);
      }
    } else if (parsedFlipkart) {
      const requiredSalesHeaderGroups = [
        ['GST NO', 'Seller GSTIN'],
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
        ['GST NO', 'Seller GSTIN'],
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
          [...MEESHO_ORDER_ID_ALIASES],
          ['SKU', 'SKU ID'],
          ['Reason for Credit Entry'],
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
      );
      if (!gst.state?.trim()) {
        throw new BadRequestException(
          'Seller GST profile state is required for Meesho CGST/SGST calculation',
        );
      }
    }

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
    const fileHash = isAmazon
      ? `amazon|b2c:${b2cFileHash}|b2b:${b2bFileHash || 'none'}`
      : isMeesho
        ? `meesho|tcsSales:${tcsSalesFileHash}|tcsSalesReturn:${tcsSalesReturnFileHash}|order:${orderReportFileHash}|return:${returnReportFileHash}`
      : `single:${singleFileHash}`;
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
      const meeshoResult = this.meeshoImport.buildNormalizedRows(
        parsedMeesho,
        gst.state,
      );
      normalizedRows.push(...meeshoResult.rows);
      rowErrors.push(...meeshoResult.errors);
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
      fileHashes: isAmazon
        ? [b2cFileHash, b2bFileHash].filter(Boolean)
        : isMeesho
          ? [
              tcsSalesFileHash,
              tcsSalesReturnFileHash,
              orderReportFileHash,
              returnReportFileHash,
            ].filter(Boolean)
        : [singleFileHash].filter(Boolean),
    });
    await this.validation.ensureNotDuplicate({
      sellerId: dto.sellerId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      fileHash,
      minInvoiceDate,
      maxInvoiceDate,
      totalRecords: normalizedRows.length,
    });

    const upload = await this.uploadModel.create({
      sellerId: dto.sellerId,
      gstId: dto.gstId,
      gstin: gst.gstNumber,
      marketplace: marketplaceId,
      fileName: isAmazon
        ? `${files.mtrB2bFile?.originalname ?? 'MTR-B2B'} + ${files.mtrB2cFile?.originalname ?? 'MTR-B2C'}`
        : isMeesho
          ? `${files.tcsSalesFile?.originalname ?? 'TCS-Sales'} + ${files.tcsSalesReturnFile?.originalname ?? 'TCS-Sales-Return'} + ${files.orderReportFile?.originalname ?? 'Order-Report'} + ${files.returnReportFile?.originalname ?? 'Return-Report'}`
        : (files.file?.originalname ?? 'report.xlsx'),
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

    const uploadId = upload._id?.toString?.() ?? '';
    const BATCH_SIZE = 1000;
    for (let i = 0; i < normalizedRows.length; i += BATCH_SIZE) {
      const batch = normalizedRows.slice(i, i + BATCH_SIZE);
      await this.rowModel.insertMany(
        batch.map((row) => ({
          uploadId,
          sellerId: dto.sellerId,
          gstin: gst.gstNumber,
          marketplace: marketplaceId,
          reportType: row.reportType,
          documentType: row.documentType,
          voucherType: row.voucherType,
          orderID: row.orderID,
          skuID: row.skuID,
          hsnCode: row.hsnCode,
          paymentMode: row.paymentMode,
          fulfilmentType: row.fulfilmentType,
          quantity: row.quantity,
          invoiceAmount: row.invoiceAmount,
          taxableAmount: row.taxableAmount,
          igstRate: row.igstRate,
          igstAmount: row.igstAmount,
          cgstRate: row.cgstRate,
          cgstAmount: row.cgstAmount,
          sgstRate: row.sgstRate,
          sgstAmount: row.sgstAmount,
          invoiceNo: row.invoiceNo,
          buyerInvoiceDate: row.buyerInvoiceDate,
          invoiceDate: row.invoiceDate,
          pincode: row.pincode,
          stateName: row.stateName,
          customerGstNo: row.customerGstNo,
          buyerName: row.buyerName,
          returnInvoiceDate: row.returnInvoiceDate,
          typeOfReturn: row.typeOfReturn,
          subType: row.subType,
          returnQty: row.returnQty,
          returnReason: row.returnReason,
          detailedReturnReason: row.detailedReturnReason,
        })),
        { ordered: false },
      );
    }

    if (rowErrors.length) {
      await this.rowErrorModel.insertMany(
        rowErrors.map((err) => ({ uploadId, ...err })),
      );
    }

    await this.uploadModel.findByIdAndUpdate(uploadId, {
      $set: { status: 'completed' },
    });

    return {
      success: true,
      message: 'File uploaded successfully',
      uploadId,
      count: normalizedRows.length,
      rowErrorCount: rowErrors.length,
    };
  }
}
