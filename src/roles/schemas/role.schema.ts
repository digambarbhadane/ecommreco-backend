import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoleDocument = Role & Document;

@Schema({ timestamps: true, collection: 'roles' })
export class Role {
  @Prop({ required: true, unique: true, index: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ default: false })
  isSystem: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
