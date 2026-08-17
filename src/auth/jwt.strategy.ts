import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import {
  UserSecurity,
  UserSecurityDocument,
} from '../profile/schemas/user-security.schema';
import { evaluateSellerLogin, type SellerLoginSnapshot } from '../trial/trial-login.policy';

type JwtPayload = {
  sub: string;
  role?: string;
  tokenVersion?: number;
  sessionId?: string;
  typ?: 'access' | 'refresh';
};

const disabledStatuses = new Set(['blocked', 'rejected']);

function toId(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  if (!text || text === '[object Object]') return undefined;
  return text;
}

function assertSellerSessionAccess(seller: SellerLoginSnapshot) {
  const access = evaluateSellerLogin(seller, { requirePassword: false });
  if (!access.allowed) {
    throw new UnauthorizedException({
      success: false,
      message: access.message,
      errorCode: access.errorCode,
      sellerId: access.sellerId,
      accountStatusReason: access.accountStatusReason,
    });
  }
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
    @InjectModel(UserSecurity.name)
    private userSecurityModel: Model<UserSecurityDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: (() => {
        const s = configService.get<string>('JWT_SECRET');
        if (!s) throw new Error('JWT_SECRET environment variable is required');
        return s;
      })(),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.typ === 'refresh') {
      throw new UnauthorizedException('Refresh token cannot be used as access token');
    }

    const { sub: id, role } = payload;
    const { tokenVersion, sessionId } = payload;

    try {
      const security = await this.userSecurityModel
        .findOne({ userId: id })
        .select('tokenVersion')
        .lean()
        .exec();
      const currentVersion =
        typeof security?.tokenVersion === 'number' ? security.tokenVersion : 0;
      if (
        typeof tokenVersion === 'number' &&
        tokenVersion !== currentVersion
      ) {
        throw new UnauthorizedException();
      }

      if (role === 'seller') {
        const seller = await this.sellerModel
          .findById(id)
          .select('-password')
          .lean()
          .exec();
        if (seller) {
          assertSellerSessionAccess(seller);
          const sellerId = seller._id.toString();
          return {
            ...seller,
            id: sellerId,
            sub: sellerId,
            sellerId,
            role: 'seller',
            sessionId,
          };
        }

        const sellerUser = await this.userModel
          .findOne({ _id: id, role: 'seller' })
          .select('-password')
          .lean()
          .exec();
        if (sellerUser) {
          if (disabledStatuses.has(String(sellerUser.status ?? ''))) {
            throw new UnauthorizedException();
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
            assertSellerSessionAccess(linkedSeller);
          }
          const userId = sellerUser._id.toString();
          return {
            ...sellerUser,
            id: userId,
            sub: userId,
            sellerId:
              toId(linkedSeller?._id) ?? toId(sellerUser.sellerId) ?? userId,
            role: 'seller',
            sessionId,
          };
        }

        throw new UnauthorizedException();
      }

      if (!role) {
        const user = await this.userModel
          .findById(id)
          .select('-password')
          .lean()
          .exec();
        if (user) {
          if (disabledStatuses.has(String(user.status ?? ''))) {
            throw new UnauthorizedException();
          }
          return {
            ...user,
            id: user._id.toString(),
            sub: user._id.toString(),
            sellerId: toId(user.sellerId),
            role: user.role,
            sessionId,
          };
        }

        const seller = await this.sellerModel
          .findById(id)
          .select('-password')
          .lean()
          .exec();
        if (seller) {
          assertSellerSessionAccess(seller);
          const sellerId = seller._id.toString();
          return {
            ...seller,
            id: sellerId,
            sub: sellerId,
            sellerId,
            role: 'seller',
            sessionId,
          };
        }

        throw new UnauthorizedException();
      }

      const user = await this.userModel
        .findById(id)
        .select('-password')
        .lean()
        .exec();
      if (!user) {
        throw new UnauthorizedException();
      }
      if (disabledStatuses.has(String(user.status ?? ''))) {
        throw new UnauthorizedException();
      }
      return {
        ...user,
        id: user._id.toString(),
        sub: user._id.toString(),
        sellerId: toId(user.sellerId),
        sessionId,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable. Please retry in a moment.',
      );
    }
  }
}
