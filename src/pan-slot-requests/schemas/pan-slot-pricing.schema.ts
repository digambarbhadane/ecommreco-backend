import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { PanSlotDurationType } from './pan-slot-request.schema';
import { PAN_SLOT_DURATION_TYPES } from './pan-slot-request.schema';

export type PanSlotPricingDocument = PanSlotPricing & Document;

@Schema({ timestamps: true, collection: 'pan_slot_pricing' })
export class PanSlotPricing {
  @Prop({ required: true, unique: true, enum: PAN_SLOT_DURATION_TYPES })
  durationType: PanSlotDurationType;

  @Prop({ required: true })
  label: string;

  @Prop({ required: true, min: 1 })
  durationMonths: number;

  @Prop({ required: true, min: 0 })
  pricePerSlot: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const PanSlotPricingSchema =
  SchemaFactory.createForClass(PanSlotPricing);
