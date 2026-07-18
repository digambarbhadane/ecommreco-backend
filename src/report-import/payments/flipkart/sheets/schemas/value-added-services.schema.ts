import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlipkartPaymentValueAddedServicesDocument =
  HydratedDocument<FlipkartPaymentValueAddedServices>;

@Schema({
  timestamps: true,
  collection: 'flipkart_payment_value_added_services',
})
export class FlipkartPaymentValueAddedServices {
  @Prop({ required: true, index: true, trim: true })
  neftId: string;

  @Prop({ index: true })
  paymentDate?: string;

  @Prop()
  settlementValue?: number;

  @Prop({ trim: true })
  serviceName?: string;

  @Prop({ required: true, default: 'flipkart', index: true })
  marketplace: string;

  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop()
  gstId?: string;

  @Prop()
  gstin?: string;

  @Prop({ index: true })
  reportMonth?: string;

  @Prop({ required: true, default: 'payment' })
  reportType: string;

  @Prop({ required: true })
  uploadedFileName: string;

  @Prop({ required: true })
  sheetName: string;

  @Prop({ required: true, index: true })
  uploadId: string;

  @Prop({ required: true })
  uploadedAt: Date;

  @Prop({ required: true })
  rowKey: string;
}

export const FlipkartPaymentValueAddedServicesSchema =
  SchemaFactory.createForClass(FlipkartPaymentValueAddedServices);

FlipkartPaymentValueAddedServicesSchema.index(
  { sellerId: 1, marketplace: 1, rowKey: 1, reportMonth: 1 },
  { unique: true, name: 'flipkart_payment_value_added_services_unique_idx' },
);
