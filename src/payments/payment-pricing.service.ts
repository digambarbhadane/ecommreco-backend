import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SubscriptionPackage,
  SubscriptionPackageDocument,
} from '../subscription/schemas/subscription-package.schema';
import { Coupon, CouponDocument } from './schemas/coupon.schema';

export type PricingBreakdown = {
  baseAmount: number;
  discountAmount: number;
  gstPercentage: number;
  gstAmount: number;
  totalAmount: number;
  couponCode?: string;
};

@Injectable()
export class PaymentPricingService {
  constructor(
    @InjectModel(SubscriptionPackage.name)
    private readonly packageModel: Model<SubscriptionPackageDocument>,
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
  ) {}

  private toTwoDecimals(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private toRupee(value: number) {
    return Math.round(value);
  }

  async calculateForPlan(input: {
    planId: string;
    sellerId?: string;
    couponCode?: string;
    gstSlots?: number;
    durationDays?: number;
  }): Promise<{
    plan: SubscriptionPackageDocument;
    pricing: PricingBreakdown;
  }> {
    const plan = await this.packageModel
      .findOne({ _id: input.planId, isActive: true })
      .exec();
    if (!plan) {
      throw new BadRequestException('Subscription plan not found or inactive');
    }

    const gstSlots = Math.max(1, input.gstSlots ?? plan.gstSlots ?? 1);
    const durationDays = Math.max(1, input.durationDays ?? plan.durationInDays);
    const scaleFactor =
      (durationDays / Math.max(1, plan.durationInDays)) * gstSlots;

    const baseAmount = this.toTwoDecimals(
      (plan.finalPriceAfterDiscount ?? plan.basePrice) * scaleFactor,
    );
    let discountAmount = 0;
    let couponCode: string | undefined;

    if (input.couponCode?.trim()) {
      const coupon = await this.validateCoupon(
        input.couponCode.trim(),
        baseAmount,
        input.sellerId,
      );
      couponCode = coupon.code;
      if (coupon.type === 'percentage') {
        discountAmount = this.toTwoDecimals((baseAmount * coupon.value) / 100);
      } else {
        discountAmount = this.toTwoDecimals(Math.min(coupon.value, baseAmount));
      }
    }

    const taxableAmount = Math.max(0, baseAmount - discountAmount);
    const gstPercentage = plan.gstPercentage ?? 18;
    const gstAmount = this.toTwoDecimals((taxableAmount * gstPercentage) / 100);
    const totalAmount = this.toRupee(taxableAmount + gstAmount);

    return {
      plan,
      pricing: {
        baseAmount,
        discountAmount,
        gstPercentage,
        gstAmount,
        totalAmount,
        couponCode,
      },
    };
  }

  private async validateCoupon(
    code: string,
    amount: number,
    sellerId?: string,
  ) {
    const coupon = await this.couponModel
      .findOne({ code: code.toUpperCase(), isActive: true })
      .exec();
    if (!coupon) {
      throw new BadRequestException('Invalid coupon code');
    }
    if (coupon.expiryDate && coupon.expiryDate.getTime() < Date.now()) {
      throw new BadRequestException('Coupon has expired');
    }
    if (coupon.maxUsage > 0 && coupon.usageCount >= coupon.maxUsage) {
      throw new BadRequestException('Coupon usage limit reached');
    }
    if (amount < coupon.minimumAmount) {
      throw new BadRequestException(
        `Minimum order amount of ₹${coupon.minimumAmount} required for this coupon`,
      );
    }
    if (sellerId && coupon.perUserLimit > 0) {
      // Future: track per-user coupon usage
    }
    return coupon;
  }

  inferSubscriptionType(durationInDays: number): string {
    if (durationInDays <= 14) return 'trial';
    if (durationInDays <= 31) return 'monthly';
    if (durationInDays <= 95) return 'quarterly';
    if (durationInDays <= 185) return 'half_yearly';
    return 'yearly';
  }
}
