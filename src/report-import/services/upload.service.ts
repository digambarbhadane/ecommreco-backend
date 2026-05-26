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
import { MyntraImportService } from './myntra-import.service';
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

  async uploadFlipkart(
    files: {
      file?: { buffer: Buffer; originalname: string };
      mtrB2bFile?: { buffer: Buffer; originalname: string };
      mtrB2cFile?: { buffer: Buffer; originalname: string };
      tcsSalesFile?: { buffer: Buffer; originalname: string };
      tcsSalesReturnFile?: { buffer: Buffer; originalname: string };
      orderReportFile?: { buffer: Buffer; originalname: string };
      returnReportFile?: { buffer: Buffer; originalname: string };
      gstrReportPackedFile?: { buffer: Buffer; originalname: string };
      mDirectOrdersReportFile?: { buffer: Buffer; originalname: string };
      salesRevenuePackedB2cFile?: { buffer: Buffer; originalname: string };
      gstrReportRtoFile?: { buffer: Buffer; originalname: string };
      gstrReportRtFile?: { buffer: Buffer; originalname: string };
      mDirectReturnsReportFile?: { buffer: Buffer; originalname: string };
    },
    dto: UploadReportDto,
  ) {
    const { gst, marketplace, marketplaceIdentifier } =
      await this.validation.validateOwnership(dto);
    const isAmazon = marketplaceIdentifier.includes('amazon');
    const isMeesho = marketplaceIdentifier.includes('meesho');
    const isMyntra = marketplaceIdentifier.includes('myntra');
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
    const parsedMyntra =
      isMyntra &&
      files.gstrReportPackedFile &&
      files.mDirectOrdersReportFile &&
      files.salesRevenuePackedB2cFile &&
      files.gstrReportRtoFile &&
      files.gstrReportRtFile &&
      files.mDirectReturnsReportFile
        ? this.myntraImport.parseFiles({
            gstrReportPackedFile: files.gstrReportPackedFile,
            mDirectOrdersReportFile: files.mDirectOrdersReportFile,
            salesRevenuePackedB2cFile: files.salesRevenuePackedB2cFile,
            gstrReportRtoFile: files.gstrReportRtoFile,
            gstrReportRtFile: files.gstrReportRtFile,
            mDirectReturnsReportFile: files.mDirectReturnsReportFile,
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
    } else if (isMyntra) {
      if (
        !files.gstrReportPackedFile ||
        !files.mDirectOrdersReportFile ||
        !files.salesRevenuePackedB2cFile ||
        !files.gstrReportRtoFile ||
        !files.gstrReportRtFile ||
        !files.mDirectReturnsReportFile
      ) {
        throw new BadRequestException(
          'Myntra upload requires all files: GSTR Report Packed, MDirect Orders Report, Sales Revenue Packed B2C, GSTR Report RTO, GSTR Report RT, MDirect Returns Report',
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
    } else if (isMyntra && parsedMyntra) {
      const requiredGstrHeaderGroups = [
        ['seller_gstin'],
        ['order_id'],
        ['payment_method'],
        ['seller_type'],
        ['quantity'],
        ['seller_price'],
        ['base_value'],
        ['igst_rate'],
        ['igst_amt'],
        ['cgst_rate'],
        ['cgst_amt'],
        ['sgst_rate'],
        ['sgst_amt'],
        ['customer_delivery_state_code'],
      ];
      const requiredMDirectHeaderGroups = [
        ['order_release_id'],
        ['seller_sku_code'],
      ];
      const requiredSalesRevenueHeaderGroups = [
        ['Sale_Order_Code', 'sale_order_code'],
        ['Invoice_Number', 'invoice_number'],
        ['Packing_Date', 'packing_date'],
      ];
      this.validation.validateRequiredHeaderGroups(
        parsedMyntra.gstrReportPacked.headers,
        requiredGstrHeaderGroups,
        'GSTR Report Packed',
      );
      this.validation.validateRequiredHeaderGroups(
        parsedMyntra.mDirectOrders.headers,
        requiredMDirectHeaderGroups,
        'MDirect Orders Report',
      );
      this.validation.validateRequiredHeaderGroups(
        parsedMyntra.salesRevenueB2c.headers,
        requiredSalesRevenueHeaderGroups,
        'Sales Revenue Packed B2C',
      );
      this.validation.validateGstinMatch(
        parsedMyntra.gstrReportPacked.rows,
        gst.gstNumber,
      );
      this.validation.validateRequiredHeaderGroups(
        parsedMyntra.gstrReportRto.headers,
        [['tax_seller_gstin'], ['order_id']],
        'GSTR Report RTO',
      );
      this.validation.validateRequiredHeaderGroups(
        parsedMyntra.gstrReportRt.headers,
        [['tax_seller_gstin'], ['shipment_id']],
        'GSTR Report RT',
      );
      if (parsedMyntra.gstrReportRto.rows.length > 0) {
        this.validation.validateGstinMatch(
          parsedMyntra.gstrReportRto.rows,
          gst.gstNumber,
        );
      }
      if (parsedMyntra.gstrReportRt.rows.length > 0) {
        this.validation.validateGstinMatch(
          parsedMyntra.gstrReportRt.rows,
          gst.gstNumber,
        );
      }
      this.validation.validateRequiredHeaderGroups(
        parsedMyntra.mDirectReturns.headers,
        [
          ['order_release_id', 'order_id'],
          ['return_mode'],
          ['return_reason'],
        ],
        'MDirect Returns Report',
      );
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
    } else if (isMyntra && parsedMyntra) {
      const myntraResult = this.myntraImport.buildNormalizedRows(parsedMyntra);
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
          : isMyntra
            ? [
                gstrReportPackedFileHash,
                mDirectOrdersReportFileHash,
                salesRevenuePackedB2cFileHash,
                gstrReportRtoFileHash,
                gstrReportRtFileHash,
                mDirectReturnsReportFileHash,
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
          : isMyntra
            ? `${files.gstrReportPackedFile?.originalname ?? 'GSTR-Packed'} + ${files.mDirectOrdersReportFile?.originalname ?? 'MDirect-Orders'} + ${files.salesRevenuePackedB2cFile?.originalname ?? 'Sales-Revenue-B2C'} + ${files.gstrReportRtoFile?.originalname ?? 'GSTR-RTO'} + ${files.gstrReportRtFile?.originalname ?? 'GSTR-RT'} + ${files.mDirectReturnsReportFile?.originalname ?? 'MDirect-Returns'}`
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
