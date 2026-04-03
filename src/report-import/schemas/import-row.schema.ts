import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ImportRowDocument = HydratedDocument<ImportRow>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'import_rows',
})
export class ImportRow {
  @Prop({ required: true, index: true })
  uploadId: string;

  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ required: true, index: true })
  gstin: string;

  @Prop({ required: true, index: true })
  marketplace: string;

  @Prop({ required: true, enum: ['sales', 'cashback'], index: true })
  reportType: 'sales' | 'cashback';

  @Prop({ required: true, index: true })
  documentType: string; // canonical: Document Type

  @Prop()
  voucherType?: string; // canonical: Voucher Type

  @Prop()
  orderID?: string; // canonical: Order ID

  @Prop()
  skuID?: string; // canonical: SKU ID

  @Prop()
  hsnCode?: string;

  @Prop()
  paymentMode?: string; // canonical: Payment Mode

  @Prop()
  fulfilmentType?: string;

  @Prop()
  quantity?: number; // canonical: Quantity

  @Prop()
  invoiceAmount?: number;

  @Prop()
  taxableAmount?: number; // canonical: Taxable Amount

  @Prop()
  igstRate?: number;

  @Prop()
  igstAmount?: number;

  @Prop()
  cgstRate?: number;

  @Prop()
  cgstAmount?: number;

  @Prop()
  sgstRate?: number;

  @Prop()
  sgstAmount?: number;

  @Prop()
  invoiceNo?: string; // canonical: Invoice No

  @Prop()
  buyerInvoiceDate?: string; // canonical: Buyer Invoice Date (Sales Report)

  @Prop({ index: true })
  invoiceDate?: string;

  @Prop()
  pincode?: string; // canonical: Pincode

  @Prop()
  stateName?: string; // canonical: State Name
}

export const ImportRowSchema = SchemaFactory.createForClass(ImportRow);
ImportRowSchema.index({
  sellerId: 1,
  gstin: 1,
  marketplace: 1,
  invoiceDate: 1,
});
ImportRowSchema.index({ sellerId: 1, documentType: 1 });
