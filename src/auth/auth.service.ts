import {
  BadRequestException,
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
import { createHash, randomUUID } from 'crypto';
import { LoginDto } from './dto/login.dto';
import type { Request } from 'express';
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
import {
  getMongoStorageMode,
  isInMemoryMongo,
} from '../config/mongo-connection';
import { evaluateSellerLogin } from '../trial/trial-login.policy';
import { isMongoDisconnectedError } from '../common/utils/mongo-errors';
import { SessionRevocationService } from './session-revocation.service';
import { OtpService } from '../otp/otp.service';
import { OTP_PURPOSE } from '../otp/otp.constants';
import { normalizeIndianMobile } from '../otp/otp.helper';

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

type TokenPairPayload = {
  sub: string;
  role: string;
  email: string;
  tokenVersion: number;
  sessionId: string;
  typ: 'access' | 'refresh';
  jti?: string;
};

const ACCESS_TOKEN_TTL = '30m';
const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
    private readonly sessionRevocationService: SessionRevocationService,
    private readonly otpService: OtpService,
  ) {}

  async onModuleInit() {
    await this.ensureDevSuperAdmin();
    const mode = getMongoStorageMode();
    this.logger.log(
      `Mongo storage mode: ${mode} database=${this.connection.db?.databaseName ?? 'unknown'}`,
    );
    if (isInMemoryMongo()) {
      this.logger.warn(
        'Running on in-memory MongoDB — data is empty/ephemeral. Set USE_MEMORY_DB=false and configure MONGODB_URI_STANDARD for Atlas.',
      );
    } else if (mode === 'fallback') {
      this.logger.warn(
        'Running on local MongoDB fallback — Atlas data is NOT visible. Set MONGODB_URI_STANDARD in your .env file (Windows querySrv fix).',
      );
    }
  }

  async login(dto: LoginDto, req: Request) {
    try {
      return await this.authenticateLogin(dto, req);
    } catch (error: unknown) {
      if (isMongoDisconnectedError(error)) {
        this.logger.error(
          `Login aborted — MongoDB unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new ServiceUnavailableException({
          success: false,
          statusCode: 503,
          errorCode: 'DATABASE_UNAVAILABLE',
          message: 'Database is reconnecting. Please retry in a moment.',
        });
      }
      throw error;
    }
  }

  private async authenticateLogin(dto: LoginDto, req: Request) {
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
          const onboardingStatus = (
            adminUser as { onboardingUserStatus?: string }
          ).onboardingUserStatus;
          if (onboardingStatus !== 'PENDING_PAYMENT') {
            throw new UnauthorizedException({
              success: false,
              message: 'Account is pending approval',
              errorCode: 'ACCOUNT_PENDING',
            });
          }
        }
        if (adminUser.role === 'seller') {
          const onboardingStatus = (
            adminUser as { onboardingUserStatus?: string }
          ).onboardingUserStatus;
          if (onboardingStatus === 'PENDING_PAYMENT') {
            throw new UnauthorizedException({
              success: false,
              message:
                'Complete your trial payment of ₹499 + GST to activate your account.',
              errorCode: 'ONBOARDING_PAYMENT_PENDING',
              sellerId: adminUser._id.toString(),
            });
          } else if (onboardingStatus === 'BLOCKED') {
            throw new UnauthorizedException({
              success: false,
              message: 'Your account is blocked. Contact support.',
              errorCode: 'ACCOUNT_BLOCKED',
            });
          } else {
            const sellerForLogin =
              seller ??
              (await this.sellerModel
                .findOne({ email: adminUser.email })
                .lean()
                .exec());
            const loginCheck = this.evaluateSellerLogin(
              sellerForLogin ?? { onboardingStatus: 'payment_pending' },
            );
            if (!loginCheck.allowed) {
              this.throwLoginDenied(loginCheck);
            }
          }
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
          this.throwLoginDenied(loginCheck);
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
    const refreshJti = randomUUID();
    const ipAddress = this.getIp(req);
    const device = this.getDevice(req);
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

    const existingSecurity = await this.userSecurityModel
      .findOne({ userId: user.id })
      .select('tokenVersion')
      .lean()
      .exec();

    const tokenVersion =
      typeof existingSecurity?.tokenVersion === 'number'
        ? existingSecurity.tokenVersion
        : 0;

    const accessToken = await this.signAccessToken({
      sub: user.id,
      role: user.role,
      email: user.email,
      tokenVersion,
      sessionId,
      typ: 'access',
    });

    const refreshToken = await this.signRefreshToken({
      sub: user.id,
      role: user.role,
      email: user.email,
      tokenVersion,
      sessionId,
      typ: 'refresh',
      jti: refreshJti,
    });

    const tokenHash = this.hashToken(refreshToken);

    await this.userSecurityModel
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
            refreshTokens: {
              $each: [
                {
                  jti: refreshJti,
                  sessionId,
                  tokenHash,
                  expiresAt: refreshExpiresAt,
                  createdAt: now,
                },
              ],
              $slice: -20,
            },
          },
        },
        { upsert: true },
      )
      .exec();

    await this.userActivityLogModel.create({
      userId: user.id,
      action: 'login_successful',
      ipAddress,
      device,
      timestamp: now,
    });

    const { password, ...safeUser } = user;
    void password;

    return {
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
        expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        user: safeUser,
      },
    };
  }

  async refreshAccessToken(refreshToken: string, req?: Request) {
    const token = String(refreshToken ?? '').trim();
    if (!token) {
      throw new UnauthorizedException({
        success: false,
        message: 'Refresh token is required',
        errorCode: 'REFRESH_TOKEN_REQUIRED',
      });
    }

    let payload: TokenPairPayload;
    try {
      payload = await this.verifyToken<TokenPairPayload>(token);
    } catch {
      throw new UnauthorizedException({
        success: false,
        message: 'Your session has expired. Please login again.',
        errorCode: 'REFRESH_TOKEN_INVALID',
      });
    }

    if (payload.typ !== 'refresh' || !payload.jti || !payload.sessionId) {
      throw new UnauthorizedException({
        success: false,
        message: 'Your session has expired. Please login again.',
        errorCode: 'REFRESH_TOKEN_INVALID',
      });
    }

    const security = await this.userSecurityModel
      .findOne({ userId: payload.sub })
      .lean()
      .exec();
    if (!security) {
      throw new UnauthorizedException({
        success: false,
        message: 'Your session has expired. Please login again.',
        errorCode: 'REFRESH_TOKEN_REVOKED',
      });
    }

    const currentVersion =
      typeof security.tokenVersion === 'number' ? security.tokenVersion : 0;
    if (payload.tokenVersion !== currentVersion) {
      throw new UnauthorizedException({
        success: false,
        message: 'Your session has expired. Please login again.',
        errorCode: 'REFRESH_TOKEN_REVOKED',
      });
    }

    const tokenHash = this.hashToken(token);
    const stored = (security.refreshTokens ?? []).find(
      (entry) => entry.jti === payload.jti,
    );
    if (!stored) {
      this.logger.warn(
        `Refresh replay suspected: userId=${payload.sub} sessionId=${payload.sessionId} jti not found`,
      );
      await this.revokeSessionCredentials(payload.sub, payload.sessionId);
      throw new UnauthorizedException({
        success: false,
        message: 'Your session has expired. Please login again.',
        errorCode: 'REFRESH_TOKEN_REUSED',
      });
    }
    if (stored.tokenHash !== tokenHash) {
      this.logger.warn(
        `Refresh hash mismatch: userId=${payload.sub} sessionId=${payload.sessionId}`,
      );
      await this.revokeSessionCredentials(payload.sub, payload.sessionId);
      throw new UnauthorizedException({
        success: false,
        message: 'Your session has expired. Please login again.',
        errorCode: 'REFRESH_TOKEN_REUSED',
      });
    }
    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      await this.revokeSessionCredentials(payload.sub, payload.sessionId);
      throw new UnauthorizedException({
        success: false,
        message: 'Your session has expired. Please login again.',
        errorCode: 'REFRESH_TOKEN_EXPIRED',
      });
    }

    const sessionActive = (security.activeSessions ?? []).some(
      (session) => session.sessionId === payload.sessionId,
    );
    const now = new Date();
    const refreshJti = randomUUID();
    const rotatedRefreshToken = await this.signRefreshToken({
      sub: payload.sub,
      role: payload.role,
      email: payload.email,
      tokenVersion: currentVersion,
      sessionId: payload.sessionId,
      typ: 'refresh',
      jti: refreshJti,
    });
    const refreshHash = this.hashToken(rotatedRefreshToken);
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

    // $pull and $push on the same array field is not allowed in a single
    // MongoDB update, so we remove the old token first, then push the new one.
    await this.userSecurityModel
      .updateOne(
        { userId: payload.sub },
        { $pull: { refreshTokens: { jti: payload.jti } } },
      )
      .exec();

    const pushUpdate: Record<string, unknown> = {
      refreshTokens: {
        $each: [
          {
            jti: refreshJti,
            sessionId: payload.sessionId,
            tokenHash: refreshHash,
            expiresAt: refreshExpiresAt,
            createdAt: now,
          },
        ],
        $slice: -20,
      },
    };
    if (!sessionActive) {
      pushUpdate.activeSessions = {
        $each: [
          {
            sessionId: payload.sessionId,
            ipAddress: req ? this.getIp(req) : 'unknown',
            device: req ? this.getDevice(req) : 'unknown',
            createdAt: now,
            lastSeenAt: now,
          },
        ],
        $slice: -10,
      };
    }
    await this.userSecurityModel
      .updateOne({ userId: payload.sub }, { $push: pushUpdate })
      .exec();

    const account = await this.loadActiveAuthAccount(
      payload.sub,
      payload.role,
      {
        enforceLoginPolicy: false,
      },
    );

    if (sessionActive && req) {
      await this.userSecurityModel.updateOne(
        {
          userId: payload.sub,
          'activeSessions.sessionId': payload.sessionId,
        },
        {
          $set: {
            'activeSessions.$.lastSeenAt': now,
          },
        },
      );
    }

    const accessToken = await this.signAccessToken({
      sub: account.id,
      role: account.role,
      email: account.email,
      tokenVersion: currentVersion,
      sessionId: payload.sessionId,
      typ: 'access',
    });

    return {
      success: true,
      message: 'Token refreshed',
      data: {
        accessToken,
        refreshToken: rotatedRefreshToken,
        expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
        expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        user: account,
      },
    };
  }

  async logout(params: {
    userId?: string;
    sessionId?: string;
    refreshToken?: string;
  }) {
    const userId = String(params.userId ?? '').trim();
    const sessionId = String(params.sessionId ?? '').trim();
    const refreshToken = String(params.refreshToken ?? '').trim();

    if (!userId) {
      return { success: true, message: 'Logged out' };
    }

    const pull: Record<string, unknown> = {};
    if (sessionId) {
      pull.activeSessions = { sessionId };
    }
    if (refreshToken) {
      try {
        const payload = await this.verifyToken<TokenPairPayload>(refreshToken, {
          ignoreExpiration: true,
        });
        if (payload.jti) {
          pull.refreshTokens = { jti: payload.jti };
        }
      } catch {
        // ignore invalid refresh on logout
      }
    } else if (sessionId) {
      pull.refreshTokens = { sessionId };
    }

    if (Object.keys(pull).length) {
      await this.userSecurityModel
        .updateOne({ userId }, { $pull: pull })
        .exec();
    }

    return { success: true, message: 'Logged out' };
  }

  stripRefreshTokenFromResult<T extends { data?: { refreshToken?: string } }>(
    result: T,
  ): T {
    if (!result?.data || !('refreshToken' in result.data)) {
      return result;
    }
    const data = { ...result.data };
    delete data.refreshToken;
    return { ...result, data };
  }

  private jwtSecret() {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    return secret;
  }

  private signAccessToken(payload: TokenPairPayload) {
    return this.jwtService.signAsync(payload, {
      secret: this.jwtSecret(),
      expiresIn: ACCESS_TOKEN_TTL,
    });
  }

  private signRefreshToken(payload: TokenPairPayload) {
    return this.jwtService.signAsync(payload, {
      secret: this.jwtSecret(),
      expiresIn: REFRESH_TOKEN_TTL,
    });
  }

  private verifyToken<T extends object>(
    token: string,
    options?: { ignoreExpiration?: boolean },
  ) {
    return this.jwtService.verifyAsync<T>(token, {
      secret: this.jwtSecret(),
      ignoreExpiration: options?.ignoreExpiration,
    });
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async revokeSessionCredentials(userId: string, sessionId: string) {
    await this.userSecurityModel
      .updateOne(
        { userId },
        {
          $pull: {
            refreshTokens: { sessionId },
            activeSessions: { sessionId },
          },
        },
      )
      .exec();
  }

  /** Best-effort decode for logout when access token may already be expired. */
  async decodeAccessToken(token: string) {
    const payload = await this.verifyToken<TokenPairPayload>(token, {
      ignoreExpiration: true,
    });
    return {
      sub: String(payload.sub ?? ''),
      sessionId: String(payload.sessionId ?? ''),
      typ: payload.typ,
    };
  }

  private getJwtExpiryMs(payload: TokenPairPayload & { exp?: number }) {
    if (typeof payload.exp === 'number' && payload.exp > 0) {
      return payload.exp * 1000;
    }
    return null;
  }

  private async loadActiveAuthAccount(
    userId: string,
    role?: string,
    options?: { enforceLoginPolicy?: boolean },
  ) {
    const enforceLoginPolicy = options?.enforceLoginPolicy ?? true;
    if (role === 'seller') {
      const seller = await this.sellerModel
        .findById(userId)
        .select('-password')
        .lean()
        .exec();
      if (seller) {
        if (enforceLoginPolicy) {
          const loginCheck = this.evaluateSellerLogin(seller);
          if (!loginCheck.allowed) {
            this.throwLoginDenied(loginCheck);
          }
        }
        return {
          id: String(seller._id),
          sellerId: String(seller._id),
          name: String(
            (seller as { fullName?: string }).fullName ??
              (seller as { email?: string }).email ??
              '',
          ),
          email: String((seller as { email?: string }).email ?? ''),
          role: 'seller',
          status: 'approved' as const,
          profileCompleted: true,
          companyName: String(
            (seller as { firmName?: string }).firmName ??
              (seller as { tradeName?: string }).tradeName ??
              '',
          ),
          mobile: String((seller as { mobile?: string }).mobile ?? ''),
        };
      }

      const sellerUser = await this.userModel
        .findOne({ _id: userId, role: 'seller' })
        .select('-password')
        .lean()
        .exec();
      if (!sellerUser) {
        throw new UnauthorizedException({
          success: false,
          message: 'Your session has expired. Please login again.',
          errorCode: 'ACCOUNT_NOT_FOUND',
        });
      }
      if (disabledAdminStatuses.has(String(sellerUser.status ?? ''))) {
        throw new UnauthorizedException({
          success: false,
          message: 'Account is disabled',
          errorCode: 'ACCOUNT_DISABLED',
        });
      }
      let linkedSeller = sellerUser.sellerId
        ? await this.sellerModel
            .findById(sellerUser.sellerId)
            .select('-password')
            .lean()
            .exec()
        : null;
      if (!linkedSeller && sellerUser.email) {
        const email = String(sellerUser.email).trim().toLowerCase();
        linkedSeller = await this.sellerModel
          .findOne({ $or: [{ email }, { username: email }] })
          .select('-password')
          .lean()
          .exec();
      }
      if (linkedSeller) {
        if (enforceLoginPolicy) {
          const loginCheck = this.evaluateSellerLogin(linkedSeller);
          if (!loginCheck.allowed) {
            this.throwLoginDenied(loginCheck);
          }
        }
      }
      return {
        id: String(sellerUser._id),
        sellerId:
          linkedSeller?._id != null
            ? String(linkedSeller._id)
            : sellerUser.sellerId
              ? String(sellerUser.sellerId)
              : undefined,
        name: String(sellerUser.fullName ?? sellerUser.email ?? ''),
        email: String(sellerUser.email ?? ''),
        role: 'seller',
        status: sellerUser.status ?? 'approved',
        profileCompleted: Boolean(sellerUser.profileCompleted),
        companyName: String(sellerUser.companyName ?? ''),
        mobile: String(sellerUser.mobile ?? ''),
      };
    }

    const user = await this.userModel
      .findById(userId)
      .select('-password')
      .lean()
      .exec();
    if (!user) {
      throw new UnauthorizedException({
        success: false,
        message: 'Your session has expired. Please login again.',
        errorCode: 'ACCOUNT_NOT_FOUND',
      });
    }
    if (disabledAdminStatuses.has(String(user.status ?? ''))) {
      throw new UnauthorizedException({
        success: false,
        message: 'Account is disabled',
        errorCode: 'ACCOUNT_DISABLED',
      });
    }
    return {
      id: String(user._id),
      name: String(user.fullName ?? user.email ?? ''),
      email: String(user.email ?? ''),
      role: String(user.role ?? ''),
      status: user.status ?? 'approved',
      profileCompleted: Boolean(user.profileCompleted),
      companyName: String(user.companyName ?? ''),
      mobile: String(user.mobile ?? ''),
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
      await this.sessionRevocationService.revokeForUser(user);
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
      await this.sessionRevocationService.revokeForSeller(seller);
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

    const existingByEmail = await this.userModel
      .findOne({ email })
      .select('_id email role password')
      .exec();

    if (existingByEmail) {
      const passwordMatches = await this.verifyPassword(
        existingByEmail.password,
        password,
      );
      const updates: Record<string, unknown> = {};
      if (!passwordMatches) {
        updates.password = hashedPassword;
      }
      if (existingByEmail.role !== 'super_admin') {
        updates.role = 'super_admin';
        updates.status = 'approved';
        updates.profileCompleted = true;
      }
      if (Object.keys(updates).length > 0) {
        await this.userModel.updateOne(
          { _id: existingByEmail._id },
          { $set: updates },
        );
        this.logger.log(
          `Synced ${nodeEnv} dev super admin credentials for ${email}`,
        );
      }
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

    this.logger.log(
      `Created ${nodeEnv} super admin (${getMongoStorageMode()}): ${email}`,
    );
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
    this.logger.warn('Stored password is not bcrypt format; rejecting login');
    return false;
  }

  private buildIdentifierQuery(identifier: string) {
    const trimmed = identifier.trim();
    const pattern = new RegExp(`^${this.escapeRegex(trimmed)}$`, 'i');
    return {
      $or: [{ email: pattern }, { username: pattern }],
    };
  }

  private evaluateSellerLogin(seller: {
    _id?: unknown;
    id?: string;
    accountStatus?: string;
    accountStatusReason?: string;
    onboardingStatus?: string;
    password?: string;
    isTrial?: boolean;
    trialStatus?: string;
    paymentStatus?: string;
  }) {
    return evaluateSellerLogin({
      ...seller,
      id: seller.id ?? (seller._id ? String(seller._id) : undefined),
    });
  }

  private throwLoginDenied(loginCheck: {
    message?: string;
    errorCode?: string;
    sellerId?: string;
    accountStatusReason?: string;
  }) {
    throw new UnauthorizedException({
      success: false,
      message: loginCheck.message,
      errorCode: loginCheck.errorCode,
      sellerId: loginCheck.sellerId,
      accountStatusReason: loginCheck.accountStatusReason,
    });
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async resetPasswordWithOtp(input: {
    mobile: string;
    newPassword: string;
    confirmPassword: string;
  }) {
    if (input.newPassword !== input.confirmPassword) {
      throw new BadRequestException(
        'Password and confirm password do not match.',
      );
    }

    const mobile = normalizeIndianMobile(input.mobile);
    await this.otpService.assertMobileVerified(
      mobile,
      OTP_PURPOSE.FORGOT_PASSWORD,
    );

    const hashed = await bcrypt.hash(input.newPassword, 10);
    const user = await this.userModel.findOne({ mobile }).exec();
    const seller = await this.sellerModel
      .findOne({ contactNumber: mobile })
      .exec();

    if (!user && !seller) {
      throw new BadRequestException('No account found for this mobile number.');
    }

    if (user) {
      user.password = hashed;
      await user.save();
    }
    if (seller) {
      seller.password = hashed;
      await seller.save();
    }

    await this.otpService.consumeVerification(
      mobile,
      OTP_PURPOSE.FORGOT_PASSWORD,
    );

    return {
      success: true,
      message:
        'Password updated successfully. You can sign in with your new password.',
    };
  }

  async findAccountByMobile(mobileInput: string) {
    const mobile = normalizeIndianMobile(mobileInput);
    const user = await this.userModel.findOne({ mobile }).lean().exec();
    const seller = await this.sellerModel
      .findOne({ contactNumber: mobile })
      .lean()
      .exec();
    return { user, seller };
  }

  private assertSetupToken(params: { setupToken?: string }) {
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
