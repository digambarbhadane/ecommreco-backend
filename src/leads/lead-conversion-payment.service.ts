import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  buildPaymentNotifyUrl,
  buildPaymentReturnUrl,
  resolvePaymentReturnBaseUrl,
} from '../config/payment-urls';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '../payments/gateways/payment-gateway.interface';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from '../payments/schemas/payment-order.schema';
import { PaymentLogService } from '../payments/payment-log.service';
import {
  SubscriptionPackage,
  SubscriptionPackageDocument,
} from '../subscription/schemas/subscription-package.schema';
import { Lead, LeadDocument } from './schemas/lead.schema';
import {
  LeadConversionConfirmPaymentDto,
  LeadConversionPaymentLinkDto,
  LeadConversionQuoteDto,
} from './dto/lead-conversion-checkout.dto';

const CHECKOUT_TYPE = 'lead_conversion';
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type BillingMode =
  | 'single_gst'
  | 'multi_gst_pan'
  | 'single_gst_multi_marketplace';

@Injectable()
export class LeadConversionPaymentService {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrderDocument>,
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    @Inject(PAYMENT_GATEWAY)
    private readonly gateway: PaymentGateway,
    private readonly paymentLog: PaymentLogService,
    private readonly config: ConfigService,
  ) {}

  private getSigningSecret() {
    const secret =
      this.config.get<string>('ONBOARDING_PAYMENT_LINK_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim();
    if (!secret) {
      throw new BadRequestException('Payment link signing is not configured');
    }
    return secret;
  }

  private buildLeadIdentityFilter(id: string) {
    const filters: Record<string, unknown>[] = [{ leadId: id }];
    if (Types.ObjectId.isValid(id)) {
      filters.push({ _id: new Types.ObjectId(id) });
    }
    return { $or: filters };
  }

  private async findLead(id: string) {
    const lead = await this.leadModel.findOne(this.buildLeadIdentityFilter(id)).exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }

  private normalizeMonths(months: string[]) {
    return Array.from(
      new Set(
        (months ?? [])
          .map((m) => String(m).trim())
          .filter((m) => MONTH_PATTERN.test(m)),
      ),
    ).sort();
  }

  private mapPlanTypeToBillingMode(
    planType?: string,
  ): BillingMode {
    if (planType === 'single_gst') return 'single_gst';
    if (planType === 'single_gst_multi_marketplace') {
      return 'single_gst_multi_marketplace';
    }
    return 'multi_gst_pan';
  }

  private calculateQuote(input: {
    pkg: SubscriptionPackageDocument;
    selectedMonths: string[];
    gstSlots?: number;
    gstNumbers?: string[];
    panNumber?: string;
  }) {
    const months = this.normalizeMonths(input.selectedMonths);
    if (!months.length) {
      throw new BadRequestException(
        'Select at least one reconciliation month (YYYY-MM).',
      );
    }

    const billingMode = this.mapPlanTypeToBillingMode(input.pkg.planType);
    const planType = input.pkg.planType ?? 'multi_gst_pan';
    const basePrice = Number(
      input.pkg.finalPriceAfterDiscount ?? input.pkg.basePrice ?? 0,
    );
    const monthCount = months.length;

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
      subtotal = basePrice * monthCount;
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
          Number(input.gstSlots ?? input.pkg.gstSlots ?? input.pkg.panSlots ?? 1) ||
            1,
        ),
      );

      if (requestedSlots === 1 && !gstNumbers.length) {
        gstSlots = requestedSlots;
        panSlots = requestedSlots;
        subtotal = basePrice * requestedSlots * monthCount;
      } else {
        let pan: string | undefined;
        if (gstNumbers.length) {
          pan =
            String(input.panNumber ?? '')
              .trim()
              .toUpperCase() ||
            (gstNumbers[0].length >= 12 ? gstNumbers[0].slice(2, 12) : '');
          resolvedPan = pan;
          resolvedGsts = gstNumbers;
        }
        gstSlots = requestedSlots;
        panSlots = requestedSlots;
        subtotal = basePrice * requestedSlots * monthCount;
      }
    }

    const gstAmount = Number(((subtotal * 18) / 100).toFixed(2));
    const totalPayable = Number((subtotal + gstAmount).toFixed(2));
    const marketplaceSlots =
      planType === 'single_gst'
        ? 1
        : planType === 'single_gst_multi_marketplace'
          ? 0
          : gstSlots;

    return {
      billingMode,
      planType,
      packageId: String(input.pkg._id),
      packageName: input.pkg.name,
      selectedMonths: months,
      monthCount,
      billableMonthCount: monthCount,
      gstSlots,
      panSlots,
      marketplaceSlots,
      durationDays: monthCount * 30,
      durationYears: Math.max(1, Math.ceil(monthCount / 12)),
      basePricePerMonth: basePrice,
      subtotal: Number(subtotal.toFixed(2)),
      gstPercentage: 18,
      gstAmount,
      totalPayable,
      gstNumbers: resolvedGsts,
      panNumber: resolvedPan,
    };
  }

  private resolveLeadGstNumbers(lead: LeadDocument) {
    const values = [
      lead.gstNumber,
      ...(Array.isArray(lead.gstNumbers) ? lead.gstNumbers : []),
    ]
      .map((g) => (typeof g === 'string' ? g.trim().toUpperCase() : ''))
      .filter(Boolean);
    return Array.from(new Set(values));
  }

  async quote(leadId: string, dto: LeadConversionQuoteDto) {
    const lead = await this.findLead(leadId);
    const pkg = await this.packageModel
      .findOne({ _id: dto.packageId, isActive: true, isTrial: { $ne: true } })
      .exec();
    if (!pkg) {
      throw new BadRequestException('Subscription package not found or inactive');
    }

    const quote = this.calculateQuote({
      pkg,
      selectedMonths: dto.selectedMonths,
      gstSlots: dto.gstSlots,
      gstNumbers: this.resolveLeadGstNumbers(lead),
    });

    return {
      success: true,
      data: {
        package: {
          id: String(pkg._id),
          name: pkg.name,
          planType: pkg.planType,
          basePrice: pkg.finalPriceAfterDiscount ?? pkg.basePrice,
        },
        quote,
      },
    };
  }

  private signToken(
    leadMongoId: string,
    packageId: string,
    selectedMonths: string[],
    expiresAt: Date,
  ) {
    const nonce = randomBytes(8).toString('hex');
    const monthsKey = this.normalizeMonths(selectedMonths).join(',');
    const payload = [
      leadMongoId,
      packageId,
      monthsKey,
      expiresAt.toISOString(),
      nonce,
    ].join('|');
    const signature = createHmac('sha256', this.getSigningSecret())
      .update(payload)
      .digest('hex');
    return Buffer.from(`${payload}|${signature}`).toString('base64url');
  }

  decodeToken(token: string) {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const parts = decoded.split('|');
      if (parts.length !== 6) {
        throw new Error('invalid');
      }
      const [leadId, packageId, monthsKey, expiresAtIso, nonce, signature] =
        parts;
      const payload = [
        leadId,
        packageId,
        monthsKey,
        expiresAtIso,
        nonce,
      ].join('|');
      const expected = createHmac('sha256', this.getSigningSecret())
        .update(payload)
        .digest('hex');
      if (expected !== signature) {
        throw new BadRequestException('Invalid payment link');
      }
      const expiresAt = new Date(expiresAtIso);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
        throw new BadRequestException('Payment link has expired');
      }
      const selectedMonths = monthsKey
        .split(',')
        .map((month) => month.trim())
        .filter(Boolean);
      if (!selectedMonths.length) {
        throw new BadRequestException('Invalid payment link');
      }
      return { leadId, packageId, selectedMonths, expiresAt };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Invalid payment link');
    }
  }

  private buildPaymentUrl(token: string) {
    const base = resolvePaymentReturnBaseUrl(this.config).replace(/\/+$/, '');
    return `${base}/pay/conversion/${token}`;
  }

  async createPaymentLink(
    leadId: string,
    dto: LeadConversionPaymentLinkDto,
    actorEmail: string,
  ) {
    const lead = await this.findLead(leadId);
    const email = typeof lead.email === 'string' ? lead.email.trim() : '';
    const phone =
      typeof lead.contactNumber === 'string' ? lead.contactNumber.trim() : '';
    if (!email || !phone) {
      throw new BadRequestException(
        'Lead email and mobile number are required to generate a payment link',
      );
    }

    const quoteResult = await this.quote(leadId, dto);
    const quote = quoteResult.data.quote;
    const pkg = await this.packageModel.findById(dto.packageId).exec();
    if (!pkg) {
      throw new BadRequestException('Subscription package not found');
    }

    if (!this.gateway.createPaymentLink) {
      throw new BadRequestException('Cashfree payment links are not configured');
    }

    const leadMongoId = String(lead._id);
    const placeholderSellerId = `LC-${leadMongoId}`;
    const cashfreeLinkId = `ECO-LC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(
      0,
      50,
    );
    const expiryDate = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const returnPath = `/pay/conversion/success?link_id=${encodeURIComponent(cashfreeLinkId)}`;

    const gatewayLink = await this.gateway.createPaymentLink({
      linkId: cashfreeLinkId,
      amount: quote.totalPayable,
      purpose: `${quote.packageName} · ${quote.monthCount} month${quote.monthCount === 1 ? '' : 's'}`,
      customerEmail: email,
      customerPhone: phone,
      customerName: lead.fullName ?? lead.firmName ?? 'Seller',
      returnUrl: buildPaymentReturnUrl(this.config, returnPath),
      notifyUrl: buildPaymentNotifyUrl(this.config),
      expiryTime: expiryDate,
    });

    await this.orderModel.create({
      sellerId: placeholderSellerId,
      organisationId: placeholderSellerId,
      leadId: lead._id,
      subscriptionPlanId: pkg._id,
      orderId: cashfreeLinkId,
      paymentGateway: this.gateway.name,
      currency: 'INR',
      baseAmount: quote.subtotal,
      discountAmount: 0,
      gstPercentage: quote.gstPercentage,
      gstAmount: quote.gstAmount,
      totalAmount: quote.totalPayable,
      paymentStatus: 'pending',
      orderStatus: 'active',
      idempotencyKey: `lead-conversion-link-${leadMongoId}-${Date.now()}`,
      metadata: {
        checkoutType: CHECKOUT_TYPE,
        paymentMode: 'cashfree_link',
        cashfreeLinkId,
        linkUrl: gatewayLink.linkUrl,
        cfLinkId: gatewayLink.cfLinkId,
        leadId: leadMongoId,
        leadLeadId: lead.leadId,
        quote,
        packageId: dto.packageId,
        selectedMonths: quote.selectedMonths,
      },
      createdBy: actorEmail,
    });

    lead.subscriptionConfig = {
      gstSlots: quote.gstSlots,
      durationYears: quote.durationYears,
      amount: quote.totalPayable,
      packageId: dto.packageId,
      packageName: quote.packageName,
      planType: quote.planType,
      selectedMonths: quote.selectedMonths,
      updatedAt: new Date(),
      updatedBy: actorEmail,
    };
    lead.paymentDetails = {
      link: gatewayLink.linkUrl,
      status: 'sent',
      generatedBy: actorEmail,
      generatedAt: new Date(),
      expiryDate,
      transactionId: cashfreeLinkId,
    };
    lead.pipelineStage = 'Payment Link Generated';
    lead.activityTimeline = Array.isArray(lead.activityTimeline)
      ? lead.activityTimeline
      : [];
    lead.activityTimeline.push({
      action: 'conversion_payment_link_generated',
      description: `Cashfree payment link generated for ₹${quote.totalPayable}`,
      performedBy: actorEmail,
      timestamp: new Date(),
    });
    await lead.save();

    await this.paymentLog.log({
      eventType: 'api_call',
      orderId: cashfreeLinkId,
      sellerId: placeholderSellerId,
      gateway: this.gateway.name,
      message: 'Lead conversion Cashfree payment link created',
      request: { leadId, quote },
      response: gatewayLink.raw,
      success: true,
    });

    return {
      success: true,
      data: {
        paymentLink: gatewayLink.linkUrl,
        orderId: cashfreeLinkId,
        totalAmount: quote.totalPayable,
        quote,
        expiresAt: expiryDate.toISOString(),
      },
      message: 'Payment link generated successfully',
    };
  }

  async checkoutFromPublicLink(token: string) {
    const { leadId, packageId, selectedMonths } = this.decodeToken(token);
    const lead = await this.leadModel.findById(leadId).exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    if (lead.paymentDetails?.status === 'completed') {
      throw new BadRequestException('This payment has already been completed');
    }

    const email = typeof lead.email === 'string' ? lead.email.trim() : '';
    const phone =
      typeof lead.contactNumber === 'string' ? lead.contactNumber.trim() : '';
    if (!email || !phone) {
      throw new BadRequestException(
        'Lead contact details are incomplete. Please contact support.',
      );
    }

    const leadIdentifier = lead.leadId || leadId;
    const quoteResult = await this.quote(leadIdentifier, {
      packageId,
      selectedMonths,
    });
    const quote = quoteResult.data.quote;
    const pkg = await this.packageModel.findById(packageId).exec();
    if (!pkg) {
      throw new BadRequestException('Subscription package not found');
    }

    const leadMongoId = String(lead._id);
    const placeholderSellerId = `LC-${leadMongoId}`;
    const orderId = `ECO-LC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const returnPath = `/pay/conversion/${token}?order_id=${orderId}`;

    const gatewayResult = await this.gateway.createOrder({
      orderId,
      amount: quote.totalPayable,
      customerId: placeholderSellerId,
      customerEmail: email,
      customerPhone: phone,
      returnUrl: buildPaymentReturnUrl(this.config, returnPath),
      notifyUrl: buildPaymentNotifyUrl(this.config),
      metadata: {
        lead_id: leadMongoId,
        checkout_type: CHECKOUT_TYPE,
        plan_id: packageId,
      },
    });

    await this.orderModel.create({
      sellerId: placeholderSellerId,
      organisationId: placeholderSellerId,
      leadId: lead._id,
      subscriptionPlanId: pkg._id,
      orderId,
      cashfreeOrderId: gatewayResult.cashfreeOrderId,
      paymentSessionId: gatewayResult.paymentSessionId,
      paymentGateway: this.gateway.name,
      currency: 'INR',
      baseAmount: quote.subtotal,
      discountAmount: 0,
      gstPercentage: quote.gstPercentage,
      gstAmount: quote.gstAmount,
      totalAmount: quote.totalPayable,
      paymentStatus: 'pending',
      orderStatus: 'active',
      idempotencyKey: `lead-conversion-${leadMongoId}-${Date.now()}`,
      metadata: {
        checkoutType: CHECKOUT_TYPE,
        leadId: leadMongoId,
        leadLeadId: lead.leadId,
        quote,
        packageId,
        selectedMonths: quote.selectedMonths,
        paymentLinkToken: token,
      },
      createdBy: 'public_checkout',
    });

    lead.paymentDetails = {
      ...(lead.paymentDetails ?? {}),
      link: lead.paymentDetails?.link ?? this.buildPaymentUrl(token),
      status: 'sent',
      generatedBy: lead.paymentDetails?.generatedBy ?? 'public_checkout',
      generatedAt: lead.paymentDetails?.generatedAt ?? new Date(),
      expiryDate: lead.paymentDetails?.expiryDate,
      transactionId: orderId,
    };
    lead.pipelineStage = 'Payment Pending';
    await lead.save();

    await this.paymentLog.log({
      eventType: 'api_call',
      orderId,
      sellerId: placeholderSellerId,
      gateway: this.gateway.name,
      message: 'Lead conversion checkout session created',
      request: { leadId: leadIdentifier, quote },
      response: gatewayResult.raw,
      success: true,
    });

    return {
      success: true,
      data: {
        order_id: orderId,
        payment_session_id: gatewayResult.paymentSessionId,
        total_amount: quote.totalPayable,
        quote,
      },
    };
  }

  async getPublicCheckout(token: string) {
    const { leadId, packageId, selectedMonths, expiresAt } =
      this.decodeToken(token);
    const lead = await this.leadModel.findById(leadId).lean().exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    if (lead.paymentDetails?.status === 'completed') {
      throw new BadRequestException('This payment has already been completed');
    }

    const quoteResult = await this.quote(lead.leadId || leadId, {
      packageId,
      selectedMonths,
    });
    const quote = quoteResult.data.quote;

    return {
      success: true,
      data: {
        leadName: lead.fullName ?? lead.firmName ?? 'Seller',
        amount: quote.totalPayable,
        packageName: quote.packageName,
        monthCount: quote.monthCount,
        expiresAt: expiresAt.toISOString(),
        contactNumber: lead.contactNumber,
      },
    };
  }

  async confirmPaymentPublic(token: string, orderId: string) {
    const { leadId } = this.decodeToken(token);
    const lead = await this.leadModel.findById(leadId).exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    const leadIdentifier = lead.leadId || leadId;
    return this.confirmPayment(
      leadIdentifier,
      { orderId },
      'payment_link',
    );
  }

  async confirmByLinkId(linkId: string) {
    const order = await this.orderModel
      .findOne({
        orderId: linkId,
        'metadata.paymentMode': 'cashfree_link',
      })
      .exec();
    if (!order?.leadId) {
      throw new NotFoundException('Payment link not found');
    }
    const lead = await this.leadModel.findById(order.leadId).exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    const leadIdentifier = lead.leadId || String(lead._id);
    return this.confirmPayment(
      leadIdentifier,
      { orderId: linkId },
      'payment_link',
    );
  }

  async confirmPayment(
    leadId: string,
    dto: LeadConversionConfirmPaymentDto,
    actorEmail: string,
  ) {
    const lead = await this.findLead(leadId);
    const order = await this.orderModel
      .findOne({
        orderId: dto.orderId,
        leadId: lead._id,
      })
      .exec();
    if (!order) {
      throw new NotFoundException('Payment order not found for this lead');
    }

    if (order.paymentStatus === 'paid') {
      return this.markLeadPaymentCompleted(lead, order, actorEmail, true);
    }

    const paymentMode = String(order.metadata?.paymentMode ?? '');
    const status =
      paymentMode === 'cashfree_link' && this.gateway.getLinkStatus
        ? await this.gateway.getLinkStatus(order.orderId).then((link) => ({
            paymentStatus: link.paymentStatus,
            paymentMethod: undefined,
            raw: link.raw,
          }))
        : await this.gateway.getOrderStatus(order.orderId);
    await this.paymentLog.log({
      eventType: 'verification',
      orderId: order.orderId,
      sellerId: order.sellerId,
      gateway: this.gateway.name,
      response: status.raw,
      success: status.paymentStatus === 'paid',
    });

    if (status.paymentStatus !== 'paid') {
      const message =
        status.paymentStatus === 'expired'
          ? 'Payment session expired. Generate a new payment link.'
          : status.paymentStatus === 'failed'
            ? 'Payment failed. Generate a new payment link or ask the seller to retry.'
            : 'Payment not completed yet. Ask the seller to complete payment first.';
      throw new BadRequestException(message);
    }

    order.paymentStatus = 'paid';
    order.orderStatus = 'paid';
    order.paidAt = new Date();
    if (status.paymentMethod) {
      order.paymentMethod = status.paymentMethod;
    }
    await order.save();

    return this.markLeadPaymentCompleted(lead, order, actorEmail, false);
  }

  private async markLeadPaymentCompleted(
    lead: LeadDocument,
    order: PaymentOrderDocument,
    actorEmail: string,
    alreadyPaid: boolean,
  ) {
    const quote = (order.metadata?.quote ?? {}) as Record<string, unknown>;
    const totalPayable = Number(quote.totalPayable ?? order.totalAmount ?? 0);
    const gstSlots = Number(quote.gstSlots ?? 1);
    const durationYears = Number(quote.durationYears ?? 1);
    const selectedMonths = Array.isArray(quote.selectedMonths)
      ? (quote.selectedMonths as string[])
      : Array.isArray(order.metadata?.selectedMonths)
        ? (order.metadata?.selectedMonths as string[])
        : [];

    lead.paymentDetails = {
      ...(lead.paymentDetails ?? {}),
      link: lead.paymentDetails?.link ?? '',
      status: 'completed',
      transactionId: order.orderId,
      paymentDate: order.paidAt ?? new Date(),
      generatedBy: lead.paymentDetails?.generatedBy ?? actorEmail,
      generatedAt: lead.paymentDetails?.generatedAt ?? new Date(),
    };
    lead.subscriptionConfig = {
      gstSlots,
      durationYears,
      amount: totalPayable,
      packageId:
        typeof order.metadata?.packageId === 'string'
          ? order.metadata.packageId
          : typeof quote.packageId === 'string'
            ? quote.packageId
            : undefined,
      packageName:
        typeof quote.packageName === 'string' ? quote.packageName : undefined,
      planType: typeof quote.planType === 'string' ? quote.planType : undefined,
      selectedMonths,
      updatedAt: new Date(),
      updatedBy: actorEmail,
    };
    lead.pipelineStage = 'Payment Completed';
    if (!lead.conversionRequestedAt) {
      lead.conversionRequestedAt = new Date();
      lead.conversionRequestedBy = actorEmail;
    }
    lead.conversionAmount = totalPayable;
    lead.activityTimeline = Array.isArray(lead.activityTimeline)
      ? lead.activityTimeline
      : [];
    if (!alreadyPaid) {
      lead.activityTimeline.push({
        action: 'conversion_payment_confirmed',
        description: `Conversion payment confirmed — ₹${totalPayable}`,
        performedBy: actorEmail,
        timestamp: new Date(),
      });
    }
    await lead.save();

    return {
      success: true,
      message: alreadyPaid
        ? 'Payment was already confirmed for this lead'
        : 'Payment confirmed successfully',
      data: {
        orderId: order.orderId,
        paymentStatus: 'completed',
        amount: totalPayable,
        subscriptionConfig: lead.subscriptionConfig,
      },
    };
  }
}
