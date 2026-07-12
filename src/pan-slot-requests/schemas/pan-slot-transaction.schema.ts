import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PanSlotTransactionDocument = PanSlotTransaction & Document;

@Schema({ timestamps: true, collection: 'pan_slot_transactions' })
export class PanSlotTransaction {
  @Prop({ required: true, unique: true, index: true })
  transactionNumber: string;

  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ required: true, index: true })
  requestId: string;

  @Prop({ default: 'PAN' })
  slotType: string;

  @Prop({ required: true, min: 1 })
  purchasedSlots: number;

  @Prop({ required: true, min: 1 })
  durationMonths: number;

  @Prop({ required: true })
  amount: number;

  @Prop()
  paymentReference?: string;

  @Prop()
  paymentDate?: Date;

  @Prop()
  assignedBy?: string;

  @Prop()
  assignedAt?: Date;

  @Prop({ default: 0 })
  previousTotalSlots: number;

  @Prop({ default: 0 })
  newTotalSlots: number;

  @Prop({ default: 'completed' })
  status: string;

  @Prop()
  notes?: string;
}

export const PanSlotTransactionSchema =
  SchemaFactory.createForClass(PanSlotTransaction);
