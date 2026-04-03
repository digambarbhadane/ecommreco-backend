import { Injectable } from '@nestjs/common';
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
import { MappingService, NormalizedImportRow } from './mapping.service';
import { ValidationService } from './validation.service';

@Injectable()
export class UploadService {
  constructor(
    private readonly parser: FileParserService,
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
    file: { buffer: Buffer; originalname: string },
    dto: UploadReportDto,
  ) {
    const { gst, marketplace } = await this.validation.validateOwnership(dto);
    const parsed = this.parser.parseFlipkartWorkbook(file.buffer);

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
      parsed.headers['Sales Report'],
      requiredSalesHeaderGroups,
      'Sales Report',
    );
    this.validation.validateRequiredHeaderGroups(
      parsed.headers['Cash Back Report'],
      requiredCashbackHeaderGroups,
      'Cash Back Report',
    );

    this.validation.validateGstinMatch(
      [...parsed.salesRows, ...parsed.cashbackRows],
      gst.gstNumber,
    );

    const fileHash = this.validation.computeFileHash(file.buffer);
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

    parsed.salesRows.forEach((row) => {
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

    parsed.cashbackRows.forEach((row) => {
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

    const invoiceDates = normalizedRows
      .map((row) => row.invoiceDate)
      .filter(
        (item): item is string => typeof item === 'string' && item.length > 0,
      )
      .sort();

    const minInvoiceDate = invoiceDates[0];
    const maxInvoiceDate = invoiceDates[invoiceDates.length - 1];
    await this.validation.ensureNotDuplicate({
      sellerId: dto.sellerId,
      gstin: gst.gstNumber,
      marketplace: marketplace._id?.toString?.() ?? dto.marketplaceId,
      fileHash,
      minInvoiceDate,
      maxInvoiceDate,
      totalRecords: normalizedRows.length,
    });

    const upload = await this.uploadModel.create({
      sellerId: dto.sellerId,
      gstId: dto.gstId,
      gstin: gst.gstNumber,
      marketplace: marketplace._id?.toString?.() ?? dto.marketplaceId,
      fileName: file.originalname,
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
          marketplace: marketplace._id?.toString?.() ?? dto.marketplaceId,
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
