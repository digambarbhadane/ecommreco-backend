import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SalesTargetDocument = SalesTarget & Document;

@Schema({ timestamps: true, collection: 'sales_targets' })
export class SalesTarget {
  @Prop({ required: true, index: true })
  salesManagerId: string;

  @Prop({ required: true, index: true })
  date: string;

  @Prop({ default: 0 })
  targetLeadsToContact: number;

  @Prop({ default: 0 })
  targetConversions: number;

  @Prop()
  createdBy?: string;
}

export const SalesTargetSchema = SchemaFactory.createForClass(SalesTarget);
SalesTargetSchema.index({ salesManagerId: 1, date: -1 }, { unique: true });
