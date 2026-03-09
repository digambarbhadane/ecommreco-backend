import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type GstinVerificationDocument = GstinVerification & Document;

@Schema({ timestamps: true })
export class GstinVerification {
  @Prop({ required: true, index: true })
  gstin: string;

  @Prop({ required: true })
  valid: boolean;

  @Prop()
  legalName?: string;

  @Prop()
  tradeName?: string;

  @Prop()
  status?: string;

  @Prop()
  taxpayerType?: string;

  @Prop()
  constitution?: string;

  @Prop()
  registrationDate?: Date;

  @Prop()
  principalAddress?: string;

  @Prop({ type: [String] })
  natureOfBusinessActivities?: string[];

  @Prop()
  lastUpdateDate?: Date;

  @Prop()
  lastVerifiedAt: Date;

  @Prop({ type: MongooseSchema.Types.Mixed })
  rawResponse: Record<string, unknown>;

  @Prop()
  sellerId?: string;
}

export const GstinVerificationSchema =
  SchemaFactory.createForClass(GstinVerification);
