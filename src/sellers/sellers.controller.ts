import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { GenerateCredentialsDto } from './dto/generate-credentials.dto';
import { RegisterSellerDto } from './dto/register-seller.dto';
import { SendPaymentLinkDto } from './dto/send-payment-link.dto';
import { SellersService } from './sellers.service';

@Controller('sellers')
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterSellerDto) {
    return this.sellersService.register(dto);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(
    'super_admin',
    'sales_manager',
    'accounts_manager',
    'training_and_support_manager',
  )
  list(
    @Req() req: { user?: { role?: string } },
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('search') search?: string,
  ) {
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.sellersService.listSellers({
      status,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
      search,
      role: req.user?.role ?? 'seller',
    });
  }

  @Get('super-admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  listSuperAdmin(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('search') search?: string,
  ) {
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.sellersService.listSellers({
      status,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
      search,
      role: 'super_admin',
    });
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(
    'super_admin',
    'sales_manager',
    'accounts_manager',
    'training_and_support_manager',
  )
  getSeller(@Req() req: { user?: { role?: string } }, @Param('id') id: string) {
    return this.sellersService.getSeller(id, req.user?.role ?? 'seller');
  }

  @Get('super-admin/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  getSellerSuperAdmin(@Param('id') id: string) {
    return this.sellersService.getSeller(id, 'super_admin');
  }

  @Post(':id/payment-link')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'sales_manager')
  sendPaymentLink(@Param('id') id: string, @Body() dto: SendPaymentLinkDto) {
    return this.sellersService.sendPaymentLink(id, dto);
  }

  @Post(':id/payment-completed')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'accounts_manager')
  markPaymentCompleted(@Param('id') id: string) {
    return this.sellersService.markPaymentCompleted(id);
  }

  @Post(':id/generate-credentials')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'accounts_manager')
  generateCredentials(
    @Param('id') id: string,
    @Body() dto: GenerateCredentialsDto,
  ) {
    return this.sellersService.generateCredentials(id, dto);
  }

  @Post(':id/approve-credentials')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  approveCredentials(@Param('id') id: string) {
    return this.sellersService.approveCredentials(id);
  }

  @Post(':id/complete-training')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('training_and_support_manager', 'super_admin')
  completeTraining(@Param('id') id: string) {
    return this.sellersService.completeTraining(id);
  }

  @Post(':id/account-status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  updateAccountStatus(
    @Param('id') id: string,
    @Body() body: { status?: string },
  ) {
    return this.sellersService.updateAccountStatus(id, body.status ?? '');
  }
}
