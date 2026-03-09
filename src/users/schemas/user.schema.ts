import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  fullName: string;

  @Prop({ required: true, unique: true, index: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true })
  role:
    | 'super_admin'
    | 'sales_manager'
    | 'accounts_manager'
    | 'training_and_support_manager'
    | 'seller';

  @Prop()
  companyName?: string;

  @Prop()
  mobile?: string;

  @Prop({ default: 'approved' })
  status: 'pending' | 'approved' | 'rejected' | 'blocked';

  @Prop({ default: true })
  profileCompleted: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
