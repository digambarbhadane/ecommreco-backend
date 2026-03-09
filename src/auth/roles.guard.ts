import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';

type RequestUser = {
  role?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request?.user;
    if (!user) {
      throw new UnauthorizedException({
        success: false,
        message: 'Unauthorized',
        errorCode: 'UNAUTHORIZED',
      });
    }
    if (!user.role || !roles.includes(user.role)) {
      throw new ForbiddenException({
        success: false,
        message: 'Forbidden',
        errorCode: 'FORBIDDEN',
      });
    }
    return true;
  }
}
