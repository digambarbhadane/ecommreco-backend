import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReconAdjustmentDocument = HydratedDocument<ReconAdjustment>;

@Schema({ timestamps: true, collection: 'recon_adjustments' })
export class ReconAdjustment {
  @Prop({ required: true, index: true })
  sellerId!: string;

  @Prop({ required: true, index: true })
  gstId!: string;

  @Prop({ required: true, index: true })
  marketplace!: string;

  @Prop({ required: true, index: true })
  transactionKey!: string;

  @Prop({ required: true, index: true })
  sourceUploadId!: string;

  @Prop({ required: true, index: true })
  sourceReportMonth!: string;

  @Prop({ required: true, index: true })
  affectedReportMonth!: string;

  @Prop()
  previousStatus?: string;

  @Prop()
  updatedStatus?: string;

  @Prop({ default: 0 })
  deltaSalesAmount!: number;

  @Prop({ default: 0 })
  deltaReturnAmount!: number;

  @Prop({ default: 0 })
  deltaSettlementAmount!: number;

  @Prop({ default: 0 })
  deltaReturnRows!: number;
}

export const ReconAdjustmentSchema =
  SchemaFactory.createForClass(ReconAdjustment);

ReconAdjustmentSchema.index(
  { sellerId: 1, marketplace: 1, affectedReportMonth: 1, createdAt: -1 },
  { name: 'recon_adjustment_month_idx' },
);
