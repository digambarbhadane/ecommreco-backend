import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildPaymentNotifyUrl,
  buildPaymentReturnUrl,
} from '../config/payment-urls';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  SubscriptionPackage,
  SubscriptionPackageDocument,
} from '../subscription/schemas/subscription-package.schema';
import { CreatePaymentOrderDto } from './dto/create-order.dto';
import {
  CancelSubscriptionDto,
  RenewSubscriptionDto,
  RefundPaymentDto,
  VerifyPaymentDto,
} from './dto/payment.dto';
import type {
  GatewayPaymentStatus,
  PaymentGateway,
} from './gateways/payment-gateway.interface';
import { PAYMENT_GATEWAY } from './gateways/payment-gateway.interface';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentInvoiceService } from './payment-invoice.service';
import { PaymentLogService } from './payment-log.service';
import { PaymentPricingService } from './payment-pricing.service';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from './schemas/payment-order.schema';
import {
  PaymentTransaction,
  PaymentTransactionDocument,
} from './schemas/payment-transaction.schema';
import {
  SellerSubscription,
  SellerSubscriptionDocument,
} from './schemas/seller-subscription.schema';
import { Coupon, CouponDocument } from './schemas/coupon.schema';

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
};

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrderDocument>,
    @InjectModel(PaymentTransaction.name)
    private readonly transactionModel: Model<PaymentTransactionDocument>,
    @InjectModel(SellerSubscription.name)
    private readonly subscriptionModel: Model<SellerSubscriptionDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: PaymentGateway,
    private readonly pricingService: PaymentPricingService,
    private readonly activationService: PaymentActivationService,
    private readonly invoiceService: PaymentInvoiceService,
    private readonly paymentLog: PaymentLogService,
    private readonly config: ConfigService,
  ) {}

  async listPlans() {
    const plans = await this.packageModel
      .find({ isActive: true })
      .sort({ durationInDays: 1 })
      .lean()
      .exec();
    return { success: true, data: plans };
  }

  async createOrder(dto: CreatePaymentOrderDto, user?: RequestUser) {
    const seller = await this.resolveSeller(user);
    return this.createOrderForSeller(String(seller._id), dto, user);
  }

  async createOrderForSeller(
    sellerId: string,
    dto: CreatePaymentOrderDto,
    user?: RequestUser,
  ) {
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    if (dto.idempotency_key) {
      const existing = await this.orderModel
        .findOne({
          sellerId,
          idempotencyKey: dto.idempotency_key,
          paymentStatus: { $in: ['pending', 'processing'] },
        })
        .exec();
      if (existing?.paymentSessionId) {
        const gatewayStatus = await this.gateway.getOrderStatus(existing.orderId);
        if (
          gatewayStatus.paymentStatus === 'pending' ||
          gatewayStatus.paymentStatus === 'paid'
        ) {
          return {
            success: true,
            data: {
              order_id: existing.orderId,
              payment_session_id: existing.paymentSessionId,
              total_amount: existing.totalAmount,
            },
            message: 'Existing pending order returned',
          };
        }

        existing.paymentStatus =
          gatewayStatus.paymentStatus === 'failed' ? 'failed' : 'expired';
        existing.orderStatus =
          gatewayStatus.paymentStatus === 'failed' ? 'failed' : 'expired';
        await existing.save();
      }
    }

    const metadata = dto.metadata ?? {};
    let plan: SubscriptionPackageDocument;
    let pricing: {
      baseAmount: number;
      discountAmount: number;
      gstPercentage: number;
      gstAmount: number;
      totalAmount: number;
      couponCode?: string;
    };

    const quoteOverride = metadata.quote as
      | {
          totalPayable?: number;
          basePrice?: number;
          gstAmount?: number;
          gstPercentage?: number;
        }
      | undefined;

    if (quoteOverride?.totalPayable) {
      const pkg = await this.packageModel
        .findOne({ _id: dto.plan_id, isActive: true })
        .exec();
      if (!pkg) {
        throw new BadRequestException('Subscription plan not found or inactive');
      }
      plan = pkg;
      const gstPercentage = quoteOverride.gstPercentage ?? pkg.gstPercentage ?? 18;
      pricing = {
        baseAmount: quoteOverride.basePrice ?? quoteOverride.totalPayable,
        discountAmount: 0,
        gstPercentage,
        gstAmount: quoteOverride.gstAmount ?? 0,
        totalAmount: Math.round(quoteOverride.totalPayable),
        couponCode: dto.coupon_code,
      };
    } else {
      const calculated = await this.pricingService.calculateForPlan({
        planId: dto.plan_id,
        sellerId,
        couponCode: dto.coupon_code,
        gstSlots: metadata.gstSlots as number | undefined,
        durationDays: metadata.durationDays as number | undefined,
      });
      plan = calculated.plan;
      pricing = calculated.pricing;
    }

    if (plan.isTrial) {
      const priorTrial = await this.subscriptionModel
        .findOne({ sellerId, trial: true })
        .lean()
        .exec();
      if (priorTrial) {
        throw new BadRequestException(
          'Trial plan can only be used once per organisation',
        );
      }
    }

    const orderId = `ECO-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const checkoutType = metadata.checkoutType as string | undefined;
    const returnPath =
      checkoutType === 'trial_registration'
        ? `/trial/payment/${sellerId}?order_id=${orderId}`
        : `/payment/success?order_id=${orderId}`;

    const gatewayResult = await this.gateway.createOrder({
      orderId,
      amount: pricing.totalAmount,
      customerId: sellerId,
      customerEmail: seller.email,
      customerPhone: seller.contactNumber || '9999999999',
      returnUrl: buildPaymentReturnUrl(this.config, returnPath),
      notifyUrl: buildPaymentNotifyUrl(this.config),
      metadata: { seller_id: sellerId, plan_id: dto.plan_id },
    });

    const order = await this.orderModel.create({
      sellerId,
      organisationId: sellerId,
      subscriptionPlanId: plan._id,
      orderId,
      cashfreeOrderId: gatewayResult.cashfreeOrderId,
      paymentSessionId: gatewayResult.paymentSessionId,
      paymentGateway: this.gateway.name,
      currency: 'INR',
      baseAmount: pricing.baseAmount,
      discountAmount: pricing.discountAmount,
      gstPercentage: pricing.gstPercentage,
      gstAmount: pricing.gstAmount,
      totalAmount: pricing.totalAmount,
      paymentStatus: 'pending',
      orderStatus: 'active',
      couponCode: pricing.couponCode,
      idempotencyKey: dto.idempotency_key,
      metadata: {
        ...metadata,
        planName: plan.name,
        durationDays: metadata.durationDays ?? plan.durationInDays,
        gstSlots: metadata.gstSlots ?? plan.gstSlots ?? 1,
        panSlots: metadata.panSlots ?? plan.panSlots ?? 1,
        isTrial: plan.isTrial ?? false,
      },
      createdBy: user?.email ?? user?.id,
    });

    await this.paymentLog.log({
      eventType: 'api_call',
      orderId,
      sellerId,
      gateway: this.gateway.name,
      message: 'Payment order created',
      request: { planId: dto.plan_id, pricing },
      response: gatewayResult.raw,
      success: true,
    });

    return {
      success: true,
      data: {
        order_id: order.orderId,
        payment_session_id: order.paymentSessionId,
        total_amount: order.totalAmount,
        currency: order.currency,
      },
      message: 'Payment order created successfully',
    };
  }

  async verifyPayment(dto: VerifyPaymentDto, user?: RequestUser) {
    const seller = await this.resolveSeller(user);
    const order = await this.orderModel
      .findOne({ orderId: dto.order_id, sellerId: String(seller._id) })
      .exec();
    if (!order) {
      throw new NotFoundException('Payment order not found');
    }

    if (order.paymentStatus === 'paid') {
      const subscription = await this.subscriptionModel
        .findOne({ paymentOrderId: order._id })
        .lean()
        .exec();
      const invoice = await this.invoiceService.getInvoiceForSeller(
        String(seller._id),
        `INV-${order.orderId}`,
      );
      return {
        success: true,
        data: {
          payment_status: 'paid',
          order_id: order.orderId,
          subscription,
          already_verified: true,
        },
        message: 'Payment already verified',
      };
    }

    const status = await this.pollGatewayPaymentStatus(order.orderId);
    await this.paymentLog.log({
      eventType: 'verification',
      orderId: order.orderId,
      sellerId: order.sellerId,
      gateway: this.gateway.name,
      response: status.raw,
      success: status.paymentStatus === 'paid',
    });

    if (status.paymentStatus !== 'paid') {
      if (status.paymentStatus === 'failed') {
        order.paymentStatus = 'failed';
        order.orderStatus = 'failed';
        await order.save();
      } else if (status.paymentStatus === 'expired') {
        order.paymentStatus = 'expired';
        order.orderStatus = 'expired';
        await order.save();
      }
      const message =
        status.paymentStatus === 'expired'
          ? 'Payment session expired. Please start payment again.'
          : 'Payment not completed yet. Please wait or retry.';
      return {
        success: false,
        data: {
          payment_status: status.paymentStatus,
          order_id: order.orderId,
        },
        message,
      };
    }

    const checkoutType = (order.metadata as Record<string, unknown>)
      ?.checkoutType;
    if (
      checkoutType === 'trial_upgrade' ||
      checkoutType === 'trial_registration' ||
      checkoutType === 'subscription_renewal'
    ) {
      order.paymentStatus = 'paid';
      order.orderStatus = 'paid';
      order.paidAt = new Date();
      if (status.paymentMethod) {
        order.paymentMethod = status.paymentMethod;
      }
      await order.save();
      return {
        success: true,
        data: {
          payment_status: 'paid',
          order_id: order.orderId,
          transaction_id: status.cashfreePaymentId,
          skip_activation: true,
        },
        message: 'Payment verified',
      };
    }

    const result = await this.activationService.activateFromVerifiedPayment({
      order,
      cashfreePaymentId: status.cashfreePaymentId,
      paymentMethod: status.paymentMethod,
      bankReference: status.bankReference,
      utrNumber: status.utrNumber,
      gatewayResponse: status.raw,
      activatedBy: user?.email ?? user?.id,
    });

    return {
      success: true,
      data: {
        payment_status: 'paid',
        order_id: order.orderId,
        transaction_id: status.cashfreePaymentId,
        invoice_number: result.invoice?.invoiceNumber,
        subscription: result.subscription,
      },
      message: 'Payment verified and subscription activated',
    };
  }

  async getPaymentHistory(user?: RequestUser, page = 1, limit = 20) {
    const seller = await this.resolveSeller(user);
    const sellerId = String(seller._id);
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));

    const [orders, total] = await Promise.all([
      this.orderModel
        .find({ sellerId })
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean()
        .exec(),
      this.orderModel.countDocuments({ sellerId }).exec(),
    ]);

    const orderIds = orders.map((o) => o._id);
    const transactions = await this.transactionModel
      .find({ paymentOrderId: { $in: orderIds } })
      .lean()
      .exec();
    const txnByOrder = new Map(
      transactions.map((t) => [String(t.paymentOrderId), t]),
    );

    const items = orders.map((order) => ({
      ...order,
      transaction: txnByOrder.get(String(order._id)) ?? null,
    }));

    return {
      success: true,
      data: { items, total, page: safePage, limit: safeLimit },
    };
  }

  async getCurrentSubscription(user?: RequestUser) {
    const seller = await this.resolveSeller(user);
    const sellerId = String(seller._id);

    const subscription = await this.subscriptionModel
      .findOne({ sellerId, status: 'active' })
      .sort({ endDate: -1 })
      .populate('planId')
      .lean()
      .exec();

    const daysRemaining = subscription?.endDate
      ? Math.max(
          0,
          Math.ceil(
            (new Date(subscription.endDate).getTime() - Date.now()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

    return {
      success: true,
      data: {
        subscription,
        seller: {
          paymentStatus: seller.paymentStatus,
          subscriptionStartsAt: seller.subscriptionStartsAt,
          subscriptionEndsAt: seller.subscriptionEndsAt,
          gstSlots: seller.gstSlots,
          panSlots: seller.totalPanSlots,
          onboardingStatus: seller.onboardingStatus,
        },
        daysRemaining,
        modulesEnabled: (() => {
          const plan = subscription?.planId;
          if (plan && typeof plan === 'object' && 'enabledModules' in plan) {
            const modules = (plan as { enabledModules?: string[] }).enabledModules;
            return Array.isArray(modules) ? modules : [];
          }
          return [];
        })(),
      },
    };
  }

  async renewSubscription(dto: RenewSubscriptionDto, user?: RequestUser) {
    return this.createOrder(
      {
        plan_id: dto.plan_id,
        coupon_code: dto.coupon_code,
        idempotency_key: `renew-${Date.now()}`,
      },
      user,
    );
  }

  async cancelSubscription(dto: CancelSubscriptionDto, user?: RequestUser) {
    const seller = await this.resolveSeller(user);
    const subscription = await this.subscriptionModel
      .findOne({ sellerId: String(seller._id), status: 'active' })
      .sort({ endDate: -1 })
      .exec();
    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    subscription.status = 'cancelled';
    subscription.autoRenew = false;
    subscription.metadata = {
      ...(subscription.metadata ?? {}),
      cancelReason: dto.reason,
      cancelledAt: new Date().toISOString(),
    };
    await subscription.save();

    return {
      success: true,
      data: subscription,
      message: 'Subscription cancelled. Access continues until end date.',
    };
  }

  async refundPayment(dto: RefundPaymentDto, user?: RequestUser) {
    const order = await this.orderModel
      .findOne({ orderId: dto.order_id })
      .exec();
    if (!order) {
      throw new NotFoundException('Payment order not found');
    }
    if (order.paymentStatus !== 'paid') {
      throw new BadRequestException('Only paid orders can be refunded');
    }

    const refundId = `REF-${Date.now()}`;
    const amount = dto.amount ?? order.totalAmount;
    const result = await this.gateway.createRefund({
      orderId: order.orderId,
      refundId,
      amount,
      reason: dto.reason,
    });

    order.paymentStatus = 'refunded';
    await order.save();

    await this.subscriptionModel.updateMany(
      { paymentOrderId: order._id, status: 'active' },
      { $set: { status: 'cancelled' } },
    );

    await this.paymentLog.log({
      eventType: 'refund',
      orderId: order.orderId,
      sellerId: order.sellerId,
      message: `Refund initiated: ${refundId}`,
      response: result.raw,
      success: true,
    });

    return {
      success: true,
      data: { refund_id: refundId, status: result.status },
      message: 'Refund initiated successfully',
    };
  }

  async getAdminDashboard() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const renewalWindowEnd = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );
    const paidSellerStatuses = ['paid', 'payment_completed'];

    const paidRevenueWindowMatch = (from: Date) => ({
      paymentStatus: 'paid',
      $or: [
        { paidAt: { $gte: from } },
        {
          $and: [
            { $or: [{ paidAt: { $exists: false } }, { paidAt: null }] },
            { updatedAt: { $gte: from } },
          ],
        },
      ],
    });

    const activeSellerSubscriptionFilter = {
      subscriptionEndsAt: { $gt: now },
      $or: [
        { paymentStatus: { $in: paidSellerStatuses } },
        { trialStatus: { $in: ['active', 'converted'] } },
      ],
    };

    const expiredSellerSubscriptionFilter = {
      subscriptionEndsAt: { $lte: now, $ne: null },
      $or: [
        { paymentStatus: { $in: paidSellerStatuses } },
        { trialStatus: { $in: ['active', 'converted', 'expired'] } },
        { convertedToPaid: true },
      ],
    };

    const [
      totalRevenue,
      successfulPayments,
      failedPayments,
      pendingPayments,
      processingPayments,
      refunds,
      activeSubscriptionsFromTable,
      expiredSubscriptionsFromTable,
      subscriptionTrialUsers,
      renewalDueFromTable,
      monthlyRevenue,
      yearlyRevenue,
      recentOrders,
      activeTrialSellers,
      pendingTrialPayments,
      paidTrialRevenue,
      activeSubscriptionsFromSellers,
      expiredSubscriptionsFromSellers,
      renewalDueFromSellers,
    ] = await Promise.all([
      this.orderModel
        .aggregate([
          { $match: { paymentStatus: 'paid' } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ])
        .exec(),
      this.orderModel.countDocuments({ paymentStatus: 'paid' }).exec(),
      this.orderModel.countDocuments({ paymentStatus: 'failed' }).exec(),
      this.orderModel.countDocuments({ paymentStatus: 'pending' }).exec(),
      this.orderModel.countDocuments({ paymentStatus: 'processing' }).exec(),
      this.orderModel
        .countDocuments({
          paymentStatus: { $in: ['refunded', 'partially_refunded'] },
        })
        .exec(),
      this.subscriptionModel.countDocuments({ status: 'active' }).exec(),
      this.subscriptionModel.countDocuments({ status: 'expired' }).exec(),
      this.subscriptionModel
        .countDocuments({ trial: true, status: 'active' })
        .exec(),
      this.subscriptionModel
        .countDocuments({
          status: 'active',
          endDate: { $gte: now, $lte: renewalWindowEnd },
        })
        .exec(),
      this.orderModel
        .aggregate([
          { $match: paidRevenueWindowMatch(monthStart) },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ])
        .exec(),
      this.orderModel
        .aggregate([
          { $match: paidRevenueWindowMatch(yearStart) },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ])
        .exec(),
      this.orderModel
        .find()
        .sort({ createdAt: -1 })
        .limit(25)
        .lean()
        .exec(),
      this.sellerModel
        .countDocuments({
          isTrial: true,
          trialStatus: 'active',
          subscriptionEndsAt: { $gt: now },
        })
        .exec(),
      this.sellerModel
        .countDocuments({ isTrial: true, trialStatus: 'pending_payment' })
        .exec(),
      this.orderModel
        .aggregate([
          {
            $match: {
              paymentStatus: 'paid',
              'metadata.checkoutType': {
                $in: [
                  'trial_registration',
                  'trial_upgrade',
                  'onboarding_trial',
                ],
              },
            },
          },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ])
        .exec(),
      this.sellerModel
        .countDocuments(activeSellerSubscriptionFilter as never)
        .exec(),
      this.sellerModel
        .countDocuments(expiredSellerSubscriptionFilter as never)
        .exec(),
      this.sellerModel
        .countDocuments({
          subscriptionEndsAt: { $gte: now, $lte: renewalWindowEnd },
          $or: [
            { paymentStatus: { $in: paidSellerStatuses } },
            { trialStatus: { $in: ['active', 'converted'] } },
          ],
        } as never)
        .exec(),
    ]);

    const sellerIds = Array.from(
      new Set(
        recentOrders
          .map((order) => String(order.sellerId ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    );
    const sellerObjectIds = sellerIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const sellers = sellerObjectIds.length
      ? await this.sellerModel
          .find({ _id: { $in: sellerObjectIds } })
          .select('firmName fullName email')
          .lean()
          .exec()
      : [];
    const sellerById = new Map(
      sellers.map((seller) => [String(seller._id), seller]),
    );

    const recentPayments = recentOrders.map((order) => {
      const seller = sellerById.get(String(order.sellerId));
      const metadata = (order.metadata ?? {}) as Record<string, unknown>;
      const paidAt =
        (order as { paidAt?: Date }).paidAt ??
        (order.paymentStatus === 'paid'
          ? (order as { updatedAt?: Date }).updatedAt
          : null);

      return {
        orderId: order.orderId,
        sellerId: String(order.sellerId ?? ''),
        sellerName:
          seller?.firmName?.trim() ||
          seller?.fullName?.trim() ||
          seller?.email ||
          'Unknown seller',
        sellerEmail: seller?.email ?? '',
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        checkoutType: String(metadata.checkoutType ?? 'subscription'),
        paymentMethod: order.paymentMethod ?? null,
        createdAt:
          (order as { createdAt?: Date }).createdAt?.toISOString?.() ??
          (order as { createdAt?: Date }).createdAt ??
          null,
        paidAt: paidAt
          ? paidAt instanceof Date
            ? paidAt.toISOString()
            : paidAt
          : null,
      };
    });

    return {
      success: true,
      data: {
        totalRevenue: totalRevenue[0]?.total ?? 0,
        successfulPayments,
        failedPayments,
        pendingPayments,
        processingPayments,
        refunds,
        activeSubscriptions: Math.max(
          activeSubscriptionsFromTable,
          activeSubscriptionsFromSellers,
        ),
        expiredSubscriptions: Math.max(
          expiredSubscriptionsFromTable,
          expiredSubscriptionsFromSellers,
        ),
        trialUsers: Math.max(activeTrialSellers, subscriptionTrialUsers),
        pendingTrialPayments,
        trialRevenue: paidTrialRevenue[0]?.total ?? 0,
        renewalDue: Math.max(renewalDueFromTable, renewalDueFromSellers),
        monthlyRevenue: monthlyRevenue[0]?.total ?? 0,
        yearlyRevenue: yearlyRevenue[0]?.total ?? 0,
        recentPayments,
      },
    };
  }

  async verifyPaymentByOrderId(orderId: string) {
    const order = await this.orderModel.findOne({ orderId }).exec();
    if (!order) {
      throw new NotFoundException('Payment order not found');
    }
    return this.verifyPayment({ order_id: orderId }, { id: order.sellerId });
  }

  async getOrderById(orderId: string) {
    return this.orderModel.findOne({ orderId }).lean().exec();
  }

  async downloadInvoice(invoiceNumber: string, user?: RequestUser) {
    const seller = await this.resolveSeller(user);
    const invoice = await this.invoiceService.getInvoiceForSeller(
      String(seller._id),
      invoiceNumber,
    );
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    const pdfPath = await this.invoiceService.getInvoicePdfPath(invoiceNumber);
    if (!pdfPath) {
      throw new NotFoundException('Invoice PDF not available');
    }
    return { pdfPath, invoice };
  }

  private async resolveSeller(user?: RequestUser) {
    const userId = typeof user?.id === 'string' ? user.id.trim() : '';
    if (!userId) {
      throw new BadRequestException('Invalid user');
    }

    if (Types.ObjectId.isValid(userId)) {
      const byId = await this.sellerModel.findById(userId).exec();
      if (byId) return byId;
    }

    const email =
      typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (email) {
      const byEmail = await this.sellerModel
        .findOne({ $or: [{ email }, { username: email }] })
        .exec();
      if (byEmail) return byEmail;
    }

    const sellerUser = await this.userModel
      .findOne({ _id: userId, role: 'seller' })
      .lean()
      .exec();
    if (sellerUser?.email) {
      const sellerEmail = sellerUser.email.trim().toLowerCase();
      const byUserEmail = await this.sellerModel
        .findOne({ $or: [{ email: sellerEmail }, { username: sellerEmail }] })
        .exec();
      if (byUserEmail) return byUserEmail;
    }

    throw new NotFoundException('Seller not found');
  }

  private async pollGatewayPaymentStatus(
    orderId: string,
    maxAttempts = 5,
  ): Promise<GatewayPaymentStatus> {
    let lastStatus = await this.gateway.getOrderStatus(orderId);
    for (let attempt = 1; attempt < maxAttempts; attempt++) {
      if (lastStatus.paymentStatus !== 'pending') {
        return lastStatus;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      lastStatus = await this.gateway.getOrderStatus(orderId);
    }
    return lastStatus;
  }
}
