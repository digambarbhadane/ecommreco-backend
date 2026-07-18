import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { DiscountType } from '../dto/create-package.dto';

export type SubscriptionPackageDocument = HydratedDocument<SubscriptionPackage>;

@Schema({ timestamps: true, collection: 'subscription_packages' })
export class SubscriptionPackage {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, min: 0 })
  basePrice: number;

  @Prop({
    type: String,
    required: true,
    enum: ['percentage', 'flat', 'none'],
    default: 'none',
  })
  discountType: DiscountType;

  @Prop({ required: true, default: 0, min: 0 })
  discountValue: number;

  @Prop({ required: true, min: 0 })
  finalPriceAfterDiscount: number;

  @Prop({ required: true, default: 18 })
  gstPercentage: number;

  @Prop({ required: true, min: 0 })
  gstAmount: number;

  @Prop({ required: true, min: 0 })
  finalPayableAmount: number;

  @Prop({ required: true, min: 1 })
  durationInDays: number;

  /**
   * single_gst — one GST + one marketplace portal (e.g. ₹999 + 18% GST)
   * multi_gst_pan — monthly plan billed per selected months under one PAN/APOB
   */
  @Prop({
    type: String,
    enum: ['single_gst', 'multi_gst_pan'],
    default: 'multi_gst_pan',
    index: true,
  })
  planType?: 'single_gst' | 'multi_gst_pan';

  @Prop({ required: true, default: true, index: true })
  isActive: boolean;

  @Prop()
  createdBy?: string;
}

export const SubscriptionPackageSchema =
  SchemaFactory.createForClass(SubscriptionPackage);

SubscriptionPackageSchema.index({ name: 1, isActive: 1 });
