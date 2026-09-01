import {
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { OtpService } from '../otp.service';
import { OTP_PURPOSE, type OtpPurpose } from '../otp.constants';
import { normalizeIndianMobile } from '../otp.helper';

export const OTP_VERIFIED_KEY = 'otp_verified';

export type OtpVerifiedMetadata = {
  purpose: OtpPurpose;
  mobileField?: string;
};

export const OtpVerified = (purpose: OtpPurpose, mobileField = 'mobile') =>
  SetMetadata(OTP_VERIFIED_KEY, { purpose, mobileField });

@Injectable()
export class OtpVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly otpService: OtpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.get<OtpVerifiedMetadata>(
      OTP_VERIFIED_KEY,
      context.getHandler(),
    );
    if (!metadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const body = (request.body ?? {}) as Record<string, unknown>;
    const mobileRaw = body[metadata.mobileField ?? 'mobile'];
    if (typeof mobileRaw !== 'string' || !mobileRaw.trim()) {
      throw new BadRequestException('Mobile number is required.');
    }

    const mobile = normalizeIndianMobile(mobileRaw);
    await this.otpService.assertMobileVerified(mobile, metadata.purpose);
    return true;
  }
}

export const verifyOtpRequired = (
  purpose: OtpPurpose = OTP_PURPOSE.REGISTER,
  mobileField = 'mobile',
) => OtpVerified(purpose, mobileField);
