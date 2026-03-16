import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, RoleDocument } from './schemas/role.schema';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultRoles();
  }

  async list() {
    const roles = await this.roleModel.find().sort({ name: 1 }).lean().exec();
    return { success: true, data: roles };
  }

  async get(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid role ID');
    }
    const role = await this.roleModel.findById(id).lean().exec();
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return { success: true, data: role };
  }

  async create(dto: CreateRoleDto) {
    const name = dto.name.trim();
    const existing = await this.roleModel
      .findOne({
        name: { $regex: `^${this.escapeRegex(name)}$`, $options: 'i' },
      })
      .select('_id')
      .lean()
      .exec();
    if (existing) {
      throw new BadRequestException('Role name already exists');
    }
    const created = await this.roleModel.create({
      name,
      description: dto.description,
      permissions: Array.isArray(dto.permissions) ? dto.permissions : [],
      isSystem: dto.isSystem ?? false,
    });
    return { success: true, data: created.toObject() };
  }

  async update(id: string, dto: UpdateRoleDto) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid role ID');
    }

    const updates: Record<string, unknown> = {};
    if (typeof dto.name === 'string') {
      const name = dto.name.trim();
      if (name.length < 2) {
        throw new BadRequestException('Role name is too short');
      }
      const existing = await this.roleModel
        .findOne({
          _id: { $ne: new Types.ObjectId(id) },
          name: { $regex: `^${this.escapeRegex(name)}$`, $options: 'i' },
        })
        .select('_id')
        .lean()
        .exec();
      if (existing) {
        throw new BadRequestException('Role name already exists');
      }
      updates.name = name;
    }
    if (typeof dto.description === 'string') {
      updates.description = dto.description;
    }
    if (Array.isArray(dto.permissions)) {
      updates.permissions = dto.permissions;
    }
    if (typeof dto.isSystem === 'boolean') {
      updates.isSystem = dto.isSystem;
    }

    const updated = await this.roleModel
      .findByIdAndUpdate(id, { $set: updates }, { new: true })
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException('Role not found');
    }
    return { success: true, data: updated };
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid role ID');
    }
    const deleted = await this.roleModel.findByIdAndDelete(id).lean().exec();
    if (!deleted) {
      throw new NotFoundException('Role not found');
    }
    return { success: true };
  }

  private async ensureDefaultRoles() {
    const defaultRoles = [
      { name: 'super_admin', isSystem: true },
      { name: 'sales_manager', isSystem: true },
      { name: 'accounts_manager', isSystem: true },
      { name: 'training_and_support_manager', isSystem: true },
      { name: 'seller', isSystem: true },
    ];

    await this.roleModel.bulkWrite(
      defaultRoles.map((role) => ({
        updateOne: {
          filter: { name: role.name },
          update: {
            $setOnInsert: {
              name: role.name,
              permissions: [],
              isSystem: role.isSystem,
            },
          },
          upsert: true,
        },
      })),
    );
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
