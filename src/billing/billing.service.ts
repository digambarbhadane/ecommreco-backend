import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PanSlotRequest,
  PanSlotRequestDocument,
} from '../pan-slot-requests/schemas/pan-slot-request.schema';
import {
  PanSlotTransaction,
  PanSlotTransactionDocument,
} from '../pan-slot-requests/schemas/pan-slot-transaction.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../subscription/schemas/subscription.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageDocument,
} from '../subscription/schemas/subscription-package.schema';
import {
  buildInvoiceHtml,
  InvoiceDocument,
} from './utils/invoice-html.util';

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  fullName?: string;
  name?: string;
};

export type BillingInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  type: 'subscription' | 'pan_slot_addon';
  description: string;
  issueDate: string;
  amount: number;
  baseAmount: number;
  gstAmount: number;
  status: 'paid' | 'pending' | 'failed';
  paymentReference?: string;
  paymentDate?: string;
  downloadable: boolean;
};

const GST_RATE = 0.18;

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    @InjectModel(PanSlotTransaction.name)
    private readonly transactionModel: Model<PanSlotTransactionDocument>,
    @InjectModel(PanSlotRequest.name)
    private readonly requestModel: Model<PanSlotRequestDocument>,
  ) {}

  private getUserId(user?: RequestUser): string {
    const id = typeof user?.id === 'string' ? user.id.trim() : '';
    if (!id) {
      throw new BadRequestException({ success: false, message: 'Invalid user' });
    }
    return id;
  }

  private async getSellerForUser(user?: RequestUser) {
    const userId = this.getUserId(user);
    const seller = await this.sellerModel.findById(userId).lean().exec();
    if (!seller) {
      throw new NotFoundException({ success: false, message: 'Seller not found' });
    }
    return { userId, seller };
  }

  private splitGst(totalAmount: number) {
    const total = Math.round(totalAmount * 100) / 100;
    const baseAmount = Math.round((total / (1 + GST_RATE)) * 100) / 100;
    const gstAmount = Math.round((total - baseAmount) * 100) / 100;
    return { baseAmount, gstAmount, totalAmount: total };
  }

  private subscriptionStatus(seller: Seller): 'active' | 'expired' | 'pending' {
    const endsAt = seller.subscriptionEndsAt
      ? new Date(seller.subscriptionEndsAt)
      : null;
    if (endsAt && !Number.isNaN(endsAt.getTime()) && endsAt.getTime() < Date.now()) {
      return 'expired';
    }
    if (
      seller.paymentStatus === 'paid' ||
      seller.paymentCompletedAt ||
      seller.paymentVerifiedAt ||
      seller.onboardingStatus === 'active'
    ) {
      return 'active';
    }
    return 'pending';
  }

  private mapPaymentStatus(
    status?: string,
    paidAt?: Date | string,
  ): 'paid' | 'pending' | 'failed' {
    const normalized = String(status ?? '').toLowerCase();
    if (normalized === 'paid' || normalized === 'completed' || paidAt) {
      return 'paid';
    }
    if (normalized === 'failed') return 'failed';
    return 'pending';
  }

  private buildPrimarySubscriptionInvoice(
    seller: Seller,
    sellerId: string,
  ): BillingInvoiceSummary | null {
    const amount = Number(seller.paymentAmount ?? seller.amount ?? 0) || 0;
    const paidAt =
      seller.paymentVerifiedAt ||
      seller.paymentCompletedAt ||
      seller.paymentDate;
    const status = this.mapPaymentStatus(seller.paymentStatus, paidAt);

    if (amount <= 0 && status !== 'paid') return null;

    const issueDate =
      paidAt ||
      seller.subscriptionStartsAt ||
      seller.accountCreatedAt ||
      (seller as Seller & { createdAt?: Date }).createdAt;
    const { baseAmount, gstAmount, totalAmount } =
      amount > 0
        ? this.splitGst(amount)
        : { baseAmount: 0, gstAmount: 0, totalAmount: 0 };

    const invoiceNumber =
      seller.subscriptionId ||
      seller.transactionId ||
      `SUB-${sellerId.slice(-8).toUpperCase()}`;

    return {
      id: 'sub-primary',
      invoiceNumber,
      type: 'subscription',
      description: `EcommReco subscription (${seller.gstSlots ?? 0} GST slots, ${seller.durationYears ?? seller.subscriptionDuration ?? 1} year(s))`,
      issueDate: issueDate ? new Date(issueDate).toISOString() : new Date().toISOString(),
      amount: totalAmount,
      baseAmount,
      gstAmount,
      status,
      paymentReference: seller.transactionId || seller.paymentId,
      paymentDate: paidAt ? new Date(paidAt).toISOString() : undefined,
      downloadable: status === 'paid' && totalAmount > 0,
    };
  }

  private async buildSubscriptionRecordInvoices(
    seller: Seller,
    sellerId: string,
  ): Promise<BillingInvoiceSummary[]> {
    const filter: Record<string, unknown> = {
      $or: [{ sellerId }, ...(seller.leadId ? [{ leadId: seller.leadId }] : [])],
    };
    const records = await this.subscriptionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const packageIds = records
      .map((item) => item.packageId)
      .filter(Boolean)
      .map((id) => String(id));

    const packages = packageIds.length
      ? await this.packageModel
          .find({ _id: { $in: packageIds } })
          .lean()
          .exec()
      : [];
    const packageById = new Map(
      packages.map((item) => [String(item._id), item]),
    );

    return records.map((record) => {
      const pkg = packageById.get(String(record.packageId));
      const totalAmount = Number(record.totalAmount ?? 0);
      const baseAmount = Number(
        record.selectedPrice ?? totalAmount / (1 + GST_RATE),
      );
      const gstAmount = Number(record.gstAmount ?? totalAmount - baseAmount);
      const status = this.mapPaymentStatus(record.paymentStatus);

      return {
        id: `subscription-${String(record._id)}`,
        invoiceNumber: `SUB-${String(record._id).slice(-8).toUpperCase()}`,
        type: 'subscription' as const,
        description: pkg
          ? `${pkg.name} (${record.gstSlots} GST slot(s), ${record.duration} year(s))`
          : `Subscription (${record.gstSlots} GST slot(s))`,
        issueDate: new Date(
          record.startDate ??
            (record as { createdAt?: Date }).createdAt ??
            Date.now(),
        ).toISOString(),
        amount: totalAmount,
        baseAmount,
        gstAmount,
        status,
        paymentReference: record.paymentLink,
        paymentDate:
          status === 'paid'
            ? new Date(
                (record as { updatedAt?: Date }).updatedAt ?? record.startDate,
              ).toISOString()
            : undefined,
        downloadable: status === 'paid' && totalAmount > 0,
      };
    });
  }

  private async buildPanSlotInvoices(
    sellerId: string,
  ): Promise<BillingInvoiceSummary[]> {
    const transactions = await this.transactionModel
      .find({ sellerId, status: 'completed' })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const fromTransactions = transactions.map((txn) => {
      const totalAmount = Number(txn.amount ?? 0);
      const { baseAmount, gstAmount } = this.splitGst(totalAmount);
      return {
        id: `pan-${txn.transactionNumber}`,
        invoiceNumber: txn.transactionNumber,
        type: 'pan_slot_addon' as const,
        description: `PAN slot add-on (${txn.purchasedSlots} slot(s), ${txn.durationMonths} month(s))`,
        issueDate: new Date(
          txn.paymentDate ??
            txn.assignedAt ??
            (txn as { createdAt?: Date }).createdAt ??
            Date.now(),
        ).toISOString(),
        amount: totalAmount,
        baseAmount,
        gstAmount,
        status: 'paid' as const,
        paymentReference: txn.paymentReference,
        paymentDate: txn.paymentDate
          ? new Date(txn.paymentDate).toISOString()
          : undefined,
        downloadable: totalAmount > 0,
      };
    });

    const paidRequests = await this.requestModel
      .find({
        sellerId,
        status: { $in: ['PAYMENT_RECEIVED', 'APPROVED'] },
        paymentAmount: { $gt: 0 },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const txnRequestIds = new Set(
      transactions.map((item) => String(item.requestId)),
    );
    const fromRequests = paidRequests
      .filter((req) => !txnRequestIds.has(String(req._id)))
      .map((req) => {
        const totalAmount = Number(req.paymentAmount ?? 0);
        const baseAmount = Number(
          req.estimatedBaseAmount ?? totalAmount / (1 + GST_RATE),
        );
        const gstAmount = Number(req.gstAmount ?? totalAmount - baseAmount);
        const paidAt =
          req.paymentVerifiedAt ||
          req.approvedAt ||
          (req as { updatedAt?: Date }).updatedAt;
        return {
          id: `pan-req-${req.requestNumber}`,
          invoiceNumber: req.requestNumber,
          type: 'pan_slot_addon' as const,
          description: `PAN slot add-on (${req.requestedPanSlots} slot(s), ${req.durationMonths} month(s))`,
          issueDate: new Date(
            paidAt ?? (req as { createdAt?: Date }).createdAt ?? Date.now(),
          ).toISOString(),
          amount: totalAmount,
          baseAmount,
          gstAmount,
          status: 'paid' as const,
          paymentReference: req.paymentReference,
          paymentDate: paidAt ? new Date(paidAt).toISOString() : undefined,
          downloadable: totalAmount > 0,
        };
      });

    return [...fromTransactions, ...fromRequests];
  }

  private dedupeInvoices(invoices: BillingInvoiceSummary[]) {
    const byNumber = new Map<string, BillingInvoiceSummary>();
    for (const invoice of invoices) {
      const key = invoice.invoiceNumber.toLowerCase();
      const existing = byNumber.get(key);
      if (!existing || invoice.amount > existing.amount) {
        byNumber.set(key, invoice);
      }
    }
    return Array.from(byNumber.values()).sort(
      (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime(),
    );
  }

  async getSummary(user?: RequestUser) {
    const { userId, seller } = await this.getSellerForUser(user);

    const primary = this.buildPrimarySubscriptionInvoice(seller, userId);
    const subscriptionRecords = await this.buildSubscriptionRecordInvoices(
      seller,
      userId,
    );
    const panInvoices = await this.buildPanSlotInvoices(userId);

    const invoices = this.dedupeInvoices([
      ...(primary ? [primary] : []),
      ...subscriptionRecords,
      ...panInvoices,
    ]);

    const totalPanSlots =
      Number(seller.totalPanSlots ?? 0) ||
      Number(seller.allocatedPanSlots ?? 0) +
        Number(seller.purchasedPanSlots ?? 0);

    return {
      success: true,
      data: {
        plan: {
          subscriptionId: seller.subscriptionId,
          status: this.subscriptionStatus(seller),
          accountStatus: seller.accountStatus ?? 'active',
          paymentStatus: seller.paymentStatus ?? 'pending',
          startsAt: seller.subscriptionStartsAt
            ? new Date(seller.subscriptionStartsAt).toISOString()
            : undefined,
          endsAt: seller.subscriptionEndsAt
            ? new Date(seller.subscriptionEndsAt).toISOString()
            : undefined,
          durationYears:
            seller.durationYears ?? seller.subscriptionDuration ?? undefined,
          gstSlots: seller.gstSlots ?? 0,
          gstSlotsUsed: seller.gstSlotsUsed ?? 0,
          gstSlotsPurchased: seller.gstSlotsPurchased ?? 0,
          panSlots: {
            allocated: seller.allocatedPanSlots ?? 0,
            purchased: seller.purchasedPanSlots ?? 0,
            used: seller.usedPanSlots ?? 0,
            total: totalPanSlots,
          },
          amount: Number(seller.paymentAmount ?? seller.amount ?? 0),
          paymentDate: seller.paymentDate
            ? new Date(seller.paymentDate).toISOString()
            : seller.paymentCompletedAt
              ? new Date(seller.paymentCompletedAt).toISOString()
              : undefined,
          paymentReference: seller.transactionId || seller.paymentId,
          paymentLink: seller.paymentLink,
        },
        invoices,
      },
    };
  }

  private async resolveInvoiceDocument(
    seller: Seller,
    sellerId: string,
    invoiceId: string,
  ): Promise<InvoiceDocument> {
    const summary = await this.getSummary({ id: sellerId });
    const invoice = summary.data.invoices.find((item) => item.id === invoiceId);
    if (!invoice || !invoice.downloadable) {
      throw new NotFoundException({
        success: false,
        message: 'Invoice not found or not available for download',
      });
    }

    const addressParts = [seller.address, seller.city, seller.state].filter(
      Boolean,
    );
    const lineItems =
      invoice.type === 'pan_slot_addon'
        ? [
            {
              description: invoice.description,
              quantity: 1,
              unitPrice: invoice.baseAmount,
              amount: invoice.baseAmount,
            },
          ]
        : [
            {
              description: invoice.description,
              quantity: seller.gstSlots ?? 1,
              unitPrice:
                invoice.baseAmount / Math.max(Number(seller.gstSlots ?? 1), 1),
              amount: invoice.baseAmount,
            },
          ];

    return {
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      status: invoice.status.toUpperCase(),
      sellerName: seller.fullName,
      sellerEmail: seller.email,
      sellerGstNumber: seller.gstNumber,
      sellerAddress: addressParts.join(', ') || undefined,
      sellerFirmName: seller.firmName,
      lineItems,
      subtotal: invoice.baseAmount,
      gstAmount: invoice.gstAmount,
      totalAmount: invoice.amount,
      paymentReference: invoice.paymentReference,
      paymentDate: invoice.paymentDate,
      notes:
        invoice.type === 'pan_slot_addon'
          ? 'PAN slot add-on charges include applicable GST.'
          : 'Subscription charges for EcommReco seller reconciliation platform.',
    };
  }

  async buildInvoiceDownload(user?: RequestUser, invoiceId?: string) {
    if (!invoiceId?.trim()) {
      throw new BadRequestException({ success: false, message: 'Invoice id required' });
    }
    const { userId, seller } = await this.getSellerForUser(user);
    const invoice = await this.resolveInvoiceDocument(
      seller,
      userId,
      invoiceId.trim(),
    );
    const html = buildInvoiceHtml(invoice);
    const filename = `invoice-${invoice.invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '-')}.html`;
    return { html, filename };
  }
}
