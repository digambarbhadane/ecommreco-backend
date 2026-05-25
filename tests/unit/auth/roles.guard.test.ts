import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../../src/auth/roles.guard';
import { ROLES_KEY } from '../../../src/auth/roles.decorator';

const createContext = (user?: { role?: string }): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as ExecutionContext;

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no roles metadata is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(createContext({ role: 'seller' }))).toBe(true);
  });

  it('throws UnauthorizedException when user is missing', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['seller']);
    expect(() => guard.canActivate(createContext())).toThrow(UnauthorizedException);
  });

  it('allows super_admin for any role list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['sales_manager']);
    expect(guard.canActivate(createContext({ role: 'super_admin' }))).toBe(true);
  });

  it('allows sales_manager when sales_admin is required (hierarchy)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['sales_manager']);
    expect(guard.canActivate(createContext({ role: 'sales_admin' }))).toBe(true);
  });

  it('throws ForbiddenException for wrong role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['super_admin']);
    expect(() =>
      guard.canActivate(createContext({ role: 'seller' })),
    ).toThrow(ForbiddenException);
  });

  it('reads roles from ROLES_KEY metadata', () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride');
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['seller']);
    guard.canActivate(createContext({ role: 'seller' }));
    expect(spy).toHaveBeenCalledWith(ROLES_KEY, expect.any(Array));
  });
});
