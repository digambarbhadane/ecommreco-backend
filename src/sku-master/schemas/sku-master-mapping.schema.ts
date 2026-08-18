import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SkuMasterMappingDocument = HydratedDocument<SkuMasterMapping>;

export type SkuMasterStatus = 'MAPPED' | 'UNMAPPED';

@Schema({ timestamps: true, collection: 'sku_master_mapping' })
export class SkuMasterMapping {
  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ required: true, index: true })
  gstId: string;

  @Prop({ required: true, index: true })
  gstin: string;

  @Prop({ required: true, index: true })
  marketplace: string;

  @Prop({ required: true, index: true })
  marketplaceSku: string;

  @Prop({ type: String, default: null })
  masterSku?: string | null;

  @Prop({ type: Number, default: null })
  rate?: number | null;

  @Prop()
  productName?: string;

  @Prop({ type: String, default: null })
  category?: string;

  @Prop()
  brand?: string;

  @Prop({
    required: true,
    enum: ['MAPPED', 'UNMAPPED'],
    default: 'UNMAPPED',
    index: true,
  })
  status: SkuMasterStatus;

  @Prop()
  createdBy?: string;

  @Prop()
  updatedBy?: string;
}

export const SkuMasterMappingSchema =
  SchemaFactory.createForClass(SkuMasterMapping);

SkuMasterMappingSchema.index(
  { sellerId: 1, gstId: 1, marketplace: 1, marketplaceSku: 1 },
  { unique: true },
);
SkuMasterMappingSchema.index({
  sellerId: 1,
  gstId: 1,
  status: 1,
  marketplace: 1,
  marketplaceSku: 1,
});
SkuMasterMappingSchema.index({
  sellerId: 1,
  status: 1,
  marketplaceSku: 1,
});
