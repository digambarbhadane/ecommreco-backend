import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type GstDocument = Gst & Document;

@Schema({ timestamps: true })
export class Gst {
  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ required: true, index: true })
  gstNumber: string;

  @Prop({ required: true, index: true })
  panNumber: string;

  @Prop()
  businessName?: string;

  @Prop()
  state?: string;

  @Prop()
  tradeName?: string;

  @Prop({ default: 'active' })
  status: string;

  @Prop()
  taxpayerType?: string;

  @Prop()
  registrationDate?: string;

  @Prop()
  address?: string;

  @Prop()
  verifiedAt?: Date;

  @Prop({ type: MongooseSchema.Types.Mixed })
  verificationResponse?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'GstinVerification' })
  gstinVerificationId?: string;
}

export const GstSchema = SchemaFactory.createForClass(Gst);
