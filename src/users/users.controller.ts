import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
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

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('sales-managers')
  @ApiOperation({ summary: 'List all sales managers' })
  listSalesManagers() {
    return this.usersService.listSalesManagers();
  }

  @Get()
  @ApiOperation({ summary: 'List all users', description: 'Returns paginated list of users. Supports limit, skip, and search filters.' })
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
  @ApiOperation({ summary: 'Get user by ID' })
  get(@Param('id') id: string) {
    return this.usersService.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  create(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    return this.usersService.create(dto, req.user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user by ID' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user by ID' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Post(':id/reset-credentials')
  @ApiOperation({ summary: 'Reset user credentials', description: 'Reset username and/or password for a user.' })
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
