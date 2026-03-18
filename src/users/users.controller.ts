import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetCredentialsDto } from './dto/reset-credentials.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('sales-managers')
  listSalesManagers() {
    return this.usersService.listSalesManagers();
  }

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('search') search?: string,
  ) {
    const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
    const parsedSkip = typeof skip === 'string' ? Number(skip) : undefined;
    return this.usersService.list({
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      skip: Number.isFinite(parsedSkip) ? parsedSkip : undefined,
      search,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.usersService.get(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    return this.usersService.create(dto, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Post(':id/reset-credentials')
  resetCredentials(
    @Param('id') id: string,
    @Body() dto: ResetCredentialsDto,
    @Req() req: RequestWithUser,
  ) {
    return this.usersService.resetCredentials(id, dto, req.user);
  }
}

type RequestUser = {
  email?: string;
  role?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};
