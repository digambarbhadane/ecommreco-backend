import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { generatePublicId } from '../common/public-id';
import { ConfigService } from '@nestjs/config';
import {
  UserSecurity,
  UserSecurityDocument,
} from '../profile/schemas/user-security.schema';
import {
  UserActivityLog,
  UserActivityLogDocument,
} from '../profile/schemas/user-activity-log.schema';

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'pending' | 'approved' | 'rejected' | 'blocked';
  profileCompleted: boolean;
  companyName?: string;
  mobile?: string;
  password: string;
};

const allowedSellerStatuses = new Set([
  'credentials_sent',
  'training_pending',
  'training_completed',
  'active',
]);

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(UserSecurity.name)
    private readonly userSecurityModel: Model<UserSecurityDocument>,
    @InjectModel(UserActivityLog.name)
    private readonly userActivityLogModel: Model<UserActivityLogDocument>,
  ) {}

  async login(dto: LoginDto, req: Request) {
    const identifier = dto.email.toLowerCase();
    const email = identifier;
    const seller = await this.sellerModel.findOne({ email }).lean().exec();
    const sellerUser = seller
      ? {
          id: seller._id.toString(),
          name: seller.fullName,
          email: seller.email,
          role: 'seller' as const,
          status: (allowedSellerStatuses.has(seller.onboardingStatus)
            ? 'approved'
            : 'pending') as AuthUser['status'],
          profileCompleted: allowedSellerStatuses.has(seller.onboardingStatus),
          companyName: seller.gstNumber,
          mobile: seller.contactNumber,
          password: seller.password ?? '',
        }
      : undefined;
    const adminUser = await this.userModel
      .findOne({
        $or: [{ email: identifier }, { username: identifier }],
      })
      .lean()
      .exec();
    const adminAuthUser = adminUser
      ? {
          id: adminUser._id.toString(),
          name: adminUser.fullName,
          email: adminUser.email,
          role: adminUser.role,
          status: adminUser.status ?? 'approved',
          profileCompleted: adminUser.profileCompleted ?? true,
          companyName: adminUser.companyName,
          mobile: adminUser.mobile,
          password: adminUser.password,
        }
      : undefined;
    const user = sellerUser ?? adminAuthUser;
    const passwordOk = user
      ? await this.verifyPassword(user.password, dto.password)
      : false;
    if (
      !user ||
      !passwordOk ||
      (user.role === 'seller' &&
        !allowedSellerStatuses.has(seller?.onboardingStatus ?? ''))
    ) {
      throw new UnauthorizedException({
        success: false,
        message: 'Invalid credentials',
        errorCode: 'INVALID_CREDENTIALS',
      });
    }

    const now = new Date();
    const sessionId = randomUUID();
    const ipAddress = this.getIp(req);
    const device = this.getDevice(req);

    const security = await this.userSecurityModel
      .findOneAndUpdate(
        { userId: user.id },
        {
          $setOnInsert: {
            userId: user.id,
            twoFactorEnabled: false,
            tokenVersion: 0,
          },
          $push: {
            activeSessions: {
              $each: [
                {
                  sessionId,
                  ipAddress,
                  device,
                  createdAt: now,
                  lastSeenAt: now,
                },
              ],
              $slice: -10,
            },
          },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    await this.userActivityLogModel.create({
      userId: user.id,
      action: 'login_successful',
      ipAddress,
      device,
      timestamp: now,
    });

    const tokenVersion =
      typeof security?.tokenVersion === 'number' ? security.tokenVersion : 0;

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
      email: user.email,
      tokenVersion,
      sessionId,
    });

    const { password, ...safeUser } = user;
    void password;

    return {
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        user: safeUser,
      },
    };
  }

  async bootstrapSuperAdmin(
    params: { setupToken?: string },
    dto: { fullName: string; email: string; password: string; mobile?: string },
  ) {
    const expected = this.configService.get<string>('SUPER_ADMIN_SETUP_TOKEN');
    if (!expected || expected.length === 0) {
      throw new UnauthorizedException({
        success: false,
        message: 'Bootstrap is not enabled',
        errorCode: 'BOOTSTRAP_DISABLED',
      });
    }
    if (!params.setupToken || params.setupToken !== expected) {
      throw new UnauthorizedException({
        success: false,
        message: 'Invalid setup token',
        errorCode: 'INVALID_SETUP_TOKEN',
      });
    }

    const existingSuperAdmin = await this.userModel
      .findOne({ role: 'super_admin' })
      .select('_id')
      .lean()
      .exec();
    if (existingSuperAdmin) {
      throw new UnauthorizedException({
        success: false,
        message: 'Super admin already exists',
        errorCode: 'SUPER_ADMIN_EXISTS',
      });
    }

    const email = dto.email.toLowerCase();
    const existingEmail = await this.userModel
      .findOne({ email })
      .select('_id')
      .lean()
      .exec();
    if (existingEmail) {
      throw new UnauthorizedException({
        success: false,
        message: 'Email already in use',
        errorCode: 'EMAIL_IN_USE',
      });
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const created = await this.userModel.create({
      publicId: generatePublicId('super_admin', email),
      fullName: dto.fullName,
      email,
      password: hashedPassword,
      role: 'super_admin',
      mobile: dto.mobile,
      status: 'approved',
      profileCompleted: true,
      mustChangePassword: false,
      credentialsGeneratedAt: new Date(),
      credentialsGeneratedBy: 'bootstrap',
    });

    const safe = await this.userModel
      .findById(created._id)
      .select('-password')
      .lean()
      .exec();
    return { success: true, data: safe };
  }

  private async verifyPassword(stored: string, provided: string) {
    if (typeof stored !== 'string' || typeof provided !== 'string')
      return false;
    if (
      stored.startsWith('$2a$') ||
      stored.startsWith('$2b$') ||
      stored.startsWith('$2y$')
    ) {
      return bcrypt.compare(provided, stored);
    }
    return stored === provided;
  }

  private getIp(req: Request) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      return forwardedFor.split(',')[0]?.trim() || req.ip || 'unknown';
    }
    return req.ip || 'unknown';
  }

  private getDevice(req: Request) {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' && ua.length > 0 ? ua : 'unknown';
  }
}
