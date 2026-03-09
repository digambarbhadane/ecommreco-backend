import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
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
export class AuthService implements OnModuleInit {
  constructor(
    private readonly jwtService: JwtService,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async onModuleInit() {
    await this.seedAdminUsers();
    await this.seedSellerUser();
  }

  private async seedAdminUsers() {
    const superAdminEmail = 'superadmin@example.com';
    const salesManagerEmail = 'sales.manager@example.com';
    const accountsManagerEmail = 'accounts.manager@example.com';
    const trainingSupportManagerEmail = 'training.support@example.com';

    const superAdmin = await this.userModel
      .findOne({ email: superAdminEmail })
      .lean()
      .exec();
    if (!superAdmin) {
      await this.userModel.create({
        fullName: 'Super Admin',
        email: superAdminEmail,
        password: 'password123',
        role: 'super_admin',
        companyName: 'EcommReco',
        mobile: '+91 90000 00002',
        status: 'approved',
        profileCompleted: true,
      });
    }

    const salesManager = await this.userModel
      .findOne({ email: salesManagerEmail })
      .lean()
      .exec();
    if (!salesManager) {
      await this.userModel.create({
        fullName: 'Sales Manager',
        email: salesManagerEmail,
        password: 'password123',
        role: 'sales_manager',
        companyName: 'Seller Insights Hub',
        mobile: '+91 90000 00003',
        status: 'approved',
        profileCompleted: true,
      });
    }

    const accountsManager = await this.userModel
      .findOne({ email: accountsManagerEmail })
      .lean()
      .exec();
    if (!accountsManager) {
      await this.userModel.create({
        fullName: 'Accounts Manager',
        email: accountsManagerEmail,
        password: 'password123',
        role: 'accounts_manager',
        companyName: 'Seller Insights Hub',
        mobile: '+91 90000 00004',
        status: 'approved',
        profileCompleted: true,
      });
    }

    const trainingSupportManager = await this.userModel
      .findOne({ email: trainingSupportManagerEmail })
      .lean()
      .exec();
    if (!trainingSupportManager) {
      await this.userModel.create({
        fullName: 'Training & Support Manager',
        email: trainingSupportManagerEmail,
        password: 'password123',
        role: 'training_and_support_manager',
        companyName: 'Seller Insights Hub',
        mobile: '+91 90000 00005',
        status: 'approved',
        profileCompleted: true,
      });
    }
  }

  private async seedSellerUser() {
    const sellerEmail = 'seller@example.com';
    const existing = await this.sellerModel
      .findOne({ email: sellerEmail })
      .lean()
      .exec();
    if (!existing) {
      await this.sellerModel.create({
        fullName: 'Seller User',
        gstNumber: '27ABCDE1234F1Z5',
        contactNumber: '+91 90000 00000',
        email: sellerEmail,
        password: 'password123',
        onboardingStatus: 'credentials_sent',
      });
    }
  }

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
