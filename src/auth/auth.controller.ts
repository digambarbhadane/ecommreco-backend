import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';
import { DevResetPasswordDto } from './dto/dev-reset-password.dto';
import { LoginDto } from './dto/login.dto';
import type { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('health')
  health() {
    return this.authService.health();
  }

  @Get('database-connection')
  databaseConnection() {
    return this.authService.databaseConnection();
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req);
  }

  @Post('bootstrap-super-admin')
  bootstrapSuperAdmin(
    @Headers('x-setup-token') setupToken: string | undefined,
    @Body() dto: BootstrapSuperAdminDto,
  ) {
    return this.authService.bootstrapSuperAdmin({ setupToken }, dto);
  }

  @Get('debug-db')
  debugDb(@Headers('x-setup-token') setupToken: string | undefined) {
    return this.authService.debugDb({ setupToken });
  }

  @Get('debug-super-admin')
  debugSuperAdmin(@Headers('x-setup-token') setupToken: string | undefined) {
    return this.authService.debugSuperAdmin({ setupToken });
  }

  @Get('debug-identity')
  debugIdentity(
    @Headers('x-setup-token') setupToken: string | undefined,
    @Query('identifier') identifier: string | undefined,
  ) {
    return this.authService.debugIdentity({ setupToken }, { identifier });
  }

  @Post('dev-reset-password')
  devResetPassword(
    @Headers('x-setup-token') setupToken: string | undefined,
    @Body() dto: DevResetPasswordDto,
  ) {
    return this.authService.devResetPassword({ setupToken }, dto);
  }
}
