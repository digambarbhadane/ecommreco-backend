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

type JwtPayload = {
  sub: string;
  role?: string;
  tokenVersion?: number;
  sessionId?: string;
};

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
    const { sub: id, role } = payload;
    const { tokenVersion, sessionId } = payload;

    try {
      if (role === 'seller') {
        const seller = await this.sellerModel.findById(id).select('-password').lean().exec();
        if (seller) {
          return { ...seller, id: seller._id.toString(), role: 'seller', sessionId };
        }

        const sellerUser = await this.userModel
          .findOne({ _id: id, role: 'seller' })
          .select('-password')
          .lean()
          .exec();
        if (sellerUser) {
          return {
            ...sellerUser,
            id: sellerUser._id.toString(),
            role: 'seller',
            sessionId,
          };
        }

        throw new UnauthorizedException();
      }

      if (!role) {
        const user = await this.userModel.findById(id).select('-password').lean().exec();
        if (user) {
          return { ...user, id: user._id.toString(), role: user.role, sessionId };
        }

        const seller = await this.sellerModel.findById(id).select('-password').lean().exec();
        if (seller) {
          return { ...seller, id: seller._id.toString(), role: 'seller', sessionId };
        }

        throw new UnauthorizedException();
      }

      const user = await this.userModel.findById(id).select('-password').lean().exec();
      if (!user) {
        throw new UnauthorizedException();
      }
      return { ...user, id: user._id.toString(), sessionId };
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
