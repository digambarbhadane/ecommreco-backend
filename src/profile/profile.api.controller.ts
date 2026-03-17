import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileManagementDto } from './dto/update-profile-management.dto';
import { ProfileService } from './profile.service';

type RequestUser = {
  id?: string;
  role?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};

@Controller('profile')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(
  'super_admin',
  'sales_manager',
  'accounts_manager',
  'training_and_support_manager',
  'onboarding_manager',
  'sales_admin',
  'operations_admin',
  'seller',
)
export class ApiProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  getMe(@Req() req: RequestWithUser) {
    return this.profileService.getMe(req);
  }

  @Put('update')
  update(
    @Body() dto: UpdateProfileManagementDto,
    @Query('userId') userId: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    return this.profileService.updateProfileManagement(dto, { userId }, req);
  }

  @Put('password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: RequestWithUser) {
    return this.profileService.changePassword(dto, req);
  }

  @Put('preferences')
  updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @Query('userId') userId: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    return this.profileService.updatePreferences(dto, { userId }, req);
  }

  @Get('activity')
  getActivity(
    @Query('userId') userId: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    return this.profileService.getActivityLogs({ userId }, req);
  }

  @Get(':userId')
  @Roles('super_admin')
  getUser(@Param('userId') userId: string, @Req() req: RequestWithUser) {
    return this.profileService.getUserProfileById(userId, req);
  }

  @Put('logout-all')
  logoutAllDevices(@Req() req: RequestWithUser) {
    return this.profileService.logoutAllDevices(req);
  }

  @Put('two-factor')
  setTwoFactor(
    @Body() body: { enabled?: boolean },
    @Query('userId') userId: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    return this.profileService.setTwoFactorEnabled(body, { userId }, req);
  }
}
