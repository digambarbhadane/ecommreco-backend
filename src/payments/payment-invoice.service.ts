import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import {
  PaymentInvoice,
  PaymentInvoiceDocument,
} from './schemas/payment-invoice.schema';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from './schemas/payment-order.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageDocument,
} from '../subscription/schemas/subscription-package.schema';
import { PaymentLogService } from './payment-log.service';

@Injectable()
export class PaymentInvoiceService {
  private readonly logger = new Logger(PaymentInvoiceService.name);

  constructor(
    @InjectModel(PaymentInvoice.name)
    private readonly invoiceModel: Model<PaymentInvoiceDocument>,
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrderDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    private readonly config: ConfigService,
    private readonly paymentLog: PaymentLogService,
  ) {}

  private getInvoiceDir() {
    const dir =
      this.config.get<string>('INVOICE_STORAGE_PATH')?.trim() ||
      path.join(process.cwd(), 'storage', 'invoices');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.invoiceModel.countDocuments({
      invoiceNumber: new RegExp(`^INV-${year}-`),
    });
    return `INV-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  async generateForOrder(orderId: string) {
    const order = await this.orderModel.findOne({ orderId }).exec();
    if (!order) return null;

    const existing = await this.invoiceModel
      .findOne({ paymentOrderId: order._id })
      .exec();
    if (existing) return existing;

    const seller = await this.sellerModel
      .findById(order.sellerId)
      .lean()
      .exec();
    const plan = order.subscriptionPlanId
      ? await this.packageModel.findById(order.subscriptionPlanId).lean().exec()
      : null;

    const invoiceNumber = await this.generateInvoiceNumber();
    const subtotal = order.baseAmount - order.discountAmount;
    const lineItems = [
      {
        description: plan?.name ?? 'EcommReco Subscription',
        quantity: 1,
        unitPrice: subtotal,
        amount: subtotal,
      },
    ];

    const pdfFilename = `${invoiceNumber}.pdf`;
    const pdfPath = path.join(this.getInvoiceDir(), pdfFilename);
    await this.writePdf({
      pdfPath,
      invoiceNumber,
      seller,
      plan,
      order,
      subtotal,
      lineItems,
    });

    const baseUrl =
      this.config.get<string>('API_PUBLIC_URL')?.trim() ||
      this.config.get<string>('FRONTEND_URL')?.trim() ||
      'http://localhost:5001';
    const invoiceUrl = `${baseUrl.replace(/\/+$/, '')}/api/v1/payments/invoices/${invoiceNumber}/download`;

    const invoice = await this.invoiceModel.create({
      invoiceNumber,
      sellerId: order.sellerId,
      paymentOrderId: order._id,
      subtotal,
      gst: order.gstAmount,
      total: order.totalAmount,
      invoiceUrl,
      pdfPath,
      lineItems,
      generatedAt: new Date(),
    });

    await this.paymentLog.log({
      eventType: 'invoice',
      orderId: order.orderId,
      sellerId: order.sellerId,
      message: `Invoice ${invoiceNumber} generated`,
      success: true,
    });

    return invoice;
  }

  private async writePdf(input: {
    pdfPath: string;
    invoiceNumber: string;
    seller: Seller | null;
    plan: SubscriptionPackage | null;
    order: PaymentOrder;
    subtotal: number;
    lineItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }>;
  }) {
    return new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(input.pdfPath);
      doc.pipe(stream);

      const companyName =
        this.config.get<string>('COMPANY_NAME')?.trim() || 'EcommReco';
      const companyGst = this.config.get<string>('COMPANY_GSTIN')?.trim() || '';
      const companyAddress =
        this.config.get<string>('COMPANY_ADDRESS')?.trim() || 'India';

      doc.fontSize(20).text('TAX INVOICE', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(companyName);
      if (companyGst) doc.text(`GSTIN: ${companyGst}`);
      doc.text(companyAddress);
      doc.moveDown();

      doc.text(`Invoice No: ${input.invoiceNumber}`);
      doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`);
      doc.text(`Order ID: ${input.order.orderId}`);
      doc.moveDown();

      if (input.seller) {
        doc.text('Bill To:');
        doc.text(input.seller.firmName || input.seller.fullName);
        doc.text(input.seller.email);
        if (input.seller.gstNumber) {
          doc.text(`GSTIN: ${input.seller.gstNumber}`);
        }
        doc.moveDown();
      }

      doc.text('Description', 50, doc.y, { continued: true, width: 250 });
      doc.text('Amount', { align: 'right' });
      doc.moveDown(0.5);

      for (const item of input.lineItems) {
        doc.text(item.description, 50, doc.y, { continued: true, width: 250 });
        doc.text(`₹${item.amount.toFixed(2)}`, { align: 'right' });
      }

      doc.moveDown();
      doc.text(`Subtotal: ₹${input.subtotal.toFixed(2)}`, { align: 'right' });
      doc.text(
        `GST (${input.order.gstPercentage}%): ₹${input.order.gstAmount.toFixed(2)}`,
        { align: 'right' },
      );
      doc.fontSize(14).text(`Total: ₹${input.order.totalAmount.toFixed(2)}`, {
        align: 'right',
      });

      if (input.plan) {
        doc.moveDown();
        doc.fontSize(10).text(`Plan: ${input.plan.name}`);
      }

      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  async getInvoiceForSeller(sellerId: string, invoiceNumber: string) {
    return this.invoiceModel.findOne({ sellerId, invoiceNumber }).lean().exec();
  }

  async getInvoicePdfPath(invoiceNumber: string) {
    const invoice = await this.invoiceModel
      .findOne({ invoiceNumber })
      .lean()
      .exec();
    if (!invoice?.pdfPath || !fs.existsSync(invoice.pdfPath)) {
      return null;
    }
    return invoice.pdfPath;
  }

  async listForSeller(sellerId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const safePage = Math.max(1, page);
    const [items, total] = await Promise.all([
      this.invoiceModel
        .find({ sellerId })
        .sort({ generatedAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean()
        .exec(),
      this.invoiceModel.countDocuments({ sellerId }).exec(),
    ]);
    return { items, total, page: safePage, limit: safeLimit };
  }
}
