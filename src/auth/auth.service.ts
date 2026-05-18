import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
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
import { getMongoStorageMode, isInMemoryMongo } from '../config/mongo-connection';

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

/** Sellers in these stages cannot log in yet (no credentials / payment not done). */
const blockedSellerLoginStatuses = new Set([
  'lead_generated',
  'sales_contacted',
  'payment_pending',
]);

const disabledAdminStatuses = new Set(['blocked', 'rejected']);

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

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

  async onModuleInit() {
    await this.ensureDevSuperAdmin();
    const mode = getMongoStorageMode();
    this.logger.log(
      `Mongo storage mode: ${mode} database=${this.connection.db?.databaseName ?? 'unknown'}`,
    );
    if (isInMemoryMongo()) {
      this.logger.warn(
        'Running on in-memory MongoDB — only users in this empty DB exist. Connect Atlas to use ecommreco_dev data.',
      );
    }
  }

  async login(dto: LoginDto, req: Request) {
    this.logger.log(`Login attempt for identifier: ${dto.email}`);
    const rawIdentifier =
      typeof dto.email === 'string' ? dto.email.trim() : String(dto.email);
    const identifierQuery = this.buildIdentifierQuery(rawIdentifier);

    const [seller, adminUser] = await Promise.all([
      this.sellerModel.findOne(identifierQuery).lean().exec(),
      this.userModel.findOne(identifierQuery).lean().exec(),
    ]);

    this.logger.log(
      `User lookup → adminUser found: ${!!adminUser} seller found: ${!!seller} (identifier=${rawIdentifier})`,
    );

    if (adminUser) {
      this.logger.log(
        `Admin found: id=${adminUser._id} email=${adminUser.email} role=${adminUser.role} status=${adminUser.status}`,
      );
      const ok = await this.verifyPassword(adminUser.password, dto.password);
      this.logger.log(`Password verify result for admin: ${ok}`);
      if (ok) {
        const adminStatus = adminUser.status ?? 'approved';
        if (disabledAdminStatuses.has(adminStatus)) {
          throw new UnauthorizedException({
            success: false,
            message: 'Account is disabled',
            errorCode: 'ACCOUNT_DISABLED',
          });
        }
        if (adminStatus === 'pending') {
          throw new UnauthorizedException({
            success: false,
            message: 'Account is pending approval',
            errorCode: 'ACCOUNT_PENDING',
          });
        }
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
      this.logger.log(
        `Seller found: id=${seller._id} email=${seller.email} onboardingStatus=${seller.onboardingStatus}`,
      );
      const passwordOk = await this.verifyPassword(
        seller.password ?? '',
        dto.password,
      );
      this.logger.log(`Password verify result for seller: ${passwordOk}`);
      if (passwordOk) {
        const loginCheck = this.evaluateSellerLogin(seller);
        if (!loginCheck.allowed) {
          throw new UnauthorizedException({
            success: false,
            message: loginCheck.message,
            errorCode: loginCheck.errorCode,
          });
        }

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

    this.logger.warn(
      `Login failed for ${rawIdentifier}: no matching user/seller found or password mismatch`,
    );
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

  async health() {
    this.assertDatabaseConnected();
    const db = this.connection.db;
    const storageMode = getMongoStorageMode();
    let userCount = 0;
    let sellerCount = 0;
    try {
      userCount = await this.userModel.countDocuments().exec();
      sellerCount = await this.sellerModel.countDocuments().exec();
    } catch {
      // ignore count errors on health
    }
    return {
      success: true,
      data: {
        status: 'ok',
        database: 'connected',
        databaseName: db?.databaseName,
        storageMode,
        inMemoryFallback: isInMemoryMongo(),
        userCount,
        sellerCount,
        timestamp: new Date().toISOString(),
      },
    };
  }

  async databaseConnection() {
    this.assertDatabaseConnected();
    const db = this.connection.db;
    const userCount = await this.userModel.countDocuments().exec();
    const sellerCount = await this.sellerModel.countDocuments().exec();
    return {
      success: true,
      data: {
        readyState: this.connection.readyState,
        host: this.connection.host,
        port: this.connection.port,
        name: this.connection.name,
        database: db?.databaseName,
        storageMode: getMongoStorageMode(),
        inMemoryFallback: isInMemoryMongo(),
        userCount,
        sellerCount,
      },
    };
  }

  debugDb(params: { setupToken?: string }) {
    this.assertSetupToken(params);
    return this.databaseConnection();
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

  private async ensureDevSuperAdmin() {
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
    if (nodeEnv === 'production') {
      return;
    }
    // Only auto-seed when using in-memory DB (empty). Never seed over Atlas ecommreco_dev data.
    if (!isInMemoryMongo()) {
      return;
    }

    const existingSuperAdmin = await this.userModel
      .findOne({ role: 'super_admin' })
      .select('_id email')
      .lean()
      .exec();
    if (existingSuperAdmin) {
      return;
    }

    const email = (
      this.configService.get<string>('DEV_SUPER_ADMIN_EMAIL') ??
      'superadmin@example.com'
    )
      .trim()
      .toLowerCase();
    const password =
      this.configService.get<string>('DEV_SUPER_ADMIN_PASSWORD') ??
      'password123';
    const fullName =
      this.configService.get<string>('DEV_SUPER_ADMIN_NAME') ?? 'Super Admin';
    const mobile = this.configService.get<string>('DEV_SUPER_ADMIN_MOBILE');
    const hashedPassword = await bcrypt.hash(password, 10);

    await this.userModel.create({
      publicId: generatePublicId('super_admin', email),
      fullName,
      email,
      username: email,
      password: hashedPassword,
      role: 'super_admin',
      mobile,
      status: 'approved',
      profileCompleted: true,
      mustChangePassword: false,
      credentialsGeneratedAt: new Date(),
      credentialsGeneratedBy: 'system',
    });

    this.logger.log(`Created development super admin: ${email}`);
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

  private buildIdentifierQuery(identifier: string) {
    const trimmed = identifier.trim();
    const pattern = new RegExp(`^${this.escapeRegex(trimmed)}$`, 'i');
    return {
      $or: [{ email: pattern }, { username: pattern }],
    };
  }

  private evaluateSellerLogin(seller: {
    onboardingStatus?: string;
    password?: string;
  }): { allowed: boolean; message?: string; errorCode?: string } {
    const status = seller.onboardingStatus ?? 'payment_pending';
    const hasPassword =
      typeof seller.password === 'string' && seller.password.trim().length > 0;

    if (!hasPassword) {
      return {
        allowed: false,
        message:
          'Login credentials are not set yet. Contact support to complete onboarding.',
        errorCode: 'SELLER_NO_CREDENTIALS',
      };
    }

    if (blockedSellerLoginStatuses.has(status)) {
      return {
        allowed: false,
        message:
          'Account is not ready for login yet. Complete payment and credential setup first.',
        errorCode: 'SELLER_NOT_APPROVED',
      };
    }

    return { allowed: true };
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

  private assertDatabaseConnected() {
    if (Number(this.connection.readyState) !== 1) {
      throw new ServiceUnavailableException({
        success: false,
        message: 'Database connection is not established',
        errorCode: 'DB_NOT_CONNECTED',
      });
    }
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
