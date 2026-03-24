import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { LeadsService } from '../leads/leads.service';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import {
  CreateSubscriptionPackageDto,
  DiscountType,
} from './dto/create-package.dto';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import { UpdateSubscriptionPackageDto } from './dto/update-package.dto';
import {
  SubscriptionPackage,
  SubscriptionPackageDocument,
} from './schemas/subscription-package.schema';
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema';

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  fullName?: string;
  username?: string;
  name?: string;
};

const GST_PERCENTAGE = 18;

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    private readonly leadsService: LeadsService,
    private readonly emailService: EmailService,
  ) {}

  private toTwoDecimals(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private toRupee(value: number) {
    return Math.round(value);
  }

  private normalizeDiscountValue(type: DiscountType, value?: number) {
    if (type === 'none') return 0;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return 0;
    }
    if (type === 'percentage') return Math.min(100, value);
    return value;
  }

  private calculatePricing(input: {
    basePrice: number;
    discountType: DiscountType;
    discountValue?: number;
  }) {
    const basePrice = Math.max(0, input.basePrice);
    const discountValue = this.normalizeDiscountValue(
      input.discountType,
      input.discountValue,
    );
    let discountAmount = 0;

    if (input.discountType === 'percentage') {
      discountAmount = (basePrice * discountValue) / 100;
    }
    if (input.discountType === 'flat') {
      discountAmount = discountValue;
    }

    const finalPriceAfterDiscount = this.toTwoDecimals(
      Math.max(0, basePrice - discountAmount),
    );
    const gstAmount = this.toTwoDecimals(
      (finalPriceAfterDiscount * GST_PERCENTAGE) / 100,
    );
    const finalPayableAmount = this.toRupee(
      finalPriceAfterDiscount + gstAmount,
    );

    return {
      discountValue,
      finalPriceAfterDiscount,
      gstPercentage: GST_PERCENTAGE,
      gstAmount,
      finalPayableAmount,
    };
  }

  private buildLeadIdentityFilter(id: string) {
    const filters: Array<Record<string, unknown>> = [{ leadId: id }];
    if (id.length === 24 && Types.ObjectId.isValid(id)) {
      filters.unshift({ _id: new Types.ObjectId(id) });
    }
    return { $or: filters };
  }

  private getActor(user?: RequestUser) {
    return (
      user?.email ||
      user?.fullName ||
      user?.username ||
      user?.name ||
      user?.id ||
      'system'
    );
  }

  async createPackage(dto: CreateSubscriptionPackageDto, user?: RequestUser) {
    const pricing = this.calculatePricing(dto);
    const created = await this.packageModel.create({
      name: dto.name,
      basePrice: dto.basePrice,
      discountType: dto.discountType,
      discountValue: pricing.discountValue,
      finalPriceAfterDiscount: pricing.finalPriceAfterDiscount,
      gstPercentage: pricing.gstPercentage,
      gstAmount: pricing.gstAmount,
      finalPayableAmount: pricing.finalPayableAmount,
      durationInDays: dto.durationInDays,
      isActive: dto.isActive ?? true,
      createdBy: this.getActor(user),
    });

    return {
      success: true,
      data: created,
      message: 'Subscription package created successfully',
    };
  }

  async listPackages(includeInactive = false) {
    const filter = includeInactive ? {} : { isActive: true };
    const items = await this.packageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return {
      success: true,
      data: items,
    };
  }

  async updatePackage(
    id: string,
    dto: UpdateSubscriptionPackageDto,
    user?: RequestUser,
  ) {
    const current = await this.packageModel.findById(id).exec();
    if (!current) {
      throw new NotFoundException('Subscription package not found');
    }

    const nextBasePrice =
      typeof dto.basePrice === 'number' ? dto.basePrice : current.basePrice;
    const nextDiscountType = dto.discountType ?? current.discountType;
    const nextDiscountValue =
      typeof dto.discountValue === 'number'
        ? dto.discountValue
        : current.discountValue;
    const pricing = this.calculatePricing({
      basePrice: nextBasePrice,
      discountType: nextDiscountType,
      discountValue: nextDiscountValue,
    });

    current.name = dto.name ?? current.name;
    current.basePrice = nextBasePrice;
    current.discountType = nextDiscountType;
    current.discountValue = pricing.discountValue;
    current.finalPriceAfterDiscount = pricing.finalPriceAfterDiscount;
    current.gstPercentage = pricing.gstPercentage;
    current.gstAmount = pricing.gstAmount;
    current.finalPayableAmount = pricing.finalPayableAmount;
    current.durationInDays = dto.durationInDays ?? current.durationInDays;
    current.isActive =
      typeof dto.isActive === 'boolean' ? dto.isActive : current.isActive;
    current.createdBy = this.getActor(user);
    await current.save();

    return {
      success: true,
      data: current,
      message: 'Subscription package updated successfully',
    };
  }

  async softDeletePackage(id: string) {
    const updated = await this.packageModel
      .findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException('Subscription package not found');
    }
    return {
      success: true,
      data: updated,
      message: 'Subscription package removed successfully',
    };
  }

  async assignSubscription(dto: AssignSubscriptionDto, user?: RequestUser) {
    await this.leadsService.assertLeadAccess(dto.leadId, user);

    const lead = await this.leadModel
      .findOne(this.buildLeadIdentityFilter(dto.leadId))
      .exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const pkg = await this.packageModel
      .findOne({ _id: dto.packageId, isActive: true })
      .exec();
    if (!pkg) {
      throw new NotFoundException('Subscription package not found');
    }

    const duration =
      typeof dto.customDuration === 'number' && dto.customDuration > 0
        ? dto.customDuration
        : pkg.durationInDays;

    if (duration <= 0) {
      throw new BadRequestException('Duration must be greater than 0');
    }

    const gstSlots =
      typeof dto.gstSlots === 'number' &&
      Number.isFinite(dto.gstSlots) &&
      dto.gstSlots > 0
        ? Math.floor(dto.gstSlots)
        : 1;

    const scaledDiscountedPerGst = this.toTwoDecimals(
      (pkg.finalPriceAfterDiscount / pkg.durationInDays) * duration,
    );
    const scaledDiscountedPrice = this.toTwoDecimals(
      scaledDiscountedPerGst * gstSlots,
    );
    const scaledGstAmount = this.toTwoDecimals(
      (scaledDiscountedPrice * pkg.gstPercentage) / 100,
    );
    const scaledTotal = this.toRupee(scaledDiscountedPrice + scaledGstAmount);

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + duration);

    const created = await this.subscriptionModel.create({
      leadId: lead.leadId || String(lead._id),
      sellerId: lead.sellerId,
      packageId: pkg._id,
      gstSlots,
      selectedPrice: scaledDiscountedPrice,
      gstAmount: scaledGstAmount,
      totalAmount: scaledTotal,
      duration,
      startDate,
      endDate,
      paymentStatus: 'pending',
      createdBy: this.getActor(user),
    });

    const paymentLink = `https://payment.yourapp.com/pay/${created._id.toString()}`;
    created.paymentLink = paymentLink;
    await created.save();

    if (
      typeof lead.sellerId === 'string' &&
      lead.sellerId.trim().length > 0 &&
      Types.ObjectId.isValid(lead.sellerId)
    ) {
      await this.sellerModel.findByIdAndUpdate(lead.sellerId, {
        $set: {
          gstSlots,
          gstSlotsPurchased: gstSlots,
          durationYears: this.toTwoDecimals(duration / 365),
          subscriptionDuration: this.toTwoDecimals(duration / 365),
          amount: scaledTotal,
          paymentLink,
          paymentStatus: 'pending',
        },
      });
    }

    lead.subscriptionConfig = {
      gstSlots,
      durationYears: this.toTwoDecimals(duration / 365),
      amount: scaledTotal,
      updatedAt: new Date(),
      updatedBy: this.getActor(user),
    };
    lead.paymentDetails = {
      link: paymentLink,
      status: 'pending',
      generatedBy: this.getActor(user),
      generatedAt: new Date(),
      expiryDate: endDate,
    };
    lead.pipelineStage = 'Payment Link Generated';
    lead.activityTimeline = Array.isArray(lead.activityTimeline)
      ? lead.activityTimeline
      : [];
    lead.activityTimeline.push({
      action: 'subscription_assigned',
      description: `Subscription assigned (${pkg.name}) for ${duration} days (${gstSlots} GST)`,
      performedBy: this.getActor(user),
      timestamp: new Date(),
      metadata: {
        packageId: pkg._id.toString(),
        subscriptionId: created._id.toString(),
        gstSlots,
      },
    });
    await lead.save();

    return {
      success: true,
      data: {
        ...created.toObject(),
        paymentLink,
      },
      message: 'Subscription assigned and payment link generated',
    };
  }

  async getLeadSubscription(leadId: string, user?: RequestUser) {
    await this.leadsService.assertLeadAccess(leadId, user);
    const lead = await this.leadModel
      .findOne(this.buildLeadIdentityFilter(leadId))
      .select('_id leadId')
      .lean()
      .exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const leadIdentity =
      (lead as { leadId?: string; _id?: Types.ObjectId }).leadId ??
      String((lead as { _id?: Types.ObjectId })._id ?? leadId);

    const subscription = await this.subscriptionModel
      .findOne({ leadId: leadIdentity })
      .sort({ createdAt: -1 })
      .populate('packageId')
      .lean()
      .exec();

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    return {
      success: true,
      data: subscription,
    };
  }

  async sendPaymentLinkEmail(leadId: string, user?: RequestUser) {
    await this.leadsService.assertLeadAccess(leadId, user);

    const formatDate = (value: unknown) => {
      if (!value) return '';
      const d = new Date(value as any);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-IN');
    };

    const lead = await this.leadModel
      .findOne(this.buildLeadIdentityFilter(leadId))
      .exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const recipientEmail =
      typeof lead.email === 'string' ? lead.email.trim().toLowerCase() : '';
    if (!recipientEmail) {
      throw new BadRequestException('Lead email not available');
    }

    const leadIdentity = lead.leadId ?? String(lead._id);
    const subscription = await this.subscriptionModel
      .findOne({ leadId: leadIdentity })
      .sort({ createdAt: -1 })
      .populate('packageId')
      .exec();
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    const pkg = subscription.packageId as unknown as SubscriptionPackage;
    const planName = typeof pkg?.name === 'string' ? pkg.name : 'Subscription';
    const paymentLink =
      typeof subscription.paymentLink === 'string'
        ? subscription.paymentLink
        : typeof lead.paymentDetails?.link === 'string'
          ? lead.paymentDetails.link
          : '';
    if (!paymentLink) {
      throw new BadRequestException('Payment link not available');
    }

    const actor = this.getActor(user);
    const name =
      typeof lead.fullName === 'string' && lead.fullName.trim().length > 0
        ? lead.fullName.trim()
        : 'there';

    const emailOptionsBase = {
      to: recipientEmail,
      type: EmailType.SUBSCRIPTION,
      subject: `Payment Link - ${planName}`,
      payload: {
        name,
        planName,
        amount: subscription.totalAmount,
        period: `${subscription.duration} days`,
        paymentLink,
        gstSlots: subscription.gstSlots ?? 1,
        durationDays: subscription.duration,
        startDate: formatDate(subscription.startDate),
        endDate: formatDate(subscription.endDate),
        basePrice: (pkg as any)?.basePrice ?? undefined,
        discountType: (pkg as any)?.discountType ?? undefined,
        discountValue: (pkg as any)?.discountValue ?? undefined,
        finalPriceAfterDiscount:
          (pkg as any)?.finalPriceAfterDiscount ?? undefined,
        gstPercentage: (pkg as any)?.gstPercentage ?? undefined,
        selectedPrice: subscription.selectedPrice,
        gstAmount: subscription.gstAmount,
        totalAmount: subscription.totalAmount,
      },
    } as const;

    try {
      await this.emailService.sendEmail({
        ...emailOptionsBase,
        fromOverride: 'support@ecommreco.com',
      });
    } catch (err: any) {
      const status = err?.statusCode ?? err?.code;
      if (status === 422) {
        await this.emailService.sendEmail({
          ...emailOptionsBase,
          replyTo: 'support@ecommreco.com',
        });
      } else {
        throw err;
      }
    }

    lead.paymentDetails = {
      ...(lead.paymentDetails ?? {}),
      link: paymentLink,
      status: 'sent',
      generatedBy: actor,
      generatedAt: new Date(),
      expiryDate: subscription.endDate,
    };
    lead.activityTimeline = Array.isArray(lead.activityTimeline)
      ? lead.activityTimeline
      : [];
    lead.activityTimeline.push({
      action: 'payment_link_emailed',
      description: `Payment link emailed to ${recipientEmail}`,
      performedBy: actor,
      timestamp: new Date(),
      metadata: {
        subscriptionId: subscription._id.toString(),
        gstSlots: subscription.gstSlots ?? 1,
      },
    });
    await lead.save();

    return { success: true, message: 'Payment link email sent' };
  }
}
