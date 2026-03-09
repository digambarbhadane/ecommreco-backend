import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlatformMarketplaceDocument = HydratedDocument<PlatformMarketplace>;

@Schema({ timestamps: true, collection: 'platformmarketplaces' })
export class PlatformMarketplace {
  @Prop({ required: true, index: true })
  name: string;

  @Prop({ required: true, index: true })
  slug: string;

  @Prop()
  logoUrl?: string;

  @Prop()
  description?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 'active' })
  status: 'active' | 'inactive';
}

export const PlatformMarketplaceSchema =
  SchemaFactory.createForClass(PlatformMarketplace);
