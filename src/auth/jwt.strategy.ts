import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
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
      secretOrKey: configService.get<string>('JWT_SECRET') || 'dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    const { sub: id, role, tokenVersion, sessionId } = payload;

    const security = await this.userSecurityModel
      .findOne({ userId: id })
      .select('tokenVersion')
      .lean()
      .exec();
    const currentTokenVersion =
      typeof security?.tokenVersion === 'number' ? security.tokenVersion : 0;
    const receivedTokenVersion =
      typeof tokenVersion === 'number' ? tokenVersion : 0;
    if (currentTokenVersion !== receivedTokenVersion) {
      throw new UnauthorizedException();
    }

    if (typeof sessionId === 'string' && sessionId.length > 0) {
      void this.userSecurityModel
        .updateOne(
          { userId: id },
          { $set: { 'activeSessions.$[s].lastSeenAt': new Date() } },
          { arrayFilters: [{ 's.sessionId': sessionId }] },
        )
        .exec();
    }

    if (role === 'seller') {
      const seller = await this.sellerModel.findById(id).lean().exec();
      if (!seller) {
        throw new UnauthorizedException();
      }
      return { ...seller, id: seller._id.toString(), role: 'seller' };
    } else {
      const user = await this.userModel.findById(id).lean().exec();
      if (!user) {
        throw new UnauthorizedException();
      }
      return { ...user, id: user._id.toString() };
    }
  }
}
