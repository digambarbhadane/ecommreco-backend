import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AccountManagerService } from './account-manager.service';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { GenerateCredentialsDto } from './dto/generate-credentials.dto';
import { RequestAdminApprovalDto } from './dto/request-approval.dto';
import { CreateSellerFromLeadDto } from './dto/create-seller-from-lead.dto';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('account-manager')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('accounts_manager', 'super_admin')
export class AccountManagerController {
  constructor(private readonly accountManagerService: AccountManagerService) {}

  private getUser(req: RequestWithUser) {
    return req.user;
  }

  @Get('payment-completed-sellers')
  async getPaymentCompletedSellers(@Req() req: RequestWithUser) {
    return this.accountManagerService.findAllPaymentCompletedSellers(
      this.getUser(req),
    );
  }

  @Get('conversion-leads')
  async getConversionLeads(@Req() req: RequestWithUser) {
    return this.accountManagerService.findAllConversionLeads(this.getUser(req));
  }

  @Get('conversion-leads/:id')
  async getConversionLead(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.accountManagerService.findOneConversionLead(
      id,
      this.getUser(req),
    );
  }

  @Post('conversion-leads/create-seller')
  async createSellerFromLead(
    @Body() dto: CreateSellerFromLeadDto,
    @Req() req: RequestWithUser,
  ) {
    return this.accountManagerService.createSellerFromLead(
      dto,
      this.getUser(req),
    );
  }

  @Get('seller/:id')
  async getSeller(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.accountManagerService.findOne(id, this.getUser(req));
  }

  @Post('verify-payment')
  async verifyPayment(
    @Body() dto: VerifyPaymentDto,
    @Req() req: RequestWithUser,
  ) {
    return this.accountManagerService.verifyPayment(dto, this.getUser(req));
  }

  @Post('create-account')
  async createAccount(
    @Body() dto: CreateAccountDto,
    @Req() req: RequestWithUser,
  ) {
    return this.accountManagerService.createAccount(dto, this.getUser(req));
  }

  @Post('generate-credentials')
  async generateCredentials(
    @Body() dto: GenerateCredentialsDto,
    @Req() req: RequestWithUser,
  ) {
    return this.accountManagerService.generateCredentials(
      dto,
      this.getUser(req),
    );
  }

  @Post('request-admin-approval')
  async requestAdminApproval(
    @Body() dto: RequestAdminApprovalDto,
    @Req() req: RequestWithUser,
  ) {
    return this.accountManagerService.requestAdminApproval(
      dto,
      this.getUser(req),
    );
  }
}

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  fullName?: string;
  username?: string;
  name?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};
