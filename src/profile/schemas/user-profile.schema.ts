import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserProfileDocument = UserProfile & Document;

@Schema({ timestamps: true, collection: 'user_profiles' })
export class UserProfile {
  @Prop({ required: true, unique: true, index: true })
  userId: string;

  @Prop()
  profilePhoto?: string;

  @Prop()
  firstName?: string;

  @Prop()
  lastName?: string;

  @Prop()
  employeeId?: string;

  @Prop()
  email?: string;

  @Prop()
  phone?: string;

  @Prop()
  alternatePhone?: string;

  @Prop()
  dateOfBirth?: Date;

  @Prop()
  gender?: string;

  @Prop()
  role?: string;

  @Prop()
  department?: string;

  @Prop()
  designation?: string;

  @Prop()
  reportingManager?: string;

  @Prop()
  joiningDate?: Date;

  @Prop()
  addressLine1?: string;

  @Prop()
  addressLine2?: string;

  @Prop()
  city?: string;

  @Prop()
  state?: string;

  @Prop()
  country?: string;

  @Prop()
  zipCode?: string;

  @Prop()
  timezone?: string;

  @Prop()
  preferredLanguage?: string;
}

export const UserProfileSchema = SchemaFactory.createForClass(UserProfile);
