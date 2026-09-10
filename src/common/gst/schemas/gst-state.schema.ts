import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GstStateDocument = GstState & Document;

@Schema({ collection: 'gst_states', timestamps: true })
export class GstState {
  @Prop({ required: true, unique: true, index: true })
  stateCode: number;

  @Prop({ required: true, uppercase: true, index: true })
  shortName: string;

  @Prop({ required: true, index: true })
  stateName: string;

  @Prop({ required: true })
  gstName: string;

  @Prop({ type: [String], default: [] })
  aliases: string[];
}

export const GstStateSchema = SchemaFactory.createForClass(GstState);
