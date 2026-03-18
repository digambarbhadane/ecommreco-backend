import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
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
    @InjectConnection() private readonly connection: Connection,
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
    const rawIdentifier =
      typeof dto.email === 'string' ? dto.email.trim() : String(dto.email);
    const matchIdentifier = {
      $regex: `^${this.escapeRegex(rawIdentifier)}$`,
      $options: 'i',
    };

    const [seller, adminUser] = await Promise.all([
      this.sellerModel
        .findOne({
          $or: [{ email: matchIdentifier }, { username: matchIdentifier }],
        })
        .lean()
        .exec(),
      this.userModel
        .findOne({
          $or: [{ email: matchIdentifier }, { username: matchIdentifier }],
        })
        .lean()
        .exec(),
    ]);

    if (adminUser) {
      const ok = await this.verifyPassword(adminUser.password, dto.password);
      if (ok) {
        const user: AuthUser = {
          id: adminUser._id.toString(),
          name: adminUser.fullName,
          email: adminUser.email,
          role: adminUser.role,
          status: adminUser.status ?? 'approved',
          profileCompleted: adminUser.profileCompleted ?? true,
          companyName: adminUser.companyName,
          mobile: adminUser.mobile,
          password: adminUser.password,
        };

        return this.issueToken(user, req);
      }
    }

    if (seller) {
      const passwordOk = await this.verifyPassword(
        seller.password ?? '',
        dto.password,
      );
      if (
        passwordOk &&
        !allowedSellerStatuses.has(seller.onboardingStatus ?? '')
      ) {
        throw new UnauthorizedException({
          success: false,
          message: 'Account not approved yet',
          errorCode: 'SELLER_NOT_APPROVED',
        });
      }
      if (
        passwordOk &&
        allowedSellerStatuses.has(seller.onboardingStatus ?? '')
      ) {
        const user: AuthUser = {
          id: seller._id.toString(),
          name: seller.fullName,
          email: seller.email,
          role: 'seller',
          status: 'approved',
          profileCompleted: true,
          companyName: seller.gstNumber,
          mobile: seller.contactNumber,
          password: seller.password ?? '',
        };

        return this.issueToken(user, req);
      }
    }

    throw new UnauthorizedException({
      success: false,
      message: 'Invalid credentials',
      errorCode: 'INVALID_CREDENTIALS',
    });
  }

  private async issueToken(user: AuthUser, req: Request) {
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
    this.assertSetupToken(params);

    const existingSuperAdmin = await this.userModel
      .findOne({ role: 'super_admin' })
      .exec();

    const email = dto.email.toLowerCase();
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    if (existingSuperAdmin) {
      const existingEmail = String(
        existingSuperAdmin.email || '',
      ).toLowerCase();
      if (existingEmail !== email) {
        throw new UnauthorizedException({
          success: false,
          message: 'Super admin already exists',
          errorCode: 'SUPER_ADMIN_EXISTS',
        });
      }

      await this.userModel.updateOne(
        { _id: existingSuperAdmin._id },
        {
          $set: {
            fullName: dto.fullName,
            email,
            username: email,
            password: hashedPassword,
            mobile: dto.mobile,
            status: 'approved',
            profileCompleted: true,
            mustChangePassword: false,
            credentialsGeneratedAt: new Date(),
            credentialsGeneratedBy: 'bootstrap',
          },
        },
      );

      const safe = await this.userModel
        .findById(existingSuperAdmin._id)
        .select('-password')
        .lean()
        .exec();
      return { success: true, data: safe };
    }

    const existingEmailUser = await this.userModel
      .findOne({ email })
      .select('_id')
      .lean()
      .exec();
    if (existingEmailUser) {
      throw new UnauthorizedException({
        success: false,
        message: 'Email already in use',
        errorCode: 'EMAIL_IN_USE',
      });
    }

    const created = await this.userModel.create({
      publicId: generatePublicId('super_admin', email),
      fullName: dto.fullName,
      email,
      username: email,
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

  debugDb(params: { setupToken?: string }) {
    this.assertSetupToken(params);
    const db = this.connection.db;
    return {
      success: true,
      data: {
        readyState: this.connection.readyState,
        host: this.connection.host,
        port: this.connection.port,
        name: this.connection.name,
        database: db?.databaseName,
      },
    };
  }

  async debugSuperAdmin(params: { setupToken?: string }) {
    this.assertSetupToken(params);
    const superAdmin = await this.userModel
      .findOne({ role: 'super_admin' })
      .select('_id email username status role')
      .lean()
      .exec();
    return {
      success: true,
      data: {
        exists: Boolean(superAdmin),
        superAdmin: superAdmin
          ? {
              id: superAdmin._id?.toString?.() ?? String(superAdmin._id),
              email: superAdmin.email,
              username: superAdmin.username,
              role: superAdmin.role,
              status: superAdmin.status,
            }
          : null,
      },
    };
  }

  async debugIdentity(
    params: { setupToken?: string },
    dto: { identifier?: string },
  ) {
    this.assertSetupToken(params);
    const identifier =
      typeof dto.identifier === 'string' ? dto.identifier.trim() : '';
    const normalized = identifier.toLowerCase();
    if (!normalized) {
      return { success: true, data: { identifier: '', matches: [] } };
    }

    const matchIdentifier = {
      $regex: `^${this.escapeRegex(normalized)}$`,
      $options: 'i',
    };

    const [users, sellers] = await Promise.all([
      this.userModel
        .find({
          $or: [{ email: matchIdentifier }, { username: matchIdentifier }],
        })
        .select('_id email username role status')
        .limit(5)
        .lean()
        .exec(),
      this.sellerModel
        .find({
          $or: [{ email: matchIdentifier }, { username: matchIdentifier }],
        })
        .select('_id email username onboardingStatus')
        .limit(5)
        .lean()
        .exec(),
    ]);

    const matches: Array<Record<string, unknown>> = [];
    for (const u of users) {
      matches.push({
        kind: 'user',
        id: u._id?.toString?.() ?? String(u._id),
        email: u.email,
        username: u.username,
        role: u.role,
        status: u.status,
      });
    }
    for (const s of sellers) {
      matches.push({
        kind: 'seller',
        id: s._id?.toString?.() ?? String(s._id),
        email: s.email,
        username: (s as { username?: string }).username,
        onboardingStatus: (s as { onboardingStatus?: string }).onboardingStatus,
      });
    }

    return {
      success: true,
      data: {
        identifier: normalized,
        matches,
      },
    };
  }

  async devResetPassword(
    params: { setupToken?: string },
    dto: { identifier: string; password: string },
  ) {
    this.assertSetupToken(params);
    const identifier =
      typeof dto.identifier === 'string'
        ? dto.identifier.trim().toLowerCase()
        : '';
    if (!identifier) {
      throw new NotFoundException({
        success: false,
        message: 'User not found',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    const matchIdentifier = {
      $regex: `^${this.escapeRegex(identifier)}$`,
      $options: 'i',
    };

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const [user, seller] = await Promise.all([
      this.userModel
        .findOne({
          $or: [{ email: matchIdentifier }, { username: matchIdentifier }],
        })
        .select('_id role email username')
        .lean()
        .exec(),
      this.sellerModel
        .findOne({
          $or: [{ email: matchIdentifier }, { username: matchIdentifier }],
        })
        .select('_id email username')
        .lean()
        .exec(),
    ]);

    if (user) {
      await this.userModel.updateOne(
        { _id: user._id },
        {
          $set: {
            password: hashedPassword,
            email: String(user.email || identifier).toLowerCase(),
            username: String(
              user.username || user.email || identifier,
            ).toLowerCase(),
            mustChangePassword: false,
          },
        },
      );
      return { success: true, data: { role: user.role, identifier } };
    }

    if (seller) {
      await this.sellerModel.updateOne(
        { _id: seller._id },
        {
          $set: {
            password: hashedPassword,
            email: String(seller.email || identifier).toLowerCase(),
            username: String(
              seller.username || seller.email || identifier,
            ).toLowerCase(),
          },
        },
      );
      return { success: true, data: { role: 'seller', identifier } };
    }

    throw new NotFoundException({
      success: false,
      message: 'User not found',
      errorCode: 'USER_NOT_FOUND',
    });
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

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private assertSetupToken(params: { setupToken?: string }) {
    const expected = this.configService.get<string>('SUPER_ADMIN_SETUP_TOKEN');
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
    if (nodeEnv === 'production') {
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
      return;
    }
    void expected;
    void params;
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
