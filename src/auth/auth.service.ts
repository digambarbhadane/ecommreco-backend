import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoginDto } from './dto/login.dto';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role:
    | 'super_admin'
    | 'sales_manager'
    | 'accounts_manager'
    | 'training_and_support_manager'
    | 'seller';
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
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
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
    const adminUser = await this.userModel.findOne({ email }).lean().exec();
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
    if (
      !user ||
      user.password !== dto.password ||
      (user.role === 'seller' &&
        !allowedSellerStatuses.has(seller?.onboardingStatus ?? ''))
    ) {
      throw new UnauthorizedException({
        success: false,
        message: 'Invalid credentials',
        errorCode: 'INVALID_CREDENTIALS',
      });
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
      email: user.email,
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
}
