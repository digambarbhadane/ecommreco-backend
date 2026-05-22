import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Request } from 'express';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileManagementDto } from './dto/update-profile-management.dto';
import {
  UserActivityLog,
  UserActivityLogDocument,
} from './schemas/user-activity-log.schema';
import {
  UserPreferences,
  UserPreferencesDocument,
} from './schemas/user-preferences.schema';
import {
  UserProfile,
  UserProfileDocument,
} from './schemas/user-profile.schema';
import {
  UserSecurity,
  UserSecurityDocument,
} from './schemas/user-security.schema';

type RequestUser = {
  id?: string;
  _id?: Types.ObjectId | string;
  role?: string;
  email?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};

@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(UserProfile.name)
    private readonly userProfileModel: Model<UserProfileDocument>,
    @InjectModel(UserPreferences.name)
    private readonly userPreferencesModel: Model<UserPreferencesDocument>,
    @InjectModel(UserSecurity.name)
    private readonly userSecurityModel: Model<UserSecurityDocument>,
    @InjectModel(UserActivityLog.name)
    private readonly userActivityLogModel: Model<UserActivityLogDocument>,
  ) {}

  private getUserId(user?: RequestUser): string | undefined {
    if (typeof user?.id === 'string' && user.id.trim().length > 0)
      return user.id;
    if (typeof user?._id === 'string' && user._id.trim().length > 0)
      return user._id;
    if (user?._id instanceof Types.ObjectId) return user._id.toString();
    return undefined;
  }

  async getProfile(user?: RequestUser) {
    const id = this.getUserId(user);
    const role = typeof user?.role === 'string' ? user.role : undefined;
    if (!id || !role) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid user',
      });
    }

    if (role === 'seller') {
      const seller = await this.sellerModel
        .findById(id)
        .select('-password')
        .lean()
        .exec();
      if (seller) {
        return {
          success: true,
          data: {
            _id: seller._id.toString(),
            fullName: seller.fullName,
            email: seller.email,
            role: 'seller',
            companyName: seller.firmName || seller.gstNumber,
            mobile: seller.contactNumber,
            address: seller.address || '',
            bio: seller.bio || '',
            profileCompleted: true,
            gstNumber: seller.gstNumber,
            businessType: seller.businessType || '',
          },
        };
      }

      const sellerUser = await this.userModel
        .findOne({ _id: id, role: 'seller' })
        .select('-password')
        .lean()
        .exec();

      if (!sellerUser) {
        throw new NotFoundException({
          success: false,
          message: 'Profile not found',
        });
      }

      return {
        success: true,
        data: {
          _id: sellerUser._id.toString(),
          fullName: sellerUser.fullName,
          email: sellerUser.email,
          role: 'seller',
          companyName: sellerUser.companyName || '',
          mobile: sellerUser.mobile || '',
          address: sellerUser.address || '',
          bio: sellerUser.bio || '',
          profileCompleted: sellerUser.profileCompleted ?? true,
          gstNumber: '',
          businessType: '',
        },
      };
    }

    const admin = await this.userModel
      .findById(id)
      .select('-password')
      .lean()
      .exec();
    if (!admin) {
      throw new NotFoundException({
        success: false,
        message: 'Profile not found',
      });
    }
    return {
      success: true,
      data: {
        _id: admin._id.toString(),
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        companyName: admin.companyName || '',
        mobile: admin.mobile || '',
        address: admin.address || '',
        bio: admin.bio || '',
        profileCompleted: admin.profileCompleted ?? true,
      },
    };
  }

  async updateProfile(dto: UpdateProfileDto, user?: RequestUser) {
    const id = this.getUserId(user);
    const role = typeof user?.role === 'string' ? user.role : undefined;
    if (!id || !role) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid user',
      });
    }

    if (role === 'seller') {
      const seller = await this.sellerModel.findById(id).exec();
      if (seller) {
        if (typeof dto.fullName === 'string' && dto.fullName.length > 0) {
          seller.fullName = dto.fullName;
        }
        if (typeof dto.mobile === 'string' && dto.mobile.length > 0) {
          seller.contactNumber = dto.mobile;
        }
        if (typeof dto.companyName === 'string') {
          seller.firmName = dto.companyName;
        }
        if (typeof dto.address === 'string') {
          seller.address = dto.address;
        }
        if (typeof dto.bio === 'string') {
          seller.bio = dto.bio;
        }
        if (typeof dto.gstNumber === 'string' && dto.gstNumber.length > 0) {
          seller.gstNumber = dto.gstNumber;
        }
        if (typeof dto.businessType === 'string') {
          seller.businessType = dto.businessType;
        }

        const updated = await seller.save();
        return {
          success: true,
          data: {
            _id: updated._id.toString(),
            fullName: updated.fullName,
            email: updated.email,
            role: 'seller',
            companyName: updated.firmName || updated.gstNumber,
            mobile: updated.contactNumber,
            address: updated.address || '',
            bio: updated.bio || '',
            profileCompleted: true,
            gstNumber: updated.gstNumber,
            businessType: updated.businessType || '',
          },
        };
      }

      const sellerUser = await this.userModel
        .findOne({ _id: id, role: 'seller' })
        .exec();
      if (!sellerUser) {
        throw new NotFoundException({
          success: false,
          message: 'Profile not found',
        });
      }

      if (typeof dto.fullName === 'string' && dto.fullName.length > 0) {
        sellerUser.fullName = dto.fullName;
      }
      if (typeof dto.mobile === 'string' && dto.mobile.length > 0) {
        sellerUser.mobile = dto.mobile;
      }
      if (typeof dto.companyName === 'string') {
        sellerUser.companyName = dto.companyName;
      }
      if (typeof dto.address === 'string') {
        sellerUser.address = dto.address;
      }
      if (typeof dto.bio === 'string') {
        sellerUser.bio = dto.bio;
      }

      const updated = await sellerUser.save();
      return {
        success: true,
        data: {
          _id: updated._id.toString(),
          fullName: updated.fullName,
          email: updated.email,
          role: 'seller',
          companyName: updated.companyName || '',
          mobile: updated.mobile || '',
          address: updated.address || '',
          bio: updated.bio || '',
          profileCompleted: updated.profileCompleted ?? true,
          gstNumber: '',
          businessType: '',
        },
      };
    }

    const admin = await this.userModel.findById(id).exec();
    if (!admin) {
      throw new NotFoundException({
        success: false,
        message: 'Profile not found',
      });
    }

    if (typeof dto.fullName === 'string' && dto.fullName.length > 0) {
      admin.fullName = dto.fullName;
    }
    if (typeof dto.companyName === 'string') {
      admin.companyName = dto.companyName;
    }
    if (typeof dto.mobile === 'string') {
      admin.mobile = dto.mobile;
    }
    if (typeof dto.address === 'string') {
      admin.address = dto.address;
    }
    if (typeof dto.bio === 'string') {
      admin.bio = dto.bio;
    }

    const updated = await admin.save();
    return {
      success: true,
      data: {
        _id: updated._id.toString(),
        fullName: updated.fullName,
        email: updated.email,
        role: updated.role,
        companyName: updated.companyName || '',
        mobile: updated.mobile || '',
        address: updated.address || '',
        bio: updated.bio || '',
        profileCompleted: updated.profileCompleted ?? true,
      },
    };
  }

  async deleteProfile(user?: RequestUser) {
    const id = this.getUserId(user);
    const role = typeof user?.role === 'string' ? user.role : undefined;
    if (!id || !role) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid user',
      });
    }

    if (role === 'seller') {
      throw new BadRequestException({
        success: false,
        message: 'Seller profile cannot be deleted',
      });
    }

    const deleted = await this.userModel.findByIdAndDelete(id).lean().exec();
    if (!deleted) {
      throw new NotFoundException({
        success: false,
        message: 'Profile not found',
      });
    }
    return { success: true, data: { deleted: true } };
  }

  private getIp(req: RequestWithUser): string | undefined {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    if (typeof req.ip === 'string' && req.ip.length > 0) return req.ip;
    return undefined;
  }

  private getDevice(req: RequestWithUser): string | undefined {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' && ua.length > 0 ? ua : undefined;
  }

  private async logActivity(
    userId: string,
    action: string,
    req: RequestWithUser,
  ) {
    await this.userActivityLogModel.create({
      userId,
      action,
      ipAddress: this.getIp(req),
      device: this.getDevice(req),
      timestamp: new Date(),
    });
  }

  private assertSuperAdmin(role?: string) {
    if (role !== 'super_admin') {
      throw new ForbiddenException({
        success: false,
        message: 'Forbidden',
      });
    }
  }

  private resolveTargetUserId(
    params: { userId?: string | undefined },
    req: RequestWithUser,
  ) {
    const actingUserId = this.getUserId(req.user);
    const role = typeof req.user?.role === 'string' ? req.user.role : undefined;
    if (!actingUserId || !role) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid user',
      });
    }

    const targetUserId =
      params.userId && params.userId.length > 0 ? params.userId : actingUserId;
    if (targetUserId !== actingUserId) {
      this.assertSuperAdmin(role);
    }

    return { actingUserId, targetUserId, role };
  }

  private splitName(fullName?: string) {
    const safe = typeof fullName === 'string' ? fullName.trim() : '';
    if (!safe) return { firstName: undefined, lastName: undefined };
    const parts = safe.split(/\s+/g);
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  }

  private async ensureDefaults(userId: string, roleHint: string | undefined) {
    const role = roleHint === 'seller' ? 'seller' : 'user';
    const user =
      role === 'user'
        ? await this.userModel.findById(userId).lean().exec()
        : undefined;
    const seller =
      role === 'seller'
        ? await this.sellerModel.findById(userId).lean().exec()
        : undefined;
    const fallbackUser =
      !user && !seller
        ? await this.userModel.findById(userId).lean().exec()
        : undefined;
    const fallbackSeller =
      !user && !seller && !fallbackUser
        ? await this.sellerModel.findById(userId).lean().exec()
        : undefined;

    const identity = user ?? seller ?? fallbackUser ?? fallbackSeller;
    const identityRole =
      (user as unknown as { role?: string })?.role ??
      (fallbackUser as unknown as { role?: string })?.role ??
      (seller || fallbackSeller ? 'seller' : undefined);

    const fullName =
      (identity as unknown as { fullName?: string })?.fullName ??
      (identity as unknown as { name?: string })?.name ??
      '';
    const { firstName, lastName } = this.splitName(fullName);
    const email = (identity as unknown as { email?: string })?.email;
    const phone =
      (identity as unknown as { mobile?: string })?.mobile ??
      (identity as unknown as { contactNumber?: string })?.contactNumber;

    await Promise.all([
      this.userProfileModel
        .findOneAndUpdate(
          { userId },
          {
            $setOnInsert: {
              userId,
              firstName,
              lastName,
              email,
              phone,
              role: identityRole,
            },
          },
          { upsert: true, new: false },
        )
        .lean()
        .exec(),
      this.userPreferencesModel
        .findOneAndUpdate(
          { userId },
          {
            $setOnInsert: {
              userId,
              theme: 'light',
              notificationEmail: true,
              notificationSms: false,
              notificationInApp: true,
              notificationPush: false,
              eventSellerApproved: true,
              eventSupportTicketAssigned: true,
              eventSystemAlerts: true,
            },
          },
          { upsert: true, new: false },
        )
        .lean()
        .exec(),
      this.userSecurityModel
        .findOneAndUpdate(
          { userId },
          {
            $setOnInsert: {
              userId,
              twoFactorEnabled: false,
              tokenVersion: 0,
              activeSessions: [],
            },
          },
          { upsert: true, new: false },
        )
        .lean()
        .exec(),
    ]);
  }

  private computeCompletion(profile: Partial<UserProfile>) {
    const required: Array<keyof UserProfile> = [
      'profilePhoto',
      'firstName',
      'lastName',
      'email',
      'phone',
      'employeeId',
      'dateOfBirth',
      'gender',
      'designation',
      'department',
      'reportingManager',
      'joiningDate',
      'addressLine1',
      'city',
      'state',
      'country',
      'zipCode',
      'timezone',
      'preferredLanguage',
    ];
    const missing = required.filter((key) => {
      const value = (profile as Record<string, unknown>)[key as string];
      if (value instanceof Date) return Number.isNaN(value.getTime());
      if (typeof value === 'string') return value.trim().length === 0;
      return value === undefined || value === null;
    });
    const percent =
      required.length === 0
        ? 100
        : Math.round(
            ((required.length - missing.length) / required.length) * 100,
          );
    return { percentage: percent, missingFields: missing.map(String) };
  }

  async getMe(req: RequestWithUser) {
    const { targetUserId } = this.resolveTargetUserId({}, req);

    await this.ensureDefaults(targetUserId, req.user?.role);

    const [profile, preferences, security] = await Promise.all([
      this.userProfileModel.findOne({ userId: targetUserId }).lean().exec(),
      this.userPreferencesModel.findOne({ userId: targetUserId }).lean().exec(),
      this.userSecurityModel.findOne({ userId: targetUserId }).lean().exec(),
    ]);

    const completion = this.computeCompletion(
      profile ?? { userId: targetUserId },
    );

    return {
      success: true,
      data: {
        profile: profile ?? { userId: targetUserId },
        preferences:
          preferences ??
          ({
            userId: targetUserId,
            theme: 'light',
            notificationEmail: true,
            notificationSms: false,
            notificationInApp: true,
            notificationPush: false,
            eventSellerApproved: true,
            eventSupportTicketAssigned: true,
            eventSystemAlerts: true,
          } as const),
        security: security
          ? {
              twoFactorEnabled: security.twoFactorEnabled,
              lastPasswordChange: security.lastPasswordChange,
              activeSessions: security.activeSessions ?? [],
            }
          : { twoFactorEnabled: false, activeSessions: [] },
        completion,
      },
    };
  }

  async getUserProfileById(userId: string, req: RequestWithUser) {
    const { role } = this.resolveTargetUserId({ userId }, req);
    this.assertSuperAdmin(role);

    await this.ensureDefaults(userId, undefined);

    const [profile, preferences, security] = await Promise.all([
      this.userProfileModel.findOne({ userId }).lean().exec(),
      this.userPreferencesModel.findOne({ userId }).lean().exec(),
      this.userSecurityModel.findOne({ userId }).lean().exec(),
    ]);

    const completion = this.computeCompletion(profile ?? { userId });
    return {
      success: true,
      data: {
        profile: profile ?? { userId },
        preferences: preferences ?? { userId, theme: 'light' },
        security: security
          ? {
              twoFactorEnabled: security.twoFactorEnabled,
              lastPasswordChange: security.lastPasswordChange,
              activeSessions: security.activeSessions ?? [],
            }
          : { twoFactorEnabled: false, activeSessions: [] },
        completion,
      },
    };
  }

  async updateProfileManagement(
    dto: UpdateProfileManagementDto,
    params: { userId?: string | undefined },
    req: RequestWithUser,
  ) {
    const { actingUserId, targetUserId, role } = this.resolveTargetUserId(
      params,
      req,
    );

    if (dto.role && role !== 'super_admin') {
      dto.role = undefined;
    }

    const $set: Record<string, unknown> = { userId: targetUserId };
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      if (
        (key === 'dateOfBirth' || key === 'joiningDate') &&
        typeof value === 'string'
      ) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          $set[key] = parsed;
        }
        continue;
      }
      $set[key] = value;
    }

    const updatedProfile = await this.userProfileModel
      .findOneAndUpdate(
        { userId: targetUserId },
        { $set },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    if (typeof dto.email === 'string' && dto.email.length > 0) {
      const email = dto.email.toLowerCase();
      const existingUser = await this.userModel
        .findOne({ email, _id: { $ne: targetUserId } })
        .select('_id')
        .lean()
        .exec();
      const existingSeller = await this.sellerModel
        .findOne({ email, _id: { $ne: targetUserId } })
        .select('_id')
        .lean()
        .exec();
      if (existingUser || existingSeller) {
        throw new BadRequestException({
          success: false,
          message: 'Email already in use',
        });
      }

      const user = await this.userModel.findById(targetUserId).exec();
      if (user) {
        user.email = email;
        await user.save();
      } else {
        const seller = await this.sellerModel.findById(targetUserId).exec();
        if (seller) {
          seller.email = email;
          await seller.save();
        }
      }
    }

    if (
      (typeof dto.firstName === 'string' && dto.firstName.length > 0) ||
      (typeof dto.lastName === 'string' && dto.lastName.length > 0)
    ) {
      const existingUser = await this.userModel.findById(targetUserId).exec();
      if (existingUser) {
        const nextFullName = `${dto.firstName ?? ''} ${dto.lastName ?? ''}`
          .trim()
          .replace(/\s+/g, ' ');
        if (nextFullName.length > 0) {
          existingUser.fullName = nextFullName;
          await existingUser.save();
        }
      } else {
        const seller = await this.sellerModel.findById(targetUserId).exec();
        if (seller) {
          const nextFullName = `${dto.firstName ?? ''} ${dto.lastName ?? ''}`
            .trim()
            .replace(/\s+/g, ' ');
          if (nextFullName.length > 0) {
            seller.fullName = nextFullName;
            await seller.save();
          }
        }
      }
    }

    if (typeof dto.phone === 'string' && dto.phone.length > 0) {
      const user = await this.userModel.findById(targetUserId).exec();
      if (user) {
        user.mobile = dto.phone;
        await user.save();
      } else {
        const seller = await this.sellerModel.findById(targetUserId).exec();
        if (seller) {
          seller.contactNumber = dto.phone;
          await seller.save();
        }
      }
    }

    await this.logActivity(targetUserId, 'profile_updated', req);

    const completion = this.computeCompletion(updatedProfile);

    return {
      success: true,
      data: {
        profile: updatedProfile,
        completion,
        updatedBy: actingUserId,
      },
    };
  }

  async updatePreferences(
    dto: UpdatePreferencesDto,
    params: { userId?: string | undefined },
    req: RequestWithUser,
  ) {
    const { actingUserId, targetUserId } = this.resolveTargetUserId(
      params,
      req,
    );

    const updated = await this.userPreferencesModel
      .findOneAndUpdate(
        { userId: targetUserId },
        { $set: { ...dto, userId: targetUserId } },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    await this.logActivity(targetUserId, 'preferences_updated', req);

    return {
      success: true,
      data: { preferences: updated, updatedBy: actingUserId },
    };
  }

  async getActivityLogs(
    params: { userId?: string | undefined },
    req: RequestWithUser,
  ) {
    const { targetUserId } = this.resolveTargetUserId(params, req);

    const logs = await this.userActivityLogModel
      .find({ userId: targetUserId })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean()
      .exec();
    return { success: true, data: logs };
  }

  async changePassword(dto: ChangePasswordDto, req: RequestWithUser) {
    const { targetUserId } = this.resolveTargetUserId({}, req);

    const user = await this.userModel.findById(targetUserId).exec();
    const seller = user
      ? undefined
      : await this.sellerModel.findById(targetUserId).exec();
    if (!user && !seller) {
      throw new NotFoundException({
        success: false,
        message: 'Profile not found',
      });
    }

    const currentHash = user?.password ?? seller?.password ?? '';
    const ok = await bcrypt.compare(dto.currentPassword, currentHash);
    if (!ok) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid current password',
      });
    }

    const hashed = await bcrypt.hash(dto.newPassword, 10);
    if (user) {
      user.password = hashed;
      user.mustChangePassword = false;
      await user.save();
    }
    if (seller) {
      seller.password = hashed;
      await seller.save();
    }

    const security = await this.userSecurityModel
      .findOneAndUpdate(
        { userId: targetUserId },
        {
          $set: {
            userId: targetUserId,
            passwordHash: hashed,
            lastPasswordChange: new Date(),
          },
          $inc: { tokenVersion: 1 },
          $setOnInsert: { twoFactorEnabled: false },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    await this.logActivity(targetUserId, 'password_changed', req);

    return {
      success: true,
      data: {
        changed: true,
        tokenVersion: security?.tokenVersion ?? 0,
      },
    };
  }

  async logoutAllDevices(req: RequestWithUser) {
    const { targetUserId } = this.resolveTargetUserId({}, req);

    const security = await this.userSecurityModel
      .findOneAndUpdate(
        { userId: targetUserId },
        { $inc: { tokenVersion: 1 }, $set: { activeSessions: [] } },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    await this.logActivity(targetUserId, 'logout_all_devices', req);

    return {
      success: true,
      data: { loggedOut: true, tokenVersion: security?.tokenVersion ?? 0 },
    };
  }

  async setTwoFactorEnabled(
    body: { enabled?: boolean },
    params: { userId?: string | undefined },
    req: RequestWithUser,
  ) {
    const enabled = body?.enabled;
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException({
        success: false,
        message: 'enabled must be a boolean',
      });
    }

    const { actingUserId, targetUserId } = this.resolveTargetUserId(
      params,
      req,
    );

    const security = await this.userSecurityModel
      .findOneAndUpdate(
        { userId: targetUserId },
        {
          $set: { userId: targetUserId, twoFactorEnabled: enabled },
          $setOnInsert: { tokenVersion: 0, activeSessions: [] },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    await this.logActivity(
      targetUserId,
      enabled ? 'two_factor_enabled' : 'two_factor_disabled',
      req,
    );

    return {
      success: true,
      data: {
        twoFactorEnabled: security?.twoFactorEnabled ?? enabled,
        updatedBy: actingUserId,
      },
    };
  }
}
