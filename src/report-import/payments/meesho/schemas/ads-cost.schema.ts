import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MeeshoAdsCostDocument = HydratedDocument<MeeshoAdsCost>;

@Schema({
  timestamps: true,
  collection: 'meesho_ads_cost',
})
export class MeeshoAdsCost {
  @Prop({ trim: true })
  deductionDuration?: string;

  @Prop({ index: true })
  deductionDate?: Date;

  @Prop({ trim: true, index: true })
  campaignId?: string;

  @Prop()
  adCost?: number;

  @Prop()
  creditsWaiversDiscounts?: number;

  @Prop()
  adCostInclCreditsWaiversDiscounts?: number;

  @Prop()
  gst?: number;

  @Prop()
  totalAdsCost?: number;

  @Prop({ required: true, default: 'meesho', index: true })
  marketplace: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  sellerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  importId: Types.ObjectId;

  @Prop({ required: true })
  importedAt: Date;

  @Prop()
  gstId?: string;

  @Prop()
  gstin?: string;

  @Prop({ index: true })
  reportMonth?: string;

  @Prop({ required: true })
  uploadedFileName: string;

  @Prop({ required: true })
  sheetName: string;
}

export const MeeshoAdsCostSchema = SchemaFactory.createForClass(MeeshoAdsCost);

MeeshoAdsCostSchema.index({ sellerId: 1, importId: 1 });
MeeshoAdsCostSchema.index({ sellerId: 1, campaignId: 1 });
MeeshoAdsCostSchema.index({ sellerId: 1, deductionDate: 1 });
