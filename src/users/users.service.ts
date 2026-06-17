import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { generatePublicId } from '../common/public-id';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetCredentialsDto } from './dto/reset-credentials.dto';

type RequestUser = {
  email?: string;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(Seller.name) private readonly sellerModel: Model<SellerDocument>,
  ) {}

  async list(params: {
    limit?: number;
    skip?: number;
    search?: string;
    role?: string;
  }) {
    const limit = Math.max(0, params.limit ?? 20);
    const skip = Math.max(0, params.skip ?? 0);
    const search =
      typeof params.search === 'string' ? params.search.trim() : '';
    const roleFilter =
      typeof params.role === 'string' && params.role.trim()
        ? params.role.trim()
        : undefined;

    const searchFilter = search
      ? {
          $or: [
            { fullName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { username: { $regex: search, $options: 'i' } },
            { role: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const userFilter: Record<string, unknown> = { ...searchFilter };
    if (roleFilter === 'admin') {
      userFilter.role = { $ne: 'seller' };
    } else if (roleFilter) {
      userFilter.role = roleFilter;
    }

    const users = await this.userModel
      .find(userFilter)
      .sort({ createdAt: -1 })
      .select('-password')
      .lean()
      .exec();

    const rows: Array<Record<string, unknown>> = users.map((user) => ({
      ...user,
      id: user._id.toString(),
    }));

    if (!roleFilter || roleFilter === 'seller') {
      const sellerFilter: Record<string, unknown> = {};
      if (search) {
        sellerFilter.$or = [
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { contactNumber: { $regex: search, $options: 'i' } },
        ];
      }

      const sellers = await this.sellerModel
        .find(sellerFilter)
        .sort({ createdAt: -1 })
        .select('fullName email contactNumber createdAt updatedAt')
        .lean<
          Array<{
            _id: Types.ObjectId;
            fullName: string;
            email: string;
            contactNumber?: string;
            createdAt?: Date;
            updatedAt?: Date;
          }>
        >()
        .exec();

      const userEmails = new Set(
        rows
          .map((row) =>
            typeof row.email === 'string' ? row.email.trim().toLowerCase() : '',
          )
          .filter(Boolean),
      );

      for (const seller of sellers) {
        const email =
          typeof seller.email === 'string'
            ? seller.email.trim().toLowerCase()
            : '';
        if (!email || userEmails.has(email)) continue;
        rows.push({
          _id: seller._id,
          id: seller._id.toString(),
          fullName: seller.fullName,
          email: seller.email,
          role: 'seller',
          mobile: seller.contactNumber,
          status: 'approved',
          profileCompleted: true,
          createdAt: seller.createdAt,
          updatedAt: seller.updatedAt,
          linkedFromSeller: true,
        });
      }
    }

    rows.sort(
      (a, b) =>
        this.toTimestamp(b.createdAt) - this.toTimestamp(a.createdAt) ||
        this.toTimestamp(b.updatedAt) - this.toTimestamp(a.updatedAt),
    );

    const total = rows.length;
    const data = rows.slice(skip, skip + limit);
    return { success: true, data, total, limit, skip };
  }

  private toTimestamp(value: unknown) {
    if (!value) return 0;
    const time = new Date(value as string | number | Date).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  async listSalesManagers() {
    const data = await this.userModel
      .find({ role: 'sales_manager', status: 'approved' })
      .sort({ fullName: 1, createdAt: 1 })
      .select('_id fullName email role status')
      .lean<Array<{ _id: Types.ObjectId; fullName: string; email: string }>>()
      .exec();

    return {
      success: true,
      data: data.map((u) => ({
        id: u._id.toString(),
        fullName: u.fullName,
        email: u.email,
      })),
      total: data.length,
    };
  }

  async get(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user ID');
    }
    const user = await this.userModel
      .findById(id)
      .select('-password')
      .lean()
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { success: true, data: user };
  }

  async create(dto: CreateUserDto, actor?: RequestUser) {
    const email = dto.email.toLowerCase();

    const existing = await this.userModel
      .findOne({ email })
      .select('_id')
      .lean()
      .exec();
    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    await this.assertRoleExists(dto.role);

    const username = email;

    const password =
      typeof dto.password === 'string' && dto.password.length > 0
        ? dto.password
        : this.generatePassword();

    const hashedPassword = await bcrypt.hash(password, 10);

    const created = await this.userModel.create({
      publicId: generatePublicId('user', email),
      username,
      fullName: dto.fullName,
      email,
      password: hashedPassword,
      role: dto.role,
      companyName: dto.companyName,
      mobile: dto.mobile,
      status: dto.status ?? 'approved',
      profileCompleted: true,
      mustChangePassword: dto.mustChangePassword ?? true,
      credentialsGeneratedAt: new Date(),
      credentialsGeneratedBy: actor?.email,
    });

    const safe = await this.userModel
      .findById(created._id)
      .select('-password')
      .lean()
      .exec();

    return {
      success: true,
      data: safe,
      credentials: { username, password },
    };
  }

  async update(id: string, dto: UpdateUserDto) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user ID');
    }

    const updates: Record<string, unknown> = {};
    let emailUpdated: string | undefined;
    if (typeof dto.email === 'string') {
      const email = dto.email.toLowerCase();
      const existing = await this.userModel
        .findOne({ _id: { $ne: new Types.ObjectId(id) }, email })
        .select('_id')
        .lean()
        .exec();
      if (existing) {
        throw new BadRequestException('User with this email already exists');
      }
      updates.email = email;
      emailUpdated = email;
    }
    if (typeof dto.fullName === 'string') updates.fullName = dto.fullName;
    if (emailUpdated) {
      updates.username = emailUpdated;
    } else if (typeof dto.username === 'string') {
      updates.username = dto.username;
    }
    if (typeof dto.companyName === 'string')
      updates.companyName = dto.companyName;
    if (typeof dto.mobile === 'string') updates.mobile = dto.mobile;
    if (typeof dto.status === 'string') updates.status = dto.status;
    if (typeof dto.profileCompleted === 'boolean')
      updates.profileCompleted = dto.profileCompleted;
    if (typeof dto.mustChangePassword === 'boolean')
      updates.mustChangePassword = dto.mustChangePassword;

    if (typeof dto.role === 'string') {
      await this.assertRoleExists(dto.role);
      updates.role = dto.role;
    }

    const updated = await this.userModel
      .findByIdAndUpdate(id, { $set: updates }, { new: true })
      .select('-password')
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return { success: true, data: updated };
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user ID');
    }
    const deleted = await this.userModel.findByIdAndDelete(id).lean().exec();
    if (!deleted) {
      throw new NotFoundException('User not found');
    }
    return { success: true };
  }

  async resetCredentials(
    id: string,
    dto: ResetCredentialsDto,
    actor?: RequestUser,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user ID');
    }

    const { user, seller } = await this.resolveUserAndSellerAccount(id);
    if (!user && !seller) {
      throw new NotFoundException('User not found');
    }

    const password =
      typeof dto.password === 'string' && dto.password.length > 0
        ? dto.password
        : this.generatePassword();
    const hashedPassword = await bcrypt.hash(password, 10);
    const actorEmail = actor?.email || 'super_admin';
    const credentialsGeneratedAt = new Date();

    let activeUser = user;
    if (!activeUser && seller) {
      const email = seller.email.trim().toLowerCase();
      activeUser = await this.userModel.create({
        publicId: generatePublicId('user', email),
        username: seller.username || email,
        fullName: seller.fullName,
        email,
        password: hashedPassword,
        role: 'seller',
        mobile: seller.contactNumber,
        companyName: seller.firmName || seller.tradeName || '',
        status: 'approved',
        profileCompleted: true,
        mustChangePassword: true,
        credentialsGeneratedAt,
        credentialsGeneratedBy: actorEmail,
      });
    } else if (activeUser) {
      activeUser.username = activeUser.email;
      activeUser.password = hashedPassword;
      activeUser.mustChangePassword = true;
      activeUser.credentialsGeneratedAt = credentialsGeneratedAt;
      activeUser.credentialsGeneratedBy = actorEmail;
      await activeUser.save();
    }

    const linkedSeller =
      seller ??
      (activeUser
        ? await this.sellerModel
            .findOne({ email: activeUser.email.trim().toLowerCase() })
            .exec()
        : null);

    if (linkedSeller) {
      linkedSeller.password = hashedPassword;
      if (!linkedSeller.username) {
        linkedSeller.username = activeUser?.username || linkedSeller.email;
      }
      linkedSeller.credentialsGeneratedAt = credentialsGeneratedAt;
      linkedSeller.credentialGeneratedBy = actorEmail;
      await linkedSeller.save();
    }

    const username =
      linkedSeller?.username ||
      activeUser?.username ||
      activeUser?.email ||
      linkedSeller?.email ||
      '';

    const safe = activeUser
      ? await this.userModel
          .findById(activeUser._id)
          .select('-password')
          .lean()
          .exec()
      : null;

    return {
      success: true,
      data: safe,
      credentials: { username, password },
    };
  }

  private async resolveUserAndSellerAccount(id: string) {
    let user = await this.userModel.findById(id).exec();
    let seller = await this.sellerModel.findById(id).exec();

    if (user && !seller) {
      seller = await this.sellerModel
        .findOne({ email: user.email.trim().toLowerCase() })
        .exec();
    }

    if (!user && seller) {
      user = await this.userModel
        .findOne({ email: seller.email.trim().toLowerCase(), role: 'seller' })
        .exec();
    }

    return { user, seller };
  }

  private async assertRoleExists(roleName: string) {
    const name = roleName.trim();
    if (name.length < 2) {
      throw new BadRequestException('Invalid role');
    }
    const exists = await this.roleModel
      .findOne({
        name: { $regex: `^${this.escapeRegex(name)}$`, $options: 'i' },
      })
      .select('_id')
      .lean()
      .exec();
    if (!exists) {
      throw new BadRequestException('Role does not exist');
    }
  }

  private generatePassword() {
    const base = Math.random().toString(36).slice(-10);
    const extra = Math.floor(Math.random() * 90 + 10).toString();
    return `${base}A1!${extra}`;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
