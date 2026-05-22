import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
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

@ApiTags('Account-Manager')
@ApiBearerAuth()
@Controller('account-manager')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('accounts_manager', 'super_admin')
export class AccountManagerController {
  constructor(private readonly accountManagerService: AccountManagerService) {}

  private getUser(req: RequestWithUser) {
    return req.user;
  }

  @Get('payment-completed-sellers')
  @ApiOperation({ summary: 'List payment-completed sellers' })
  async getPaymentCompletedSellers(@Req() req: RequestWithUser) {
    return this.accountManagerService.findAllPaymentCompletedSellers(
      this.getUser(req),
    );
  }

  @Get('conversion-leads')
  @ApiOperation({ summary: 'List conversion leads' })
  async getConversionLeads(@Req() req: RequestWithUser) {
    return this.accountManagerService.findAllConversionLeads(this.getUser(req));
  }

  @Get('conversion-leads/:id')
  @ApiOperation({ summary: 'Get conversion lead by ID' })
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
  @ApiOperation({ summary: 'Create seller from lead', description: 'Convert a lead into a seller account.' })
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
  @ApiOperation({ summary: 'Get seller by ID' })
  async getSeller(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.accountManagerService.findOne(id, this.getUser(req));
  }

  @Post('verify-payment')
  @ApiOperation({ summary: 'Verify payment', description: 'Verify payment via Cashfree.' })
  async verifyPayment(
    @Body() dto: VerifyPaymentDto,
    @Req() req: RequestWithUser,
  ) {
    return this.accountManagerService.verifyPayment(dto, this.getUser(req));
  }

  @Post('create-account')
  @ApiOperation({ summary: 'Create seller account', description: 'Create a seller account from account manager.' })
  async createAccount(
    @Body() dto: CreateAccountDto,
    @Req() req: RequestWithUser,
  ) {
    return this.accountManagerService.createAccount(dto, this.getUser(req));
  }

  @Post('generate-credentials')
  @ApiOperation({ summary: 'Generate seller credentials' })
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
  @ApiOperation({ summary: 'Request admin approval', description: 'Request super admin approval for an action.' })
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
