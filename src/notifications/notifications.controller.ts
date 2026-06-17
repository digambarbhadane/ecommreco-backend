import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
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

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('notifications')
  @ApiOperation({ summary: 'List notifications for current user' })
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
  @ApiOperation({ summary: 'List activity logs', description: 'Returns system activity logs. Super admin only.' })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  listActivityLogs(
    @Query('role') role?: string,
    @Query('recipientRole') recipientRole?: string,
    @Query('userId') userId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedPage = typeof page === 'string' ? Number(page) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;

    const resolvedRole =
      typeof role === 'string' && role.length > 0 ? role : recipientRole;

    if (Number.isFinite(parsedSkip) && parsedSkip !== undefined) {
      return this.notificationsService.listNotifications({
        recipientRole: resolvedRole,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
        skip: parsedSkip,
        search,
      });
    }

    return this.notificationsService.listActivityLogs({
      role: resolvedRole,
      userId,
      sellerId,
      action,
      startDate,
      endDate,
      search,
      page: Number.isFinite(parsedPage) ? parsedPage : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Patch('notifications/:id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
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
  @ApiOperation({ summary: 'Mark all notifications as read' })
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
