import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ApiProfileController } from './profile.api.controller';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import {
  UserActivityLog,
  UserActivityLogSchema,
} from './schemas/user-activity-log.schema';
import {
  UserPreferences,
  UserPreferencesSchema,
} from './schemas/user-preferences.schema';
import { UserProfile, UserProfileSchema } from './schemas/user-profile.schema';
import {
  UserSecurity,
  UserSecuritySchema,
} from './schemas/user-security.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: UserProfile.name, schema: UserProfileSchema },
      { name: UserPreferences.name, schema: UserPreferencesSchema },
      { name: UserSecurity.name, schema: UserSecuritySchema },
      { name: UserActivityLog.name, schema: UserActivityLogSchema },
    ]),
  ],
  controllers: [ProfileController, ApiProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
