import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Connection, Model, Types } from 'mongoose';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { NotificationsService } from '../notifications/notifications.service';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { generatePublicId } from '../common/public-id';
import {
  SubscriptionPackage,
  SubscriptionPackageDocument,
} from '../subscription/schemas/subscription-package.schema';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  addDays,
  computeTrialPayable,
  getTrialAllowedReportMonthsForSeller,
  getTrialCoveredMonthsForPurchase,
  sellerHadTrialCoverage,
  TRIAL_DATA_RETENTION_DAYS,
  TRIAL_DURATION_DAYS,
  TRIAL_GST_SLOTS,
  TRIAL_PAN_SLOTS,
} from './trial.constants';
import {
  formatPlanDurationLabel,
  getAccountTypeLabel,
  resolveSellerAccountKind,
} from './seller-account-type';
import {
  AdminTrialActionDto,
  ConfirmTrialPaymentDto,
  ListTrialsQueryDto,
  PurchaseTrialSubscriptionDto,
  RegisterTrialDto,
} from './dto/trial.dto';
import {
  TrialCleanupLog,
  TrialCleanupLogDocument,
} from './schemas/trial-cleanup-log.schema';
import {
  TrialSubscription,
  TrialSubscriptionDocument,
} from './schemas/trial-subscription.schema';
import { Gst, GstDocument } from '../gsts/schemas/gst.schema';
import { TrialHistoryService } from './trial-history.service';
import { TrialValidationService } from './trial-validation.service';
import {
  SellerSubscription,
  SellerSubscriptionDocument,
  type SubscriptionType,
} from '../payments/schemas/seller-subscription.schema';
import {
  resolveSubscriptionCheckoutPricing,
  type GstCheckoutSelection,
  type TrialCoverageContext,
} from './subscription-checkout.pricing';
import { GstsService } from '../gsts/gsts.service';
import { MarketplacesService } from '../marketplaces/marketplaces.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);

  constructor(
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(TrialSubscription.name)
    private readonly trialModel: Model<TrialSubscriptionDocument>,
    @InjectModel(TrialCleanupLog.name)
    private readonly cleanupLogModel: Model<TrialCleanupLogDocument>,
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    @InjectModel(Gst.name)
    private readonly gstModel: Model<GstDocument>,
    @InjectModel(SellerSubscription.name)
    private readonly sellerSubscriptionModel: Model<SellerSubscriptionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly validation: TrialValidationService,
    private readonly history: TrialHistoryService,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    private readonly subscriptionService: SubscriptionService,
    @Inject(forwardRef(() => GstsService))
    private readonly gstsService: GstsService,
    @Inject(forwardRef(() => MarketplacesService))
    private readonly marketplacesService: MarketplacesService,
  ) {}

  getPricing() {
    return {
      trial: computeTrialPayable(),
      durationDays: TRIAL_DURATION_DAYS,
      gstSlots: TRIAL_GST_SLOTS,
      panSlots: TRIAL_PAN_SLOTS,
      dataRetentionDays: TRIAL_DATA_RETENTION_DAYS,
      allowedImportMonths: 3,
      plans: [
        'Monthly',
        'Quarterly',
        'Half Yearly',
        'Yearly',
        'Custom',
        'Financial Year',
      ],
    };
  }

  private inferSubscriptionType(durationDays: number): SubscriptionType {
    if (durationDays >= 365) return 'yearly';
    if (durationDays >= 180) return 'half_yearly';
    if (durationDays >= 90) return 'quarterly';
    if (durationDays >= 30) return 'monthly';
    return 'custom';
  }

  private async resolveTrialCoverageContext(
    seller: SellerDocument,
  ): Promise<
    | (TrialCoverageContext & {
        trialMarketplaces: Array<{ id: string; name: string }>;
        trialTradeName?: string;
      })
    | null
  > {
    if (!sellerHadTrialCoverage(seller)) {
      return null;
    }

    const coveredMonths = getTrialCoveredMonthsForPurchase(seller);
    const trialGstNumber =
      String(seller.gstNumber ?? '')
        .trim()
        .toUpperCase() || null;
    if (!trialGstNumber) {
      return {
        coveredMonths,
        trialGstNumber: null,
        trialMarketplacePlatformIds: [],
        trialMarketplaces: [],
        trialTradeName: seller.firmName?.trim() || seller.fullName?.trim(),
      };
    }

    const sellerId = String(seller._id);
    const gstDoc = await this.gstModel
      .findOne({ sellerId, gstNumber: trialGstNumber })
      .select('_id')
      .lean()
      .exec();

    if (!gstDoc?._id) {
      return {
        coveredMonths,
        trialGstNumber,
        trialMarketplacePlatformIds: [],
        trialMarketplaces: [],
        trialTradeName: seller.firmName?.trim() || seller.fullName?.trim(),
      };
    }

    const trialGstId = String(gstDoc._id);
    const marketplaceResult = await this.marketplacesService.listSeller({
      sellerId,
    });
    const trialMarketplaces: Array<{ id: string; name: string }> = [];
    const seenMarketplaceIds = new Set<string>();
    for (const link of marketplaceResult.data ?? []) {
      if (!link || String(link.gstId ?? '') !== trialGstId) {
        continue;
      }
      const platform = link.platformMarketplaceId as
        | { _id?: string; name?: string }
        | string
        | undefined;
      let id = '';
      let name = String(link.name ?? 'Marketplace');
      if (platform && typeof platform === 'object' && platform._id) {
        id = String(platform._id);
        name = String(platform.name ?? name);
      } else {
        id = String(platform ?? '').trim();
      }
      if (!id || seenMarketplaceIds.has(id)) {
        continue;
      }
      seenMarketplaceIds.add(id);
      trialMarketplaces.push({ id, name });
    }
    const trialMarketplaceIds = trialMarketplaces.map((row) => row.id);

    return {
      coveredMonths,
      trialGstNumber,
      trialMarketplacePlatformIds: trialMarketplaceIds,
      trialMarketplaces,
      trialTradeName: seller.firmName?.trim() || seller.fullName?.trim(),
    };
  }

  private assertSubscriptionMonthsExcludeTrialCoverage(
    seller: SellerDocument,
    selectedMonths: string[],
  ) {
    const trialCovered = new Set(getTrialCoveredMonthsForPurchase(seller));
    if (!trialCovered.size) {
      return;
    }

    const overlap = Array.from(
      new Set(
        (selectedMonths ?? [])
          .map((month) => String(month).trim())
          .filter((month) => trialCovered.has(month)),
      ),
    ).sort();

    if (!overlap.length) {
      return;
    }

    throw new BadRequestException(
      `These reconciliation months were already included in your trial and cannot be purchased again: ${overlap.join(', ')}.`,
    );
  }

  private async ensureSellerSubscriptionRecord(input: {
    sellerId: string;
    orderId: string;
    planId?: Types.ObjectId | string;
    subscriptionType?: SubscriptionType;
    startDate: Date;
    endDate: Date;
    trial: boolean;
  }) {
    const order = await this.paymentsService.getOrderById(input.orderId);
    if (!order) {
      return null;
    }

    const paymentOrderId = (order as { _id?: Types.ObjectId })._id;
    if (!paymentOrderId) {
      return null;
    }

    const existing = await this.sellerSubscriptionModel
      .findOne({ paymentOrderId })
      .exec();
    if (existing) {
      return existing;
    }

    const planObjectId =
      input.planId && Types.ObjectId.isValid(String(input.planId))
        ? new Types.ObjectId(String(input.planId))
        : order.subscriptionPlanId;

    return this.sellerSubscriptionModel.create({
      sellerId: input.sellerId,
      paymentOrderId,
      ...(planObjectId ? { planId: planObjectId } : {}),
      subscriptionType: input.subscriptionType ?? 'monthly',
      startDate: input.startDate,
      endDate: input.endDate,
      renewalDate: input.endDate,
      status: 'active',
      trial: input.trial,
      activatedAt: input.startDate,
      activatedBy: 'trial_service',
      metadata: order.metadata,
    });
  }

  async listActivePackages() {
    await this.subscriptionService.ensureDefaultPackages();
    return this.packageModel
      .find({ isActive: true })
      .sort({ planType: 1, durationInDays: 1 })
      .lean()
      .exec();
  }

  async register(dto: RegisterTrialDto) {
    if (!dto.acceptTerms) {
      throw new BadRequestException('You must accept the Terms to continue.');
    }
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Password and Confirm Password do not match.');
    }

    const email = dto.email.trim().toLowerCase();
    const mobile = dto.mobile.trim();
    const panNumber = dto.panNumber.trim().toUpperCase();
    const gstNumber = dto.gstNumber.trim().toUpperCase();

    await this.validation.assertEligibleForTrial({
      email,
      mobile,
      panNumber,
      gstNumber,
    });

    const pricing = computeTrialPayable();
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const session = await this.connection.startSession();
    let seller: SellerDocument;
    let trial: TrialSubscriptionDocument;
    try {
      session.startTransaction();

      const createdSellers = await this.sellerModel.create(
        [
          {
            publicId: generatePublicId('seller', email),
            fullName: dto.ownerName.trim(),
            firmName: dto.companyName.trim(),
            contactNumber: mobile,
            email,
            gstNumber,
            panNumber,
            businessType: dto.businessType?.trim(),
            state: dto.state?.trim(),
            city: dto.city?.trim(),
            password: hashedPassword,
            username: email,
            isTrial: true,
            trialStatus: 'pending_payment',
            convertedToPaid: false,
            gstSlots: TRIAL_GST_SLOTS,
            gstSlotsPurchased: TRIAL_GST_SLOTS,
            gstSlotsUsed: 0,
            allocatedPanSlots: TRIAL_PAN_SLOTS,
            purchasedPanSlots: 0,
            usedPanSlots: 0,
            totalPanSlots: TRIAL_PAN_SLOTS,
            panProfiles: [],
            onboardingStatus: 'payment_pending',
            accountStatus: 'active',
            paymentStatus: 'pending',
            paymentAmount: pricing.totalPayable,
            leadSource: 'self_service_trial',
          },
        ],
        { session },
      );
      seller = createdSellers[0];

      const createdTrials = await this.trialModel.create(
        [
          {
            sellerId: seller._id,
            panNumber,
            gstNumber,
            email,
            mobile,
            companyName: dto.companyName.trim(),
            ownerName: dto.ownerName.trim(),
            status: 'pending_payment',
            basePrice: pricing.basePrice,
            gstPercentage: pricing.gstPercentage,
            gstAmount: pricing.gstAmount,
            totalPayable: pricing.totalPayable,
            paymentStatus: 'pending',
            paymentLink: this.buildTrialPaymentLink(String(seller._id)),
            metadata: {
              businessType: dto.businessType,
              state: dto.state,
              city: dto.city,
            },
          },
        ],
        { session },
      );
      trial = createdTrials[0];

      seller.trialSubscriptionId = String(trial._id);
      await seller.save({ session });

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }

    await this.history.record({
      sellerId: seller._id,
      trialSubscriptionId: trial._id,
      event: 'registration_success',
      message: 'Trial registration completed. Payment pending.',
    });

    void this.emailService
      .sendEmail({
        to: email,
        type: EmailType.REGISTRATION_WELCOME,
        subject: 'Welcome to EcommReco Trial',
        payload: {
          name: dto.ownerName,
          companyName: dto.companyName,
        },
      })
      .catch((error) =>
        this.logger.warn(
          `Trial welcome email failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );

    void this.notifications
      .createNotification({
        event: 'trial_registered',
        recipientRole: 'super_admin',
        message: `New trial registration: ${dto.companyName} (${email})`,
      })
      .catch(() => undefined);

    return {
      success: true,
      sellerId: String(seller._id),
      trialSubscriptionId: String(trial._id),
      status: 'pending_payment',
      pricing,
      paymentLink: trial.paymentLink,
      message: 'Registration successful. Complete trial payment to activate.',
    };
  }

  async getPaymentSummary(sellerId: string) {
    const trial = await this.requireTrialBySeller(sellerId);
    const pending = (trial.metadata as Record<string, unknown>)?.pendingCheckout as
      | { orderId?: string; paymentSessionId?: string }
      | undefined;
    return {
      sellerId,
      trialSubscriptionId: String(trial._id),
      status: trial.status,
      paymentStatus: trial.paymentStatus,
      pricing: {
        basePrice: trial.basePrice,
        gstPercentage: trial.gstPercentage,
        gstAmount: trial.gstAmount,
        totalPayable: trial.totalPayable,
      },
      orderId: pending?.orderId,
      payment_session_id: pending?.paymentSessionId,
      trialStart: trial.trialStart,
      trialEnd: trial.trialEnd,
    };
  }

  private async resolveTrialPlanId() {
    const trialPlan = await this.packageModel
      .findOne({ isTrial: true, isActive: true })
      .exec();
    if (trialPlan) {
      return String(trialPlan._id);
    }
    const fallback = await this.packageModel
      .findOne({ isActive: true, durationInDays: { $lte: TRIAL_DURATION_DAYS } })
      .sort({ durationInDays: 1 })
      .exec();
    if (fallback) {
      return String(fallback._id);
    }
    const anyPlan = await this.packageModel
      .findOne({ isActive: true })
      .sort({ durationInDays: 1 })
      .exec();
    if (!anyPlan) {
      throw new BadRequestException(
        'Trial plan is not configured. Please contact support.',
      );
    }
    return String(anyPlan._id);
  }

  async initTrialPayment(sellerId: string) {
    const seller = await this.requireSeller(sellerId);
    const trial = await this.requireTrialBySeller(sellerId);

    if (trial.paymentStatus === 'paid' && trial.status === 'active') {
      return {
        success: true,
        alreadyActive: true,
        trialStart: trial.trialStart,
        trialEnd: trial.trialEnd,
      };
    }

    if (trial.status !== 'pending_payment') {
      throw new BadRequestException(
        `Cannot start payment for trial in status "${trial.status}".`,
      );
    }

    const pricing = computeTrialPayable(trial.basePrice);
    const planId = await this.resolveTrialPlanId();
    const orderResult = await this.paymentsService.createOrderForSeller(
      sellerId,
      {
        plan_id: planId,
        idempotency_key: `trial-reg-${sellerId}`,
        metadata: {
          checkoutType: 'trial_registration',
          quote: {
            totalPayable: pricing.totalPayable,
            basePrice: pricing.basePrice,
            gstAmount: pricing.gstAmount,
            gstPercentage: pricing.gstPercentage,
          },
          durationDays: TRIAL_DURATION_DAYS,
          gstSlots: TRIAL_GST_SLOTS,
          panSlots: TRIAL_PAN_SLOTS,
          isTrial: true,
        },
      },
      { id: sellerId, email: seller.email },
    );

    trial.metadata = {
      ...(trial.metadata ?? {}),
      pendingCheckout: {
        orderId: orderResult.data.order_id,
        paymentSessionId: orderResult.data.payment_session_id,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    };
    await trial.save();

    return {
      success: true,
      orderId: orderResult.data.order_id,
      payment_session_id: orderResult.data.payment_session_id,
      total_amount: orderResult.data.total_amount,
      pricing,
      message: 'Complete payment to activate your trial.',
    };
  }

  async confirmPayment(sellerId: string, dto: ConfirmTrialPaymentDto) {
    const seller = await this.requireSeller(sellerId);
    const trial = await this.requireTrialBySeller(sellerId);

    if (trial.paymentStatus === 'paid' && trial.status === 'active') {
      await this.ensureTrialGstProvisioned(seller);
      return {
        success: true,
        alreadyActive: true,
        trialStart: trial.trialStart,
        trialEnd: trial.trialEnd,
      };
    }

    if (trial.status !== 'pending_payment') {
      throw new BadRequestException(
        `Cannot confirm payment for trial in status "${trial.status}".`,
      );
    }

    const orderId = dto.orderId?.trim();
    if (!orderId) {
      throw new BadRequestException(
        'Complete payment via Cashfree before activating your trial.',
      );
    }

    const verifyResult = await this.paymentsService.verifyPayment(
      { order_id: orderId },
      { id: sellerId, email: seller.email },
    );
    if (!verifyResult.success) {
      throw new BadRequestException(
        verifyResult.message ?? 'Payment not verified yet. Please try again.',
      );
    }

    const now = new Date();
    const trialEnd = addDays(now, TRIAL_DURATION_DAYS);
    const paymentId =
      verifyResult.data?.transaction_id ??
      dto.paymentId?.trim() ??
      dto.transactionId?.trim() ??
      orderId;

    trial.paymentStatus = 'paid';
    trial.paidAt = now;
    trial.paymentId = paymentId;
    trial.transactionId = dto.transactionId?.trim() ?? paymentId;
    trial.status = 'active';
    trial.trialStart = now;
    trial.trialEnd = trialEnd;
    trial.cleanupDate = addDays(trialEnd, TRIAL_DATA_RETENTION_DAYS);
    await trial.save();

    seller.trialStatus = 'active';
    seller.trialStart = now;
    seller.trialEnd = trialEnd;
    seller.cleanupDate = trial.cleanupDate;
    seller.paymentStatus = 'paid';
    seller.paymentCompletedAt = now;
    seller.paymentVerifiedAt = now;
    seller.paymentAmount = trial.totalPayable;
    seller.paymentId = trial.paymentId;
    seller.transactionId = trial.transactionId;
    seller.onboardingStatus = 'active';
    seller.subscriptionStartsAt = now;
    seller.subscriptionEndsAt = trialEnd;
    await seller.save();

    await this.ensureSellerSubscriptionRecord({
      sellerId,
      orderId,
      subscriptionType: 'trial',
      startDate: now,
      endDate: trialEnd,
      trial: true,
    });

    await this.ensureTrialGstProvisioned(seller);

    await this.history.record({
      sellerId,
      trialSubscriptionId: trial._id,
      event: 'payment_success',
      message: 'Trial payment received. 7-day trial started.',
      payload: {
        paymentId: trial.paymentId,
        trialStart: now,
        trialEnd,
      },
    });

    await this.history.record({
      sellerId,
      trialSubscriptionId: trial._id,
      event: 'trial_started',
      message: `Trial active until ${trialEnd.toISOString()}`,
    });

    void this.emailService
      .sendEmail({
        to: seller.email,
        type: EmailType.SUBSCRIPTION,
        subject: 'Your EcommReco Trial Has Started',
        payload: {
          name: seller.fullName,
          trialEnd: trialEnd.toISOString().slice(0, 10),
          days: TRIAL_DURATION_DAYS,
        },
      })
      .catch(() => undefined);

    return {
      success: true,
      status: 'active',
      trialStart: now,
      trialEnd,
      message: 'Trial activated successfully.',
    };
  }

  async getSellerTrialStatus(sellerId: string) {
    const seller = await this.requireSeller(sellerId);
    const planType = seller.subscriptionPlanType ?? null;
    const reconciliationMonths = Array.isArray(seller.reconciliationMonths)
      ? [...seller.reconciliationMonths].sort()
      : [];
    const planEntitlements = {
      subscriptionPlanType: planType,
      reconciliationMonths,
      maxGsts:
        planType === 'single_gst' ||
        planType === 'single_gst_multi_marketplace'
          ? 1
          : null,
      maxMarketplaces:
        planType === 'single_gst'
          ? 1
          : planType === 'single_gst_multi_marketplace'
            ? Number(seller.marketplaceSlotsPurchased ?? 0) || null
            : null,
    };

    const access = this.validation.assertTrialApiAccess(seller);
    const accountType = resolveSellerAccountKind(seller);
    const isTrialAccount = accountType === 'trial';

    const allowedImportMonths = isTrialAccount
      ? getTrialAllowedReportMonthsForSeller(seller)
      : [];
    const trialCoveredMonthsForPurchase =
      getTrialCoveredMonthsForPurchase(seller);
    const trialCoverage = await this.resolveTrialCoverageContext(seller);

    const subscriptionEndsAt = seller.subscriptionEndsAt
      ? new Date(seller.subscriptionEndsAt)
      : seller.trialEnd
        ? new Date(seller.trialEnd)
        : null;
    const subscriptionDaysRemaining = subscriptionEndsAt
      ? Math.max(
          0,
          Math.ceil(
            (subscriptionEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          ),
        )
      : null;

    const base = {
      accountType,
      accountTypeLabel: getAccountTypeLabel(accountType),
      durationLabel: formatPlanDurationLabel(seller, isTrialAccount),
      access,
      requiresPayment:
        access === 'expired' ||
        access === 'pending_payment' ||
        access === 'suspended',
      subscriptionStartsAt: seller.subscriptionStartsAt ?? seller.trialStart,
      subscriptionEndsAt: seller.subscriptionEndsAt ?? seller.trialEnd,
      subscriptionDaysRemaining,
      allowedImportMonths,
      trialCoveredMonthsForPurchase,
      trialGstNumber: trialCoverage?.trialGstNumber ?? null,
      trialMarketplacePlatformIds:
        trialCoverage?.trialMarketplacePlatformIds ?? [],
      trialMarketplaces: trialCoverage?.trialMarketplaces ?? [],
      trialTradeName: trialCoverage?.trialTradeName ?? null,
      isTrial: isTrialAccount,
      ...planEntitlements,
    };

    if (!isTrialAccount) {
      return base;
    }

    if (seller.trialStatus === 'active') {
      await this.ensureTrialGstProvisioned(seller);
    }

    const trial = await this.trialModel
      .findOne({ sellerId: new Types.ObjectId(sellerId) })
      .lean()
      .exec();

    return {
      trialStatus: seller.trialStatus,
      trialStart: seller.trialStart,
      trialEnd: seller.trialEnd,
      convertedToPaid: Boolean(seller.convertedToPaid),
      pricing: trial
        ? {
            basePrice: trial.basePrice,
            gstAmount: trial.gstAmount,
            totalPayable: trial.totalPayable,
          }
        : computeTrialPayable(),
      daysRemaining: seller.trialEnd
        ? Math.max(
            0,
            Math.ceil(
              (new Date(seller.trialEnd).getTime() - Date.now()) /
                (24 * 60 * 60 * 1000),
            ),
          )
        : 0,
      ...base,
    };
  }

  calculateSubscriptionQuote(input: {
    basePrice: number;
    durationInDays: number;
    planType?:
      | 'single_gst'
      | 'multi_gst_pan'
      | 'single_gst_multi_marketplace';
    billingMode:
      | 'single_gst'
      | 'multi_gst_pan'
      | 'single_gst_multi_marketplace';
    selectedMonths: string[];
    gstNumbers?: string[];
    panNumber?: string;
    gstSlots?: number;
    panSlots?: number;
    discountType?: 'percentage' | 'flat' | 'none';
    discountValue?: number;
  }) {
    const months = Array.from(
      new Set(
        (input.selectedMonths ?? [])
          .map((m) => String(m).trim())
          .filter((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)),
      ),
    ).sort();
    if (!months.length) {
      throw new BadRequestException(
        'Select at least one reconciliation month (YYYY-MM).',
      );
    }

    const monthCount = months.length;
    const billingMode = input.billingMode;
    const planType = input.planType ?? 'multi_gst_pan';

    if (
      billingMode === 'single_gst' &&
      planType !== 'single_gst'
    ) {
      throw new BadRequestException(
        'Selected package is not a Single GST plan.',
      );
    }
    if (
      billingMode === 'single_gst_multi_marketplace' &&
      planType !== 'single_gst_multi_marketplace'
    ) {
      throw new BadRequestException(
        'Selected package is not a Single GST + Multi Marketplace plan.',
      );
    }
    if (billingMode === 'multi_gst_pan' && planType !== 'multi_gst_pan') {
      throw new BadRequestException(
        'Selected package is not a Multi GST / PAN monthly plan.',
      );
    }

    let gstSlots = 1;
    let panSlots = 1;
    let subtotal = 0;
    let resolvedPan: string | undefined;
    let resolvedGsts: string[] | undefined;

    if (
      billingMode === 'single_gst' ||
      billingMode === 'single_gst_multi_marketplace'
    ) {
      gstSlots = 1;
      panSlots = 1;
      subtotal = Number(input.basePrice) * monthCount;
    } else {
      const gstNumbers = Array.from(
        new Set(
          (input.gstNumbers ?? [])
            .map((g) => String(g).trim().toUpperCase())
            .filter(Boolean),
        ),
      );
      const requestedSlots = Math.max(
        1,
        Math.min(
          50,
          Number(input.gstSlots ?? input.panSlots ?? 0) || 1,
        ),
      );

      if (requestedSlots === 1 && !gstNumbers.length) {
        throw new BadRequestException(
          'Add at least one GST number when purchasing a single PAN slot.',
        );
      }

      let pan: string | undefined;
      if (gstNumbers.length) {
        pan =
          String(input.panNumber ?? '').trim().toUpperCase() ||
          (gstNumbers[0].length >= 12 ? gstNumbers[0].slice(2, 12) : '');
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
          throw new BadRequestException(
            'A valid PAN is required when GST numbers are provided.',
          );
        }
        for (const gst of gstNumbers) {
          const embedded = gst.length >= 12 ? gst.slice(2, 12) : '';
          if (embedded !== pan) {
            throw new BadRequestException(
              `GST ${gst} does not belong to PAN ${pan}. Only GSTs under the same PAN can be entered together.`,
            );
          }
        }
        resolvedPan = pan;
        resolvedGsts = gstNumbers;
      }

      gstSlots = requestedSlots;
      panSlots = requestedSlots;
      subtotal = Number(input.basePrice) * requestedSlots * monthCount;
    }

    const discountType = input.discountType ?? 'none';
    const discountValue = Number(input.discountValue ?? 0);
    let discountAmount = 0;
    if (discountType === 'percentage') {
      discountAmount = (subtotal * discountValue) / 100;
    } else if (discountType === 'flat') {
      discountAmount = discountValue;
    }
    const discounted = Math.max(0, subtotal - discountAmount);
    const gstAmount = Number(((discounted * 18) / 100).toFixed(2));
    const totalPayable = Number((discounted + gstAmount).toFixed(2));

    return {
      billingMode,
      planType,
      selectedMonths: months,
      monthCount,
      gstSlots,
      panSlots,
      marketplaceSlots:
        billingMode === 'single_gst'
          ? 1
          : billingMode === 'single_gst_multi_marketplace'
            ? null
            : null,
      durationDays: monthCount * 30,
      basePricePerMonth: Number(input.basePrice),
      discountType,
      discountValue,
      discountAmount: Number(discountAmount.toFixed(2)),
      subtotal: Number(discounted.toFixed(2)),
      gstPercentage: 18,
      gstAmount,
      totalPayable,
      gstNumbers: resolvedGsts,
      panNumber: resolvedPan,
    };
  }

  async quotePurchase(sellerId: string, dto: PurchaseTrialSubscriptionDto) {
    const seller = await this.requireSeller(sellerId);

    if (dto.gstSelections?.length) {
      return this.quoteFromGstSelections(seller, dto);
    }

    this.assertSubscriptionMonthsExcludeTrialCoverage(
      seller,
      dto.selectedMonths ?? [],
    );

    const billingMode = dto.billingMode;
    if (!billingMode) {
      throw new BadRequestException(
        'Select a subscription plan or add verified GST profiles to continue.',
      );
    }

    const pkg = await this.subscriptionService.resolveActivePackage({
      planType: billingMode,
      packageId: dto.packageId,
    });

    const basePrice = Number(pkg.finalPriceAfterDiscount ?? pkg.basePrice ?? 0);
    const durationInDays = Number(pkg.durationInDays ?? 30);
    const planType = (pkg.planType ?? billingMode) as
      | 'single_gst'
      | 'multi_gst_pan'
      | 'single_gst_multi_marketplace';

    return {
      package: pkg.toObject(),
      quote: this.calculateSubscriptionQuote({
        basePrice,
        durationInDays,
        planType,
        billingMode,
        selectedMonths: dto.selectedMonths ?? [],
        gstNumbers: dto.gstNumbers,
        panNumber: dto.panNumber,
        gstSlots: dto.gstSlots,
        panSlots: dto.panSlots,
        discountType: 'none',
        discountValue: 0,
      }),
    };
  }

  private async quoteFromGstSelections(
    seller: SellerDocument,
    dto: PurchaseTrialSubscriptionDto,
  ) {
    const trialCoverage = await this.resolveTrialCoverageContext(seller);

    let pricing;
    try {
      pricing = resolveSubscriptionCheckoutPricing({
        selections: (dto.gstSelections ?? []) as GstCheckoutSelection[],
        selectedMonths: dto.selectedMonths,
        trialCoverage,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid GST checkout selection.',
      );
    }

    if (pricing.subtotalBeforeDiscount <= 0) {
      throw new BadRequestException(
        'Selected months are already included in your trial for the original GST and marketplace. Add a new GST or marketplace, or choose months outside your trial period.',
      );
    }

    const pkg = await this.subscriptionService.resolveActivePackage({
      planType: pricing.planType,
      packageId: dto.packageId,
    });
    const subtotal = Number(pricing.subtotalBeforeDiscount.toFixed(2));
    const gstAmount = Number(((subtotal * 18) / 100).toFixed(2));
    const totalPayable = Number((subtotal + gstAmount).toFixed(2));
    const months = pricing.selectedMonths;

    return {
      package: pkg.toObject(),
      quote: {
        billingMode: pricing.billingMode,
        planType: pricing.planType,
        selectedMonths: months,
        monthCount: months.length,
        billableMonthCount: pricing.billableMonthCount,
        gstSlots: pricing.gstSlots,
        panSlots: pricing.panSlots,
        marketplaceSlots: pricing.marketplaceSlots,
        gstCount: pricing.gstCount,
        totalMonthlyRate: pricing.totalMonthlyRate,
        panBreakdown: pricing.panBreakdown,
        durationDays: Math.max(30, pricing.billableMonthCount * 30),
        basePricePerMonth: pricing.totalMonthlyRate,
        discountType: 'none' as const,
        discountValue: 0,
        discountAmount: 0,
        subtotal,
        gstPercentage: 18,
        gstAmount,
        totalPayable,
        gstNumbers: pricing.gstNumbers,
        panNumber: pricing.panNumbers[0],
        gstSelections: pricing.selections,
        planLabel: pricing.planLabel,
        trialCoverageApplied: pricing.trialCoverageApplied,
      },
    };
  }

  private async provisionCheckoutSelections(
    sellerId: string,
    selections: GstCheckoutSelection[],
  ) {
    if (!selections.length) {
      return;
    }

    const gstIdByNumber = new Map<string, string>();

    for (const item of selections) {
      const gstNumber = String(item.gstNumber ?? '')
        .trim()
        .toUpperCase();
      if (!gstNumber) {
        continue;
      }

      const existing = await this.gstModel
        .findOne({ gstNumber })
        .select('_id sellerId')
        .lean()
        .exec();
      if (existing) {
        if (String(existing.sellerId ?? '') === sellerId) {
          gstIdByNumber.set(gstNumber, String(existing._id));
        }
        continue;
      }

      try {
        const created = await this.gstsService.create(
          {
            sellerId,
            verificationId: item.verificationId,
            gstNumber,
          },
          { actorRole: 'super_admin' },
        );
        const gstId = String((created as { data?: { _id?: unknown } }).data?._id ?? '');
        if (gstId) {
          gstIdByNumber.set(gstNumber, gstId);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? 'unknown');
        this.logger.warn(
          `Checkout GST provision skipped for ${gstNumber}: ${message}`,
        );
      }
    }

    for (const item of selections) {
      const gstNumber = String(item.gstNumber ?? '')
        .trim()
        .toUpperCase();
      const gstId = gstIdByNumber.get(gstNumber);
      if (!gstId) {
        continue;
      }

      for (const platformId of item.marketplacePlatformIds ?? []) {
        try {
          await this.marketplacesService.create({
            sellerId,
            gstId,
            platformMarketplaceId: platformId,
          });
        } catch (error) {
          const payload = (error as { response?: { errorCode?: string } })
            ?.response;
          if (payload?.errorCode === 'DUPLICATE_MARKETPLACE') {
            continue;
          }
          const message =
            error instanceof Error ? error.message : String(error ?? 'unknown');
          this.logger.warn(
            `Checkout marketplace link skipped for ${gstNumber}: ${message}`,
          );
        }
      }
    }
  }

  async initPurchaseSubscription(
    sellerId: string,
    dto: PurchaseTrialSubscriptionDto,
  ) {
    const seller = await this.requireSeller(sellerId);
    const access = this.validation.assertTrialApiAccess(seller);
    if (access === 'suspended') {
      throw new BadRequestException(
        'Your account is suspended. Contact support to purchase a subscription.',
      );
    }

    const quoteResult = await this.quotePurchase(sellerId, dto);
    const quote = quoteResult.quote;
    const pkg = quoteResult.package;
    const planId = String((pkg as { _id?: Types.ObjectId | string })._id ?? '');
    if (!Types.ObjectId.isValid(planId)) {
      throw new BadRequestException(
        'No active subscription plan configured. Please contact support.',
      );
    }

    const isRenewal =
      seller.convertedToPaid ||
      seller.trialStatus === 'converted' ||
      (!seller.isTrial && seller.paymentStatus === 'paid');

    const orderResult = await this.paymentsService.createOrderForSeller(
      sellerId,
      {
        plan_id: planId,
        metadata: {
          checkoutType: isRenewal ? 'subscription_renewal' : 'trial_upgrade',
          quote,
          purchaseDto: dto,
          durationDays: quote.durationDays,
          gstSlots: quote.gstSlots,
          panSlots: quote.panSlots,
          selectedMonths: quote.selectedMonths,
          billingMode: quote.billingMode,
          panNumber: quote.panNumber,
        },
      },
      { id: sellerId, email: seller.email },
    );
    const orderId = orderResult.data.order_id;
    const paymentSessionId = orderResult.data.payment_session_id;

    const trial = await this.trialModel
      .findOne({ sellerId: new Types.ObjectId(sellerId) })
      .exec();
    if (trial) {
      trial.metadata = {
        ...(trial.metadata ?? {}),
        pendingCheckout: {
          orderId,
          paymentSessionId,
          status: 'pending',
          createdAt: new Date().toISOString(),
          purchaseDto: {
            packageId: dto.packageId,
            billingMode: dto.billingMode,
            selectedMonths: dto.selectedMonths,
            gstNumbers: dto.gstNumbers,
            panNumber: dto.panNumber,
            gstSlots: dto.gstSlots,
            panSlots: dto.panSlots,
            gstSelections: dto.gstSelections,
          },
          quote,
          package: {
            _id: String((pkg as { _id?: Types.ObjectId | string })._id ?? ''),
            name: (pkg as { name?: string }).name ?? 'Subscription',
          },
        },
      };
      await trial.save();
    }

    return {
      success: true,
      orderId,
      payment_session_id: paymentSessionId,
      paymentLink: '',
      quote,
      package: pkg,
      message: 'Checkout created. Complete payment to activate your subscription.',
    };
  }

  async confirmPurchaseSubscription(
    sellerId: string,
    confirm: {
      orderId: string;
      paymentId?: string;
      transactionId?: string;
    },
  ) {
    const seller = await this.requireSeller(sellerId);
    const trial = await this.trialModel
      .findOne({ sellerId: new Types.ObjectId(sellerId) })
      .exec();

    const order = await this.paymentsService.getOrderById(confirm.orderId);
    const orderMeta = (order?.metadata ?? {}) as Record<string, unknown>;
    const pendingFromTrial = (trial?.metadata as any)?.pendingCheckout;
    const pendingFromOrder =
      orderMeta.purchaseDto && orderMeta.quote
        ? {
            purchaseDto: orderMeta.purchaseDto,
            quote: orderMeta.quote,
            status: 'pending',
            orderId: confirm.orderId,
          }
        : null;
    const pending = pendingFromTrial ?? pendingFromOrder;

    if (
      !pending ||
      pending.status !== 'pending' ||
      String(pending.orderId) !== String(confirm.orderId)
    ) {
      throw new BadRequestException(
        'No matching pending payment order. Review billing and start payment again.',
      );
    }

    const verifyResult = await this.paymentsService.verifyPayment(
      { order_id: confirm.orderId },
      { id: sellerId, email: seller.email },
    );
    if (!verifyResult.success) {
      throw new BadRequestException(
        verifyResult.message ?? 'Payment not verified yet.',
      );
    }

    const dto = pending.purchaseDto as PurchaseTrialSubscriptionDto;
    const quoteResult = await this.quotePurchase(sellerId, dto);
    const quote = quoteResult.quote;
    const pkg = quoteResult.package;
    const paymentId =
      verifyResult.data?.transaction_id ??
      confirm.paymentId?.trim() ??
      confirm.transactionId?.trim() ??
      `SUB-PAY-${confirm.orderId}`;

    const isRenewal =
      seller.convertedToPaid ||
      seller.trialStatus === 'converted' ||
      (!seller.isTrial && seller.paymentStatus === 'paid');

    if (isRenewal) {
      return this.applyPaidRenewal({
        seller,
        trial,
        quote,
        pkg,
        paymentId,
        orderId: confirm.orderId,
      });
    }

    if (!trial) {
      throw new BadRequestException(
        'Trial record not found. Contact support to complete activation.',
      );
    }

    return this.applyPaidConversion({
      seller,
      trial,
      quote,
      pkg,
      paymentId,
      orderId: confirm.orderId,
    });
  }

  /**
   * @deprecated Direct purchase is blocked — use init + gateway confirm.
   */
  async purchaseSubscription(
    _sellerId: string,
    _dto: PurchaseTrialSubscriptionDto,
  ) {
    throw new BadRequestException(
      'Confirm billing details and complete payment via the payment gateway before activation.',
    );
  }

  private async applyPaidConversion(input: {
    seller: any;
    trial: any;
    quote: any;
    pkg: any;
    paymentId: string;
    orderId: string;
  }) {
    const { seller, trial, quote, pkg, paymentId, orderId } = input;
    const now = new Date();
    const endsAt = addDays(now, quote.durationDays);
    const packageName =
      (pkg as { name?: string }).name ??
      (quote.billingMode === 'single_gst' ? 'Single GST' : 'Subscription');

    seller.isTrial = true;
    seller.trialStatus = 'converted';
    seller.convertedToPaid = true;
    seller.convertedAt = now;
    seller.gstSlots = quote.gstSlots;
    seller.gstSlotsPurchased = quote.gstSlots;
    seller.allocatedPanSlots = quote.panSlots;
    seller.totalPanSlots = quote.panSlots;
    seller.marketplaceSlotsPurchased = Number(quote.marketplaceSlots ?? 0);
    seller.subscriptionPlanType = quote.planType ?? quote.billingMode;
    seller.reconciliationMonths = quote.selectedMonths;
    if (quote.billingMode === 'multi_gst_pan' && quote.panNumber) {
      if (Number(quote.panSlots ?? 1) <= 1) {
        seller.lockedPanNumber = quote.panNumber;
        seller.panNumber = quote.panNumber;
      } else {
        seller.lockedPanNumber = undefined;
        if (!seller.panNumber) {
          seller.panNumber = quote.panNumber;
        }
      }
    } else if (quote.billingMode === 'single_gst_multi_marketplace') {
      seller.lockedPanNumber = undefined;
      if (quote.panNumber && !seller.panNumber) {
        seller.panNumber = quote.panNumber;
      }
    } else if (
      quote.billingMode === 'single_gst' &&
      seller.panNumber
    ) {
      seller.lockedPanNumber = String(seller.panNumber).toUpperCase();
    }
    seller.durationYears = quote.durationDays / 365;
    seller.subscriptionDuration = quote.durationDays;
    seller.amount = quote.totalPayable;
    seller.paymentStatus = 'paid';
    seller.paymentAmount = quote.totalPayable;
    seller.paymentId = paymentId;
    seller.paymentCompletedAt = now;
    seller.paymentVerifiedAt = now;
    seller.subscriptionStartsAt = now;
    seller.subscriptionEndsAt = endsAt;
    seller.onboardingStatus = 'active';
    seller.accountStatus = 'active';
    await seller.save();

    const sellerId = String(seller._id);
    if (Array.isArray(quote.gstSelections) && quote.gstSelections.length) {
      await this.provisionCheckoutSelections(
        sellerId,
        quote.gstSelections as GstCheckoutSelection[],
      );
    }
    await this.ensureSellerSubscriptionRecord({
      sellerId,
      orderId,
      planId: (pkg as { _id?: Types.ObjectId })._id,
      subscriptionType: this.inferSubscriptionType(quote.durationDays),
      startDate: now,
      endDate: endsAt,
      trial: false,
    });

    trial.status = 'converted';
    trial.convertedToPaid = true;
    trial.convertedAt = now;
    trial.convertedSubscriptionId = paymentId;
    trial.metadata = {
      ...(trial.metadata ?? {}),
      packageId: String((pkg as { _id?: string })._id ?? ''),
      packageName,
      quote,
      pendingCheckout: {
        ...((trial.metadata as any)?.pendingCheckout ?? {}),
        status: 'paid',
        paidAt: now.toISOString(),
        paymentId,
        orderId,
      },
    };
    await trial.save();

    await this.history.record({
      sellerId,
      trialSubscriptionId: trial._id,
      event: 'subscription_purchased',
      message: `Converted to paid (${quote.billingMode}) for ${quote.monthCount} month(s): ${packageName}`,
      payload: { quote, paymentId, orderId },
    });

    await this.history.record({
      sellerId,
      trialSubscriptionId: trial._id,
      event: 'converted_to_paid',
      message: 'Trial seller converted to permanent seller. Data preserved.',
    });

    void this.emailService
      .sendEmail({
        to: seller.email,
        type: EmailType.SUBSCRIPTION,
        subject: 'Subscription Activated - EcommReco',
        payload: {
          name: seller.fullName,
          plan: packageName,
          amount: quote.totalPayable,
        },
      })
      .catch(() => undefined);

    return {
      success: true,
      status: 'converted',
      paymentId,
      orderId,
      quote,
      subscriptionStartsAt: now,
      subscriptionEndsAt: endsAt,
      message:
        'Payment confirmed. Your trial account is now a permanent seller. All data is preserved.',
    };
  }

  private async applyPaidRenewal(input: {
    seller: any;
    trial: any;
    quote: any;
    pkg: any;
    paymentId: string;
    orderId: string;
  }) {
    const { seller, trial, quote, pkg, paymentId, orderId } = input;
    const now = new Date();
    const packageName =
      (pkg as { name?: string }).name ??
      (quote.billingMode === 'single_gst' ? 'Single GST' : 'Subscription');

    const existingMonths = Array.isArray(seller.reconciliationMonths)
      ? seller.reconciliationMonths.map((m: string) => String(m).trim())
      : [];
    const mergedMonths = Array.from(
      new Set([...existingMonths, ...(quote.selectedMonths ?? [])]),
    ).sort();

    const currentEnd = seller.subscriptionEndsAt
      ? new Date(seller.subscriptionEndsAt)
      : now;
    const renewalBase =
      !Number.isNaN(currentEnd.getTime()) && currentEnd.getTime() > now.getTime()
        ? currentEnd
        : now;
    const endsAt = addDays(renewalBase, quote.durationDays);

    seller.reconciliationMonths = mergedMonths;
    seller.gstSlots = Math.max(Number(seller.gstSlots ?? 0), quote.gstSlots);
    seller.gstSlotsPurchased = Math.max(
      Number(seller.gstSlotsPurchased ?? 0),
      quote.gstSlots,
    );
    seller.allocatedPanSlots = Math.max(
      Number(seller.allocatedPanSlots ?? 0),
      quote.panSlots,
    );
    seller.totalPanSlots = Math.max(
      Number(seller.totalPanSlots ?? 0),
      quote.panSlots,
    );
    seller.marketplaceSlotsPurchased = Math.max(
      Number(seller.marketplaceSlotsPurchased ?? 0),
      Number(quote.marketplaceSlots ?? 0),
    );
    seller.subscriptionPlanType =
      quote.planType ?? quote.billingMode ?? seller.subscriptionPlanType;
    if (Number(quote.panSlots ?? 1) > 1) {
      seller.lockedPanNumber = undefined;
    }
    seller.amount = quote.totalPayable;
    seller.paymentStatus = 'paid';
    seller.paymentAmount = quote.totalPayable;
    seller.paymentId = paymentId;
    seller.paymentCompletedAt = now;
    seller.paymentVerifiedAt = now;
    seller.subscriptionStartsAt = seller.subscriptionStartsAt ?? now;
    seller.subscriptionEndsAt = endsAt;
    seller.onboardingStatus = 'active';
    seller.accountStatus = 'active';
    seller.trialStatus = seller.isTrial ? 'converted' : seller.trialStatus;
    seller.convertedToPaid = true;
    await seller.save();

    const sellerId = String(seller._id);
    if (Array.isArray(quote.gstSelections) && quote.gstSelections.length) {
      await this.provisionCheckoutSelections(
        sellerId,
        quote.gstSelections as GstCheckoutSelection[],
      );
    }
    await this.ensureSellerSubscriptionRecord({
      sellerId,
      orderId,
      planId: (pkg as { _id?: Types.ObjectId })._id,
      subscriptionType: this.inferSubscriptionType(quote.durationDays),
      startDate: seller.subscriptionStartsAt ?? now,
      endDate: endsAt,
      trial: false,
    });

    if (trial) {
      trial.metadata = {
        ...(trial.metadata ?? {}),
        pendingCheckout: {
          ...((trial.metadata as any)?.pendingCheckout ?? {}),
          status: 'paid',
          paidAt: now.toISOString(),
          paymentId,
          orderId,
        },
      };
      await trial.save();
    }

    await this.history.record({
      sellerId,
      trialSubscriptionId: trial?._id,
      event: 'subscription_renewed',
      message: `Subscription renewed for ${quote.monthCount} month(s): ${packageName}`,
      payload: { quote, paymentId, orderId, mergedMonths },
    });

    void this.emailService
      .sendEmail({
        to: seller.email,
        type: EmailType.SUBSCRIPTION,
        subject: 'Subscription Renewed - EcommReco',
        payload: {
          name: seller.fullName,
          plan: packageName,
          amount: quote.totalPayable,
          validUntil: endsAt.toISOString().slice(0, 10),
        },
      })
      .catch(() => undefined);

    return {
      success: true,
      status: 'renewed',
      paymentId,
      orderId,
      quote,
      subscriptionStartsAt: seller.subscriptionStartsAt,
      subscriptionEndsAt: endsAt,
      reconciliationMonths: mergedMonths,
      message: 'Payment confirmed. Your subscription has been renewed.',
    };
  }

  async adminSummary() {
    const [totals] = await this.trialModel
      .aggregate([
        {
          $group: {
            _id: null,
            totalTrials: { $sum: 1 },
            activeTrials: {
              $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
            },
            expiredTrials: {
              $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] },
            },
            convertedTrials: {
              $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] },
            },
            pendingPayment: {
              $sum: { $cond: [{ $eq: ['$status', 'pending_payment'] }, 1, 0] },
            },
            deletedTrials: {
              $sum: { $cond: [{ $eq: ['$status', 'data_deleted'] }, 1, 0] },
            },
            revenueFromTrial: {
              $sum: {
                $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$totalPayable', 0],
              },
            },
          },
        },
      ])
      .exec();

    return (
      totals ?? {
        totalTrials: 0,
        activeTrials: 0,
        expiredTrials: 0,
        convertedTrials: 0,
        pendingPayment: 0,
        deletedTrials: 0,
        revenueFromTrial: 0,
      }
    );
  }

  async adminList(query: ListTrialsQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const match: Record<string, unknown> = {};

    if (query.status) match.status = query.status;
    if (query.paymentStatus) match.paymentStatus = query.paymentStatus;
    if (query.converted === 'true') match.convertedToPaid = true;
    if (query.converted === 'false') match.convertedToPaid = false;

    if (query.dateFrom || query.dateTo) {
      const range: Record<string, Date> = {};
      if (query.dateFrom) range.$gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
      }
      match.createdAt = range;
    }

    if (query.search?.trim()) {
      const regex = {
        $regex: query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
      match.$or = [
        { companyName: regex },
        { ownerName: regex },
        { email: regex },
        { mobile: regex },
        { panNumber: regex },
        { gstNumber: regex },
      ];
    }

    const [rows, total] = await Promise.all([
      this.trialModel
        .find(match)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.trialModel.countDocuments(match).exec(),
    ]);

    const data = rows.map((row) => ({
      ...row,
      daysRemaining: row.trialEnd
        ? Math.max(
            0,
            Math.ceil(
              (new Date(row.trialEnd).getTime() - Date.now()) /
                (24 * 60 * 60 * 1000),
            ),
          )
        : null,
    }));

    return { data, total, page, limit };
  }

  async adminDetail(trialId: string) {
    const trial = await this.trialModel.findById(trialId).lean().exec();
    if (!trial) throw new NotFoundException('Trial not found');
    const seller = await this.sellerModel
      .findById(trial.sellerId)
      .select('-password')
      .lean()
      .exec();
    const timeline = await this.history.listForSeller(String(trial.sellerId));
    return { trial, seller, timeline };
  }

  async adminExtend(trialId: string, dto: AdminTrialActionDto, actorId?: string) {
    const days = Math.max(1, Number(dto.extendDays ?? 7));
    const trial = await this.trialModel.findById(trialId).exec();
    if (!trial) throw new NotFoundException('Trial not found');
    const seller = await this.requireSeller(String(trial.sellerId));

    const base = trial.trialEnd && trial.trialEnd > new Date()
      ? new Date(trial.trialEnd)
      : new Date();
    const nextEnd = addDays(base, days);
    trial.trialEnd = nextEnd;
    trial.status = 'active';
    trial.cleanupDate = addDays(nextEnd, TRIAL_DATA_RETENTION_DAYS);
    await trial.save();

    seller.trialStatus = 'active';
    seller.trialEnd = nextEnd;
    seller.cleanupDate = trial.cleanupDate;
    seller.subscriptionEndsAt = nextEnd;
    await seller.save();

    await this.history.record({
      sellerId: seller._id,
      trialSubscriptionId: trial._id,
      event: 'trial_extended',
      message: `Trial extended by ${days} day(s)`,
      actorId,
      actorRole: 'super_admin',
    });

    return { success: true, trialEnd: nextEnd };
  }

  async adminEndTrial(trialId: string, actorId?: string) {
    const trial = await this.trialModel.findById(trialId).exec();
    if (!trial) throw new NotFoundException('Trial not found');
    if (
      trial.status === 'expired' ||
      trial.status === 'data_deleted' ||
      trial.status === 'suspended'
    ) {
      throw new BadRequestException(
        `Trial is already ${String(trial.status).replace(/_/g, ' ')}.`,
      );
    }
    const seller = await this.requireSeller(String(trial.sellerId));
    const now = new Date();

    trial.status = 'expired';
    trial.trialEnd = now;
    trial.cleanupDate = addDays(now, TRIAL_DATA_RETENTION_DAYS);
    await trial.save();

    seller.trialStatus = 'expired';
    seller.trialEnd = now;
    seller.cleanupDate = trial.cleanupDate;
    await seller.save();

    await this.history.record({
      sellerId: seller._id,
      trialSubscriptionId: trial._id,
      event: 'trial_ended',
      message: 'Trial ended by admin',
      actorId,
      actorRole: 'super_admin',
    });

    return { success: true };
  }

  async adminSuspend(trialId: string, dto: AdminTrialActionDto, actorId?: string) {
    const trial = await this.trialModel.findById(trialId).exec();
    if (!trial) throw new NotFoundException('Trial not found');
    const seller = await this.requireSeller(String(trial.sellerId));

    trial.status = 'suspended';
    await trial.save();
    await this.sellerModel.updateOne(
      { _id: seller._id },
      {
        $set: {
          trialStatus: 'suspended',
          accountStatus: 'suspended',
          accountStatusReason: String(dto.reason ?? '').trim(),
          accountStatusUpdatedAt: new Date(),
        },
      },
    );

    await this.history.record({
      sellerId: seller._id,
      trialSubscriptionId: trial._id,
      event: 'trial_suspended',
      message: dto.reason ?? 'Trial suspended by admin',
      actorId,
      actorRole: 'super_admin',
    });

    return { success: true };
  }

  async expireDueTrials() {
    const now = new Date();
    const due = await this.trialModel
      .find({
        status: 'active',
        trialEnd: { $lte: now },
      })
      .exec();

    let expired = 0;
    for (const trial of due) {
      trial.status = 'expired';
      if (!trial.cleanupDate) {
        trial.cleanupDate = addDays(now, TRIAL_DATA_RETENTION_DAYS);
      }
      await trial.save();
      await this.sellerModel.updateOne(
        { _id: trial.sellerId },
        {
          $set: {
            trialStatus: 'expired',
            trialEnd: trial.trialEnd ?? now,
            cleanupDate: trial.cleanupDate,
          },
        },
      );
      await this.history.record({
        sellerId: trial.sellerId,
        trialSubscriptionId: trial._id,
        event: 'trial_expired',
        message: 'Trial expired automatically',
      });
      expired += 1;
    }
    return { expired };
  }

  async cleanupDueTrials() {
    const now = new Date();
    const due = await this.trialModel
      .find({
        status: { $in: ['expired', 'suspended'] },
        convertedToPaid: false,
        dataDeleted: false,
        cleanupDate: { $lte: now },
      })
      .exec();

    let cleaned = 0;
    for (const trial of due) {
      await this.deleteTrialBusinessData(String(trial.sellerId), String(trial._id));
      cleaned += 1;
    }
    return { cleaned };
  }

  async deleteTrialBusinessData(sellerId: string, trialSubscriptionId: string) {
    const log = await this.cleanupLogModel.create({
      sellerId: new Types.ObjectId(sellerId),
      trialSubscriptionId: new Types.ObjectId(trialSubscriptionId),
      jobType: 'trial_data_cleanup',
      status: 'started',
    });

    const deletedCounts: Record<string, number> = {};
    try {
      const db = this.connection.db!;
      const sellerAliases = [sellerId];
      const sellerObjectIds = Types.ObjectId.isValid(sellerId)
        ? [new Types.ObjectId(sellerId)]
        : [];
      const sellerFilter = {
        $or: [
          { sellerId: { $in: sellerAliases } },
          ...(sellerObjectIds.length
            ? [{ sellerId: { $in: sellerObjectIds } }]
            : []),
        ],
      };

      // Uploaded / operational business data for this seller only.
      // Keep seller + trial identity (email/mobile/PAN/GST) for reuse blocking.
      const collections = [
        'import_rows',
        'uploads',
        'normalized_transactions',
        'amazon_payment_transactions',
        'flipkart_payment_order_reports',
        'meesho_order_payments',
        'meesho_ads_cost',
        'meesho_referral_payments',
        'meesho_compensation_recovery',
        'import_sessions',
        'import_jobs',
        'settlement_summaries',
        'marketplaces',
        'gsts',
      ];

      for (const name of collections) {
        try {
          const result = await db.collection(name).deleteMany(sellerFilter);
          deletedCounts[name] = result.deletedCount ?? 0;
        } catch {
          deletedCounts[name] = 0;
        }
      }

      await this.trialModel.updateOne(
        { _id: trialSubscriptionId },
        {
          $set: {
            status: 'data_deleted',
            dataDeleted: true,
            dataDeletedAt: new Date(),
          },
        },
      );

      await this.sellerModel.updateOne(
        { _id: sellerId },
        {
          $set: {
            trialStatus: 'data_deleted',
            trialDataDeleted: true,
            trialDataDeletedAt: new Date(),
            panProfiles: [],
            gstSlotsUsed: 0,
            usedPanSlots: 0,
          },
        },
      );

      log.status = 'completed';
      log.deletedCounts = deletedCounts;
      log.completedAt = new Date();
      await log.save();

      await this.history.record({
        sellerId,
        trialSubscriptionId,
        event: 'data_deleted',
        message:
          'Trial business data deleted (GSTs, marketplaces, imports). Identity retained to block trial reuse.',
        payload: deletedCounts,
      });

      return deletedCounts;
    } catch (error) {
      log.status = 'failed';
      log.errorMessage =
        error instanceof Error ? error.message : String(error);
      await log.save();
      throw error;
    }
  }

  async adminDeleteTrialData(trialId: string, actorId?: string) {
    const trial = await this.trialModel.findById(trialId).exec();
    if (!trial) throw new NotFoundException('Trial not found');
    if (trial.dataDeleted || trial.status === 'data_deleted') {
      throw new BadRequestException('Trial data has already been deleted.');
    }
    const deletedCounts = await this.deleteTrialBusinessData(
      String(trial.sellerId),
      String(trial._id),
    );
    await this.history.record({
      sellerId: trial.sellerId,
      trialSubscriptionId: trial._id,
      event: 'data_deleted_by_admin',
      message: 'Trial data deleted by admin',
      actorId,
      actorRole: 'super_admin',
      payload: deletedCounts,
    });
    return { success: true, deletedCounts };
  }

  async sendExpiryReminders() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const active = await this.trialModel
      .find({ status: 'active', trialEnd: { $exists: true } })
      .lean()
      .exec();

    let sent = 0;
    for (const trial of active) {
      if (!trial.trialEnd) continue;
      const daysLeft = Math.ceil(
        (new Date(trial.trialEnd).getTime() - now) / dayMs,
      );
      if (daysLeft !== 3 && daysLeft !== 1) continue;
      void this.emailService
        .sendEmail({
          to: trial.email,
          type: EmailType.NOTIFICATION,
          subject:
            daysLeft === 1
              ? 'Your EcommReco Trial Expires Tomorrow'
              : 'Your EcommReco Trial Expires in 3 Days',
          payload: {
            name: trial.ownerName,
            daysLeft,
            trialEnd: new Date(trial.trialEnd).toISOString().slice(0, 10),
          },
        })
        .catch(() => undefined);
      sent += 1;
    }
    return { sent };
  }

  private buildTrialPaymentLink(sellerId: string) {
    const base =
      process.env.TRIAL_PAYMENT_BASE_URL ||
      process.env.PAYMENT_BASE_URL ||
      'https://payments.sellerinsights.com/checkout';
    return `${base}?type=trial&sellerId=${encodeURIComponent(sellerId)}&amount=${computeTrialPayable().totalPayable}`;
  }

  private buildSubscriptionPaymentLink(
    sellerId: string,
    orderId: string,
    amount: number,
  ) {
    const base =
      process.env.SUBSCRIPTION_PAYMENT_BASE_URL ||
      process.env.PAYMENT_BASE_URL ||
      process.env.TRIAL_PAYMENT_BASE_URL ||
      'https://payments.sellerinsights.com/checkout';
    return `${base}?type=subscription&sellerId=${encodeURIComponent(sellerId)}&orderId=${encodeURIComponent(orderId)}&amount=${encodeURIComponent(String(amount))}`;
  }

  /**
   * Trial registration stores GSTIN on the seller but does not create a Gst
   * document. After payment (or for already-active trials), provision that GST
   * so GST Management is usable with the single trial slot.
   */
  async ensureTrialGstProvisioned(seller: SellerDocument) {
    if (
      seller.trialDataDeleted ||
      seller.trialStatus === 'data_deleted' ||
      seller.trialStatus === 'expired' ||
      seller.trialStatus === 'suspended'
    ) {
      return;
    }
    const sellerId = String(seller._id);
    const gstNumber = String(seller.gstNumber ?? '')
      .trim()
      .toUpperCase();
    if (!gstNumber) return;

    const existing = await this.gstModel
      .findOne({
        sellerId,
        gstNumber,
      })
      .select('_id')
      .lean()
      .exec();
    if (existing) {
      await this.syncTrialSlotUsage(seller, gstNumber);
      return;
    }

    const panFromGst =
      gstNumber.length >= 12 ? gstNumber.slice(2, 12) : '';
    const panNumber = String(seller.panNumber ?? panFromGst)
      .trim()
      .toUpperCase();
    if (!panNumber) return;

    try {
      await this.gstModel.create({
        sellerId,
        gstNumber,
        panNumber,
        businessName: seller.firmName?.trim() || seller.fullName?.trim(),
        tradeName: seller.firmName?.trim() || seller.fullName?.trim(),
        state: seller.state?.trim() || undefined,
        status: 'active',
        verifiedAt: new Date(),
      });
    } catch (error) {
      // Another request may have created it concurrently.
      const dup = await this.gstModel
        .findOne({ sellerId, gstNumber })
        .select('_id')
        .lean()
        .exec();
      if (!dup) {
        this.logger.warn(
          `Failed to provision trial GST for seller ${sellerId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    }

    await this.syncTrialSlotUsage(seller, gstNumber);
  }

  private async syncTrialSlotUsage(seller: SellerDocument, gstNumber: string) {
    const panFromGst =
      gstNumber.length >= 12 ? gstNumber.slice(2, 12) : '';
    const panNumber = String(seller.panNumber ?? panFromGst)
      .trim()
      .toUpperCase();
    if (!panNumber) return;

    const profiles = Array.isArray(seller.panProfiles)
      ? [...seller.panProfiles]
      : [];
    const hasPan = profiles.some(
      (p) => String(p.panNumber ?? '').trim().toUpperCase() === panNumber,
    );
    if (!hasPan) {
      profiles.push({
        panNumber,
        businessName: seller.firmName?.trim() || seller.fullName?.trim(),
        createdAt: new Date(),
      });
    }

    seller.panProfiles = profiles;
    seller.usedPanSlots = Math.max(1, Number(seller.usedPanSlots ?? 0));
    seller.gstSlotsUsed = Math.max(1, Number(seller.gstSlotsUsed ?? 0));
    seller.gstSlots = Math.max(
      Number(seller.gstSlots ?? 0),
      TRIAL_GST_SLOTS,
    );
    seller.gstSlotsPurchased = Math.max(
      Number(seller.gstSlotsPurchased ?? 0),
      TRIAL_GST_SLOTS,
    );
    seller.allocatedPanSlots = Math.max(
      Number(seller.allocatedPanSlots ?? 0),
      TRIAL_PAN_SLOTS,
    );
    seller.totalPanSlots = Math.max(
      Number(seller.totalPanSlots ?? 0),
      TRIAL_PAN_SLOTS,
    );
    await seller.save();
  }

  private async requireSeller(sellerId: string) {
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) throw new NotFoundException('Seller not found');
    return seller;
  }

  private async requireTrialBySeller(sellerId: string) {
    const trial = await this.trialModel
      .findOne({ sellerId: new Types.ObjectId(sellerId) })
      .exec();
    if (!trial) throw new NotFoundException('Trial subscription not found');
    return trial;
  }
}
