import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { Model } from 'mongoose';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { SmsService } from '../sms/sms.service';
import { generatePublicId } from '../common/public-id';
import {
  TrialContactOtp,
  TrialContactOtpDocument,
} from './schemas/trial-contact-otp.schema';

const OTP_PURPOSE = 'trial_registration';
const OTP_TTL_MINUTES = 10;
const MAX_SEND_PER_WINDOW = 5;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const VERIFICATION_TTL_HOURS = 24;

@Injectable()
export class TrialOtpService {
  private readonly logger = new Logger(TrialOtpService.name);

  constructor(
    @InjectModel(TrialContactOtp.name)
    private readonly otpModel: Model<TrialContactOtpDocument>,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
  ) {}

  async sendOtp(input: {
    channel: 'email' | 'mobile';
    email?: string;
    mobile?: string;
    ownerName?: string;
  }) {
    const channel = input.channel;
    const target = this.normalizeTarget(channel, input.email, input.mobile);
    const now = new Date();

    let record = await this.otpModel
      .findOne({ channel, target, purpose: OTP_PURPOSE })
      .exec();

    if (record?.verifiedAt) {
      record.verifiedAt = undefined;
      record.verificationId = undefined;
    }

    if (record?.lastSentAt) {
      const elapsed = now.getTime() - record.lastSentAt.getTime();
      if (elapsed < 60_000) {
        throw new HttpException(
          'Please wait a minute before requesting another OTP.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (
        record.sendCount >= MAX_SEND_PER_WINDOW &&
        elapsed < SEND_WINDOW_MS
      ) {
        throw new HttpException(
          'Too many OTP requests. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const otp = String(randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, 8);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);

    if (!record) {
      record = await this.otpModel.create({
        channel,
        target,
        purpose: OTP_PURPOSE,
        otpHash,
        expiresAt,
        sendCount: 1,
        verifyAttempts: 0,
        lastSentAt: now,
      });
    } else {
      record.otpHash = otpHash;
      record.expiresAt = expiresAt;
      record.sendCount = (record.sendCount ?? 0) + 1;
      record.verifyAttempts = 0;
      record.lastSentAt = now;
      record.verifiedAt = undefined;
      record.verificationId = undefined;
      await record.save();
    }

    if (channel === 'email') {
      await this.emailService.sendEmail({
        to: target,
        type: EmailType.OTP,
        subject: 'Verify your email — EcommReco Trial',
        payload: {
          otp,
          expiresInMinutes: OTP_TTL_MINUTES,
          name: input.ownerName?.trim() || 'there',
        },
      });
    } else {
      await this.smsService.sendOtp(target, otp);
    }

    this.logger.log(`Trial OTP sent channel=${channel} target=${target}`);

    return {
      success: true,
      channel,
      target,
      expiresInMinutes: OTP_TTL_MINUTES,
      message:
        channel === 'email'
          ? 'OTP sent to your email address.'
          : 'OTP sent to your mobile number.',
    };
  }

  async verifyOtp(input: {
    channel: 'email' | 'mobile';
    email?: string;
    mobile?: string;
    otp: string;
  }) {
    const channel = input.channel;
    const target = this.normalizeTarget(channel, input.email, input.mobile);
    const otp = String(input.otp ?? '').trim();

    if (!/^\d{6}$/.test(otp)) {
      throw new BadRequestException('Enter a valid 6-digit OTP.');
    }

    const record = await this.otpModel
      .findOne({ channel, target, purpose: OTP_PURPOSE })
      .exec();

    if (!record) {
      throw new BadRequestException('Request an OTP first.');
    }

    if (record.verifiedAt && record.verificationId) {
      return {
        success: true,
        channel,
        verificationId: record.verificationId,
        alreadyVerified: true,
        message: 'Already verified.',
      };
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('OTP expired. Request a new one.');
    }

    if ((record.verifyAttempts ?? 0) >= MAX_VERIFY_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts. Request a new OTP.',
      );
    }

    const ok = await bcrypt.compare(otp, record.otpHash);
    if (!ok) {
      record.verifyAttempts = (record.verifyAttempts ?? 0) + 1;
      await record.save();
      throw new BadRequestException('Incorrect OTP. Please try again.');
    }

    const verificationId = generatePublicId('user', target);
    record.verifiedAt = new Date();
    record.verificationId = verificationId;
    await record.save();

    return {
      success: true,
      channel,
      verificationId,
      message:
        channel === 'email'
          ? 'Email verified successfully.'
          : 'Mobile number verified successfully.',
    };
  }

  async getVerificationStatus(email: string, mobile: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedMobile = mobile.trim();

    const [emailRecord, mobileRecord] = await Promise.all([
      this.otpModel
        .findOne({
          channel: 'email',
          target: normalizedEmail,
          purpose: OTP_PURPOSE,
        })
        .lean()
        .exec(),
      this.otpModel
        .findOne({
          channel: 'mobile',
          target: normalizedMobile,
          purpose: OTP_PURPOSE,
        })
        .lean()
        .exec(),
    ]);

    return {
      emailVerified: Boolean(emailRecord?.verifiedAt && emailRecord.verificationId),
      mobileVerified: Boolean(mobileRecord?.verifiedAt && mobileRecord.verificationId),
      emailVerificationId: emailRecord?.verificationId ?? null,
      mobileVerificationId: mobileRecord?.verificationId ?? null,
    };
  }

  async assertEmailVerified(input: {
    email: string;
    emailVerificationId: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const maxAge = VERIFICATION_TTL_HOURS * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAge;

    const emailRecord = await this.otpModel
      .findOne({
        channel: 'email',
        target: email,
        purpose: OTP_PURPOSE,
        verificationId: input.emailVerificationId.trim(),
      })
      .exec();

    if (
      !emailRecord?.verifiedAt ||
      emailRecord.verifiedAt.getTime() < cutoff
    ) {
      throw new BadRequestException(
        'Email verification is required. Verify your email with OTP.',
      );
    }

    return { emailVerified: true };
  }

  async assertContactVerified(input: {
    email: string;
    mobile: string;
    emailVerificationId: string;
    mobileVerificationId: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const mobile = input.mobile.trim();
    const maxAge = VERIFICATION_TTL_HOURS * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAge;

    const emailRecord = await this.otpModel
      .findOne({
        channel: 'email',
        target: email,
        purpose: OTP_PURPOSE,
        verificationId: input.emailVerificationId.trim(),
      })
      .exec();

    if (
      !emailRecord?.verifiedAt ||
      emailRecord.verifiedAt.getTime() < cutoff
    ) {
      throw new BadRequestException(
        'Email verification is required. Verify your email with OTP.',
      );
    }

    const mobileRecord = await this.otpModel
      .findOne({
        channel: 'mobile',
        target: mobile,
        purpose: OTP_PURPOSE,
        verificationId: input.mobileVerificationId.trim(),
      })
      .exec();

    if (
      !mobileRecord?.verifiedAt ||
      mobileRecord.verifiedAt.getTime() < cutoff
    ) {
      throw new BadRequestException(
        'Mobile verification is required. Verify your mobile with OTP.',
      );
    }

    return { emailVerified: true, mobileVerified: true };
  }

  private normalizeTarget(
    channel: 'email' | 'mobile',
    email?: string,
    mobile?: string,
  ) {
    if (channel === 'email') {
      const value = email?.trim().toLowerCase();
      if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new BadRequestException('Enter a valid email address.');
      }
      return value;
    }

    if (channel === 'mobile') {
      throw new BadRequestException(
        'Use /auth/send-otp with purpose REGISTER for mobile verification.',
      );
    }

    throw new BadRequestException('Invalid verification channel.');
  }
}
