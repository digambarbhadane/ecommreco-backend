import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
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
  Marketplace,
  MarketplaceDocument,
} from '../marketplaces/schemas/marketplace.schema';
import { Gst, GstDocument } from '../gsts/schemas/gst.schema';
import { computeSlotUsageFromGstRecords } from '../common/utils/seller-slot-usage.util';
import {
  buildSubscriptionInvoiceDescription,
  resolveSubscriptionDisplaySnapshot,
  type SubscriptionDisplaySnapshot,
} from './utils/billing-subscription-display.util';
import {
  applyQuoteSnapshotToSellerFields,
  buildSubscriptionPeriodFromMonths,
  extractQuoteFromPaymentMetadata,
  groupReportMonthsByFinancialYear,
  normalizeReportMonths,
  resolveMarketplaceSlotsInPlan,
} from './utils/reconciliation-subscription.util';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from '../payments/schemas/payment-order.schema';
import { buildInvoiceHtml, InvoiceDocument } from './utils/invoice-html.util';
import type { GstCheckoutSelection } from '../trial/subscription-checkout.pricing';
import { getTrialAllowedReportMonthsForSeller } from '../trial/trial.constants';
import {
  formatPlanDurationLabel,
  getAccountTypeLabel,
  getPlanValidityPeriod,
  isTrialSellerAccount,
  resolveAccountCreatedAt,
  resolveSellerAccountKind,
  resolveSubscriptionDisplayId,
} from '../trial/seller-account-type';

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
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    @InjectModel(PanSlotTransaction.name)
    private readonly transactionModel: Model<PanSlotTransactionDocument>,
    @InjectModel(PanSlotRequest.name)
    private readonly requestModel: Model<PanSlotRequestDocument>,
    @InjectModel(Gst.name)
    private readonly gstModel: Model<GstDocument>,
    @InjectModel(Marketplace.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    @InjectModel(PaymentOrder.name)
    private readonly paymentOrderModel: Model<PaymentOrderDocument>,
  ) {}

  private async enrichSellerSubscriptionFromPaymentOrder(
    seller: SellerDocument,
  ) {
    const existingMonths = normalizeReportMonths(seller.reconciliationMonths ?? []);
    const needsOrderLookup =
      !existingMonths.length || !seller.subscriptionPlanLabel;

    if (needsOrderLookup) {
      const order = await this.paymentOrderModel
        .findOne({
          'metadata.checkoutType': 'lead_conversion',
          $or: [
            ...(seller.leadId ? [{ 'metadata.leadLeadId': seller.leadId }] : []),
          ],
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      const quote = extractQuoteFromPaymentMetadata(
        (order?.metadata ?? null) as Record<string, unknown> | null,
      );
      if (quote) {
        applyQuoteSnapshotToSellerFields(seller, quote);
      }
    }

    const finalMonths = normalizeReportMonths(seller.reconciliationMonths ?? []);
    if (finalMonths.length) {
      seller.reconciliationMonths = finalMonths;
      const anchor =
        seller.paymentCompletedAt ??
        seller.paymentVerifiedAt ??
        seller.paymentDate ??
        seller.subscriptionStartsAt ??
        new Date();
      const period = buildSubscriptionPeriodFromMonths(
        finalMonths,
        new Date(anchor),
      );
      seller.subscriptionStartsAt = period.startsAt;
      seller.subscriptionEndsAt = period.endsAt;
    }

    if (!seller.marketplaceSlotsPurchased) {
      const marketplaceSlots = resolveMarketplaceSlotsInPlan({
        marketplaceSlotsPurchased: seller.marketplaceSlotsPurchased,
        subscriptionPlanType: seller.subscriptionPlanType,
        gstSlots: seller.gstSlots,
        gstSlotsPurchased: seller.gstSlotsPurchased,
      });
      if (marketplaceSlots > 0) {
        seller.marketplaceSlotsPurchased = marketplaceSlots;
      }
    }
  }

  private async resolveLiveSlotUsage(sellerId: string) {
    const gstRecords = await this.gstModel
      .find({ sellerId })
      .select('panNumber gstNumber')
      .lean()
      .exec();
    const marketplaceUsed = await this.marketplaceModel.countDocuments({
      sellerId,
    });
    const { gstUsed, panUsed } = computeSlotUsageFromGstRecords(gstRecords);
    const activeGstNumbers = gstRecords
      .map((row) =>
        String(row.gstNumber ?? '')
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);

    return {
      gstUsed,
      panUsed,
      marketplaceUsed,
      activeGstNumbers,
    };
  }

  private async syncSellerSlotCountersIfNeeded(
    seller: Seller & { _id?: Types.ObjectId },
    live: { gstUsed: number; panUsed: number },
  ) {
    const storedGstUsed = Number(seller.gstSlotsUsed ?? 0);
    const storedPanUsed = Number(seller.usedPanSlots ?? 0);
    const staleGstNumber =
      live.gstUsed === 0 && String(seller.gstNumber ?? '').trim().length > 0;
    if (
      storedGstUsed === live.gstUsed &&
      storedPanUsed === live.panUsed &&
      !staleGstNumber
    ) {
      return;
    }
    const update =
      live.gstUsed === 0
        ? {
            $set: { gstSlotsUsed: 0, usedPanSlots: 0, gstNumber: '' },
          }
        : {
            $set: {
              gstSlotsUsed: live.gstUsed,
              usedPanSlots: live.panUsed,
            },
          };
    await this.sellerModel.updateOne({ _id: seller._id }, update).exec();
  }

  private getUserId(user?: RequestUser): string {
    const id = typeof user?.id === 'string' ? user.id.trim() : '';
    if (!id) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid user',
      });
    }
    return id;
  }

  private async findSellerByUser(user?: RequestUser) {
    const userId = this.getUserId(user);
    const email =
      typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';

    if (Types.ObjectId.isValid(userId)) {
      const byId = await this.sellerModel.findById(userId).lean().exec();
      if (byId) return byId;
    }

    if (email) {
      const byEmail = await this.sellerModel
        .findOne({ $or: [{ email }, { username: email }] })
        .lean()
        .exec();
      if (byEmail) return byEmail;
    }

    const sellerUser = await this.userModel
      .findOne({ _id: userId, role: 'seller' })
      .lean()
      .exec();
    if (sellerUser?.email) {
      const sellerEmail = sellerUser.email.trim().toLowerCase();
      return this.sellerModel
        .findOne({
          $or: [{ email: sellerEmail }, { username: sellerEmail }],
        })
        .lean()
        .exec();
    }

    return null;
  }

  private async getSellerForUser(user?: RequestUser) {
    const seller = await this.findSellerByUser(user);
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }
    const sellerId =
      seller._id instanceof Types.ObjectId
        ? seller._id.toString()
        : String(seller._id);
    return { userId: sellerId, seller };
  }

  private splitGst(totalAmount: number) {
    const total = Math.round(totalAmount * 100) / 100;
    const baseAmount = Math.round((total / (1 + GST_RATE)) * 100) / 100;
    const gstAmount = Math.round((total - baseAmount) * 100) / 100;
    return { baseAmount, gstAmount, totalAmount: total };
  }

  private subscriptionStatus(seller: Seller): 'active' | 'expired' | 'pending' {
    const now = Date.now();
    const endsAt = seller.subscriptionEndsAt
      ? new Date(seller.subscriptionEndsAt)
      : null;
    const trialEnd = seller.trialEnd ? new Date(seller.trialEnd) : null;

    const isTrialAccount = isTrialSellerAccount(seller);

    if (isTrialAccount) {
      if (
        seller.trialStatus === 'active' &&
        trialEnd &&
        trialEnd.getTime() >= now
      ) {
        return 'active';
      }
      if (
        seller.trialStatus === 'expired' ||
        seller.trialStatus === 'data_deleted' ||
        (trialEnd && trialEnd.getTime() < now)
      ) {
        return 'expired';
      }
      if (seller.trialStatus === 'pending_payment') {
        return 'pending';
      }
    }

    if (endsAt && !Number.isNaN(endsAt.getTime()) && endsAt.getTime() < now) {
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
    snapshot?: SubscriptionDisplaySnapshot,
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

    const description = snapshot
      ? this.buildSubscriptionInvoiceDescription(seller, snapshot)
      : `EcommReco subscription (${seller.gstSlots ?? 0} GST profile(s))`;

    return {
      id: 'sub-primary',
      invoiceNumber,
      type: 'subscription',
      description,
      issueDate: issueDate
        ? new Date(issueDate).toISOString()
        : new Date().toISOString(),
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
    snapshot?: SubscriptionDisplaySnapshot,
  ): Promise<BillingInvoiceSummary[]> {
    const filter: Record<string, unknown> = {
      $or: [
        { sellerId },
        ...(seller.leadId ? [{ leadId: seller.leadId }] : []),
      ],
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

      const description = snapshot
        ? this.buildSubscriptionInvoiceDescription(seller, snapshot)
        : pkg
          ? `${pkg.name} (${record.gstSlots} GST profile(s))`
          : `Subscription (${record.gstSlots} GST profile(s))`;

      return {
        id: `subscription-${String(record._id)}`,
        invoiceNumber: `SUB-${String(record._id).slice(-8).toUpperCase()}`,
        type: 'subscription' as const,
        description,
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
      (a, b) =>
        new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime(),
    );
  }

  async getSummary(user?: RequestUser) {
    const { userId, seller } = await this.getSellerForUser(user);
    await this.enrichSellerSubscriptionFromPaymentOrder(seller);

    const reconciliationMonths = Array.isArray(seller.reconciliationMonths)
      ? [...seller.reconciliationMonths].sort()
      : [];
    const financialYears = groupReportMonthsByFinancialYear(reconciliationMonths);
    const checkoutSelections = await this.resolveCheckoutSelectionsForSeller(
      userId,
      reconciliationMonths,
    );
    const subscriptionSnapshot = resolveSubscriptionDisplaySnapshot(
      seller,
      checkoutSelections,
    );

    const primary = this.buildPrimarySubscriptionInvoice(
      seller,
      userId,
      subscriptionSnapshot,
    );
    const subscriptionRecords = await this.buildSubscriptionRecordInvoices(
      seller,
      userId,
      subscriptionSnapshot,
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

    const totalPaid = invoices
      .filter((inv) => inv.status === 'paid')
      .reduce((sum, inv) => sum + inv.amount, 0);
    const totalPending = invoices
      .filter((inv) => inv.status === 'pending')
      .reduce((sum, inv) => sum + inv.amount, 0);
    const lastPaidInvoice = invoices.find((inv) => inv.status === 'paid');

    const liveUsage = await this.resolveLiveSlotUsage(userId);
    await this.syncSellerSlotCountersIfNeeded(seller, liveUsage);

    const gstInPlan = subscriptionSnapshot.gstProfilesInPlan;
    const gstActive = liveUsage.gstUsed;
    const panInPlan = subscriptionSnapshot.panProfilesInPlan;
    const panActive = liveUsage.panUsed;
    const panTotal = Math.max(panInPlan, panActive, totalPanSlots);
    const marketplacePurchased = subscriptionSnapshot.marketplaceLinksPurchased;
    const marketplaceUsed = liveUsage.marketplaceUsed;
    const marketplaceTotal = Math.max(marketplacePurchased, marketplaceUsed);

    const addressParts = [seller.address, seller.city, seller.state].filter(
      Boolean,
    );

    const accountKind = resolveSellerAccountKind(seller);
    const isTrialAccount = accountKind === 'trial';
    const validity = getPlanValidityPeriod(seller, isTrialAccount);
    const allowedImportMonths = isTrialAccount
      ? getTrialAllowedReportMonthsForSeller(seller)
      : [];
    const durationLabel = formatPlanDurationLabel(seller, isTrialAccount);

    return {
      success: true,
      data: {
        account: {
          fullName: seller.fullName,
          email: seller.email,
          firmName: seller.firmName,
          gstNumber: liveUsage.activeGstNumbers.length
            ? liveUsage.activeGstNumbers.join(', ')
            : undefined,
          activeGstNumbers: liveUsage.activeGstNumbers,
          contactNumber: seller.contactNumber,
          address: addressParts.length ? addressParts.join(', ') : undefined,
        },
        plan: {
          subscriptionId: resolveSubscriptionDisplayId(seller),
          status: this.subscriptionStatus(seller),
          accountStatus: seller.accountStatus ?? 'active',
          onboardingStatus: seller.onboardingStatus ?? 'payment_pending',
          paymentStatus: seller.paymentStatus ?? 'pending',
          accountType: accountKind,
          accountTypeLabel: getAccountTypeLabel(accountKind),
          durationLabel,
          isTrial: isTrialAccount,
          trialStatus: seller.trialStatus,
          trialStart: seller.trialStart
            ? new Date(seller.trialStart).toISOString()
            : validity.startsAt?.toISOString(),
          trialEnd: seller.trialEnd
            ? new Date(seller.trialEnd).toISOString()
            : validity.endsAt?.toISOString(),
          subscriptionPlanType: seller.subscriptionPlanType,
          subscriptionPlanLabel: subscriptionSnapshot.planLabel,
          reconciliationMonths,
          financialYears,
          allowedImportMonths,
          startsAt: validity.startsAt?.toISOString(),
          endsAt: validity.endsAt?.toISOString(),
          durationYears:
            seller.durationYears ?? seller.subscriptionDuration ?? undefined,
          gstSlots: gstInPlan,
          gstSlotsUsed: gstActive,
          gstSlotsPurchased: gstInPlan,
          panSlots: {
            allocated: seller.allocatedPanSlots ?? 0,
            purchased: panInPlan,
            used: panActive,
            total: panTotal,
          },
          marketplaceLinksUsed: marketplaceUsed,
          marketplaceLinksPurchased: marketplacePurchased,
          billableMonthCount: subscriptionSnapshot.billableMonthCount,
          totalMonthlyRate: subscriptionSnapshot.totalMonthlyRate,
          amount: Number(seller.paymentAmount ?? seller.amount ?? 0),
          paymentDate: seller.paymentDate
            ? new Date(seller.paymentDate).toISOString()
            : seller.paymentCompletedAt
              ? new Date(seller.paymentCompletedAt).toISOString()
              : seller.paymentVerifiedAt
                ? new Date(seller.paymentVerifiedAt).toISOString()
                : undefined,
          paymentVerifiedAt: seller.paymentVerifiedAt
            ? new Date(seller.paymentVerifiedAt).toISOString()
            : undefined,
          paymentReference: seller.transactionId || seller.paymentId,
          paymentLink: seller.paymentLink,
          accountCreatedAt: resolveAccountCreatedAt(seller)?.toISOString(),
        },
        usage: {
          gst: {
            total: Math.max(gstInPlan, gstActive),
            used: gstActive,
            purchased: gstInPlan,
            inPlan: gstInPlan,
            available: Math.max(0, gstInPlan - gstActive),
          },
          pan: {
            allocated: seller.allocatedPanSlots ?? 0,
            purchased: panInPlan,
            used: panActive,
            total: panTotal,
            inPlan: panInPlan,
            available: Math.max(0, panInPlan - panActive),
          },
          marketplace: {
            total: marketplaceTotal,
            used: marketplaceUsed,
            purchased: marketplacePurchased,
            available: Math.max(0, marketplacePurchased - marketplaceUsed),
          },
        },
        subscription: {
          planLabel: subscriptionSnapshot.planLabel,
          planType: subscriptionSnapshot.planType,
          reconciliationMonths: subscriptionSnapshot.reconciliationMonths,
          financialYears: groupReportMonthsByFinancialYear(
            subscriptionSnapshot.reconciliationMonths,
          ),
          billableMonthCount: subscriptionSnapshot.billableMonthCount,
          totalMonthlyRate: subscriptionSnapshot.totalMonthlyRate,
          gstProfilesInPlan: subscriptionSnapshot.gstProfilesInPlan,
          panProfilesInPlan: subscriptionSnapshot.panProfilesInPlan,
          marketplaceLinksPurchased:
            subscriptionSnapshot.marketplaceLinksPurchased,
          panBreakdown: subscriptionSnapshot.panBreakdown,
        },
        totals: {
          totalPaid,
          totalPending,
          invoiceCount: invoices.length,
          lastPaymentDate:
            lastPaidInvoice?.paymentDate ?? lastPaidInvoice?.issueDate,
        },
        invoices,
      },
    };
  }

  private async resolveCheckoutSelectionsForSeller(
    sellerId: string,
    reconciliationMonths: string[],
  ): Promise<GstCheckoutSelection[]> {
    const gstRecords = await this.gstModel
      .find({ sellerId })
      .select('gstNumber')
      .lean()
      .exec();
    if (!gstRecords.length) {
      return [];
    }

    const marketplaces = await this.marketplaceModel
      .find({ sellerId })
      .select('gstId platformMarketplaceId')
      .lean()
      .exec();

    const platformIdsByGstId = new Map<string, string[]>();
    for (const link of marketplaces) {
      const gstId = String(link.gstId ?? '').trim();
      const platformId = String(link.platformMarketplaceId ?? '').trim();
      if (!gstId || !platformId) {
        continue;
      }
      const bucket = platformIdsByGstId.get(gstId) ?? [];
      bucket.push(platformId);
      platformIdsByGstId.set(gstId, bucket);
    }

    const selections: GstCheckoutSelection[] = [];
    for (const record of gstRecords) {
      const gstNumber = String(record.gstNumber ?? '')
        .trim()
        .toUpperCase();
      if (!gstNumber) {
        continue;
      }
      const gstId = String(record._id);
      const marketplacePlatformIds = Array.from(
        new Set(platformIdsByGstId.get(gstId) ?? []),
      );
      selections.push({
        gstNumber,
        verificationId: '',
        marketplacePlatformIds,
        selectedMonths: reconciliationMonths,
      });
    }
    return selections;
  }

  private buildSubscriptionInvoiceDescription(
    seller: Seller,
    snapshot: SubscriptionDisplaySnapshot,
  ): string {
    return buildSubscriptionInvoiceDescription({
      planLabel: snapshot.planLabel,
      reconciliationMonths: snapshot.reconciliationMonths,
      billableMonthCount: snapshot.billableMonthCount,
      totalMonthlyRate: snapshot.totalMonthlyRate,
      gstProfilesInPlan: snapshot.gstProfilesInPlan,
      marketplaceLinksPurchased: snapshot.marketplaceLinksPurchased,
    });
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
    const liveUsage = await this.resolveLiveSlotUsage(sellerId);
    const sellerGstNumber = liveUsage.activeGstNumbers.length
      ? liveUsage.activeGstNumbers.join(', ')
      : undefined;

    const reconciliationMonths = Array.isArray(seller.reconciliationMonths)
      ? [...seller.reconciliationMonths].sort()
      : [];
    const checkoutSelections = await this.resolveCheckoutSelectionsForSeller(
      sellerId,
      reconciliationMonths,
    );
    const snapshot = resolveSubscriptionDisplaySnapshot(
      seller,
      checkoutSelections,
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
        : snapshot.panBreakdown.length
          ? snapshot.panBreakdown.map((row) => ({
              description: `${row.tierLabel} (PAN ${row.panNumber}) · ${row.billableMonthCount} billable month(s)`,
              quantity: row.billableMonthCount,
              unitPrice:
                row.billableMonthCount > 0
                  ? row.lineSubtotal / row.billableMonthCount
                  : row.lineSubtotal,
              amount: row.lineSubtotal,
            }))
          : [
              {
                description: invoice.description,
                quantity: 1,
                unitPrice: invoice.baseAmount,
                amount: invoice.baseAmount,
              },
            ];

    return {
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      status: invoice.status.toUpperCase(),
      sellerName: seller.fullName,
      sellerEmail: seller.email,
      sellerGstNumber,
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
      throw new BadRequestException({
        success: false,
        message: 'Invoice id required',
      });
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
