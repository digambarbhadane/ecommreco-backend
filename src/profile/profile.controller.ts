import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

type RequestUser = {
  id?: string;
  role?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};

@ApiTags('Profile')
@ApiBearerAuth()
@Controller('profile')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(
  'super_admin',
  'sales_manager',
  'accounts_manager',
  'training_and_support_manager',
  'seller',
)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user profile' })
  get(@Req() req: RequestWithUser) {
    return this.profileService.getProfile(req.user);
  }

  @Patch()
  @ApiOperation({ summary: 'Update current user profile' })
  update(@Body() dto: UpdateProfileDto, @Req() req: RequestWithUser) {
    return this.profileService.updateProfile(dto, req.user);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete current user profile', description: 'Soft-delete the current user account.' })
  remove(@Req() req: RequestWithUser) {
    return this.profileService.deleteProfile(req.user);
  }
}
