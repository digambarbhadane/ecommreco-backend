import { Controller, Get, Patch, Param, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { RolesGuard } from '../auth/roles.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findAll(@Req() req: RequestWithUser) {
    const role = typeof req.user?.role === 'string' ? req.user.role : 'seller';
    return {
      success: true,
      data: await this.notificationsService.findAll(role),
    };
  }

  @Patch('read-all')
  async markAllAsRead(@Req() req: RequestWithUser) {
    const role = typeof req.user?.role === 'string' ? req.user.role : 'seller';
    await this.notificationsService.markAllAsRead(role);
    return { success: true };
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string) {
    await this.notificationsService.markAsRead(id);
    return { success: true };
  }
}

type RequestUser = {
  role?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};
