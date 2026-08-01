import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PaymentInvoiceDocument = HydratedDocument<PaymentInvoice>;

@Schema({ timestamps: true, collection: 'invoices' })
export class PaymentInvoice {
  @Prop({ required: true, unique: true, index: true })
  invoiceNumber: string;

  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ type: Types.ObjectId, ref: 'PaymentOrder', index: true })
  paymentOrderId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  subtotal: number;

  @Prop({ required: true, min: 0 })
  gst: number;

  @Prop({ required: true, min: 0 })
  total: number;

  @Prop()
  invoiceUrl?: string;

  @Prop()
  pdfPath?: string;

  @Prop({ type: Object })
  lineItems?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;

  @Prop({ default: () => new Date() })
  generatedAt: Date;
}

export const PaymentInvoiceSchema =
  SchemaFactory.createForClass(PaymentInvoice);

PaymentInvoiceSchema.index({ sellerId: 1, generatedAt: -1 });
