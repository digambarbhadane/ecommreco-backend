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
  ) {}

  async list(params: { limit?: number; skip?: number; search?: string }) {
    const limit = Math.max(0, params.limit ?? 20);
    const skip = Math.max(0, params.skip ?? 0);
    const search =
      typeof params.search === 'string' ? params.search.trim() : '';

    const filter: Record<string, unknown> = {};
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } },
      ];
    }

    const data = await this.userModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-password')
      .lean()
      .exec();

    const total = await this.userModel.countDocuments(filter);
    return { success: true, data, total, limit, skip };
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
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const username = user.email;

    const password =
      typeof dto.password === 'string' && dto.password.length > 0
        ? dto.password
        : this.generatePassword();

    user.username = username;
    user.password = await bcrypt.hash(password, 10);
    user.mustChangePassword = true;
    user.credentialsGeneratedAt = new Date();
    user.credentialsGeneratedBy = actor?.email;
    await user.save();

    const safe = await this.userModel
      .findById(user._id)
      .select('-password')
      .lean()
      .exec();

    return { success: true, data: safe, credentials: { username, password } };
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
