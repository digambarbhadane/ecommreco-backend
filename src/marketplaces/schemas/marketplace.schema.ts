import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { PlatformMarketplace } from '../../platform-marketplaces/schemas/platform-marketplace.schema';

export type MarketplaceDocument = HydratedDocument<Marketplace>;

@Schema({ timestamps: true, collection: 'marketplaces' })
export class Marketplace {
  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: PlatformMarketplace.name,
    required: true,
    index: true,
  })
  platformMarketplaceId: Types.ObjectId;

  @Prop({ required: true, index: true })
  gstId: string;

  @Prop()
  storeName?: string;

  @Prop({ default: 'active' })
  status: 'active' | 'inactive';
}

export const MarketplaceSchema = SchemaFactory.createForClass(Marketplace);
MarketplaceSchema.index(
  { sellerId: 1, platformMarketplaceId: 1 },
  { unique: true },
);
