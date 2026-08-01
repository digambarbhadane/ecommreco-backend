import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MeeshoCompensationRecoveryDocument =
  HydratedDocument<MeeshoCompensationRecovery>;

@Schema({
  timestamps: true,
  collection: 'meesho_compensation_recovery',
})
export class MeeshoCompensationRecovery {
  @Prop({ index: true })
  date?: Date;

  @Prop({ trim: true })
  programName?: string;

  @Prop({ trim: true })
  reason?: string;

  @Prop()
  amountInclGstInr?: number;

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

export const MeeshoCompensationRecoverySchema = SchemaFactory.createForClass(
  MeeshoCompensationRecovery,
);

MeeshoCompensationRecoverySchema.index({ sellerId: 1, importId: 1 });
MeeshoCompensationRecoverySchema.index({ sellerId: 1, date: 1 });
