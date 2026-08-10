import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  UserSecurity,
  UserSecurityDocument,
} from '../profile/schemas/user-security.schema';

/**
 * Revokes JWT sessions by bumping tokenVersion and clearing stored refresh tokens.
 * Call after password reset / credential reset so old tokens cannot be refreshed.
 */
@Injectable()
export class SessionRevocationService {
  constructor(
    @InjectModel(UserSecurity.name)
    private readonly userSecurityModel: Model<UserSecurityDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
  ) {}

  async revokeAllSessionsForUserIds(userIds: string[]): Promise<void> {
    const uniqueIds = [
      ...new Set(userIds.map((id) => String(id).trim()).filter(Boolean)),
    ];
    if (uniqueIds.length === 0) return;

    await Promise.all(
      uniqueIds.map((userId) =>
        this.userSecurityModel
          .updateOne(
            { userId },
            {
              $inc: { tokenVersion: 1 },
              $set: { activeSessions: [], refreshTokens: [] },
            },
            { upsert: true },
          )
          .exec(),
      ),
    );
  }

  async revokeForSeller(seller: { _id?: unknown; email?: string }): Promise<void> {
    const userIds = new Set<string>();
    if (seller._id) {
      userIds.add(String(seller._id));
    }

    const email = String(seller.email ?? '').trim().toLowerCase();
    if (email) {
      const linkedUser = await this.userModel
        .findOne({ email, role: 'seller' })
        .select('_id')
        .lean()
        .exec();
      if (linkedUser?._id) {
        userIds.add(String(linkedUser._id));
      }
    }

    await this.revokeAllSessionsForUserIds(Array.from(userIds));
  }

  async revokeForUser(user: {
    _id?: unknown;
    id?: string;
    email?: string;
  }): Promise<void> {
    const userIds = new Set<string>();
    const userId = user.id ?? (user._id ? String(user._id) : '');
    if (userId) {
      userIds.add(userId);
    }

    const email = String(user.email ?? '').trim().toLowerCase();
    if (email) {
      const seller = await this.sellerModel
        .findOne({ email })
        .select('_id')
        .lean()
        .exec();
      if (seller?._id) {
        userIds.add(String(seller._id));
      }
    }

    await this.revokeAllSessionsForUserIds(Array.from(userIds));
  }

  async revokeByIdentifier(identifier: string): Promise<void> {
    const normalized = identifier.trim().toLowerCase();
    if (!normalized) return;

    const [user, seller] = await Promise.all([
      this.userModel.findOne({ email: normalized }).select('_id email').lean().exec(),
      this.sellerModel.findOne({ email: normalized }).select('_id email').lean().exec(),
    ]);

    if (user) {
      await this.revokeForUser(user);
      return;
    }
    if (seller) {
      await this.revokeForSeller(seller);
    }
  }
}
