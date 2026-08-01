import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CouponDocument = HydratedDocument<Coupon>;

export const COUPON_TYPES = ['percentage', 'fixed'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

@Schema({ timestamps: true, collection: 'coupons' })
export class Coupon {
  @Prop({ required: true, unique: true, uppercase: true, trim: true, index: true })
  code: string;

  @Prop({ required: true, type: String, enum: COUPON_TYPES })
  type: CouponType;

  @Prop({ required: true, min: 0 })
  value: number;

  @Prop()
  expiryDate?: Date;

  @Prop({ default: 0, min: 0 })
  maxUsage: number;

  @Prop({ default: 0, min: 0 })
  usageCount: number;

  @Prop({ default: 1, min: 1 })
  perUserLimit: number;

  @Prop({ default: 0, min: 0 })
  minimumAmount: number;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop()
  description?: string;

  @Prop()
  createdBy?: string;
}

export const CouponSchema = SchemaFactory.createForClass(Coupon);

CouponSchema.index({ isActive: 1, expiryDate: 1 });
