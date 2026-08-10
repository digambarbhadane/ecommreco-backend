import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { OtpPurpose } from './otp.constants';
import {
  OtpVerification,
  OtpVerificationDocument,
} from './schemas/otp-verification.schema';

@Injectable()
export class OtpRepository {
  constructor(
    @InjectModel(OtpVerification.name)
    private readonly model: Model<OtpVerificationDocument>,
  ) {}

  findByMobileAndPurpose(mobile: string, purpose: OtpPurpose) {
    return this.model.findOne({ mobile, purpose }).exec();
  }

  create(data: Partial<OtpVerification>) {
    return this.model.create(data);
  }

  save(document: OtpVerificationDocument) {
    return document.save();
  }

  setMsg91Session(document: OtpVerificationDocument, reqId: string) {
    return this.model
      .findOneAndUpdate(
        { _id: document._id },
        { $set: { msg91ReqId: reqId }, $unset: { otpHash: '' } },
        { new: true },
      )
      .exec();
  }

  setLocalOtpHash(document: OtpVerificationDocument, otpHash: string) {
    return this.model
      .findOneAndUpdate(
        { _id: document._id },
        { $set: { otpHash }, $unset: { msg91ReqId: '' } },
        { new: true },
      )
      .exec();
  }

  deleteByMobileAndPurpose(mobile: string, purpose: OtpPurpose) {
    return this.model.deleteOne({ mobile, purpose }).exec();
  }

  deleteVerifiedProof(mobile: string, purpose: OtpPurpose) {
    return this.model.deleteOne({
      mobile,
      purpose,
      verified: true,
    }).exec();
  }

  upsertWidgetVerified(
    mobile: string,
    purpose: OtpPurpose,
    data: {
      verifiedAt: Date;
      verificationProofExpiresAt: Date;
      requestedIp?: string;
      requestedUserAgent?: string;
    },
  ) {
    return this.model.findOneAndUpdate(
      { mobile, purpose },
      {
        $set: {
          mobile,
          purpose,
          verified: true,
          verifiedAt: data.verifiedAt,
          verificationProofExpiresAt: data.verificationProofExpiresAt,
          attempts: 0,
          requestCount: 1,
          lastSentAt: data.verifiedAt,
          requestedIp: data.requestedIp,
          requestedUserAgent: data.requestedUserAgent,
        },
        $unset: {
          otpHash: '',
          expiresAt: '',
          blockedUntil: '',
          msg91ReqId: '',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
  }
}
