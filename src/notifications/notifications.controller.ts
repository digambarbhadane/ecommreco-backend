import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('notifications')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(
    'super_admin',
    'sales_manager',
    'accounts_manager',
    'training_and_support_manager',
    'seller',
  )
  listForCurrentUser(
    @Req() req: { user?: { role?: string } },
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('search') search?: string,
  ) {
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.notificationsService.listNotifications({
      recipientRole: req.user?.role,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
      search,
    });
  }

  @Get('activity-logs')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  listActivityLogs(
    @Query('recipientRole') recipientRole?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('search') search?: string,
  ) {
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.notificationsService.listNotifications({
      recipientRole,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
      search,
    });
  }

  @Patch('notifications/:id/read')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(
    'super_admin',
    'sales_manager',
    'accounts_manager',
    'training_and_support_manager',
    'seller',
  )
  markAsRead(
    @Param('id') id: string,
    @Req() req: { user?: { role?: string } },
  ) {
    return this.notificationsService.markAsRead(id, req.user?.role);
  }

  @Patch('notifications/read-all')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(
    'super_admin',
    'sales_manager',
    'accounts_manager',
    'training_and_support_manager',
    'seller',
  )
  markAllAsRead(@Req() req: { user?: { role?: string } }) {
    return this.notificationsService.markAllAsRead(req.user?.role);
  }
}
