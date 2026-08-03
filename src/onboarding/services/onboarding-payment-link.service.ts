import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolvePaymentReturnBaseUrl } from '../../config/payment-urls';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  OnboardingPaymentLink,
  OnboardingPaymentLinkDocument,
} from '../schemas/onboarding-payment-link.schema';
import { ONBOARDING_TIMELINE_EVENTS } from '../constants/onboarding-status';
import { OnboardingTimelineService } from './onboarding-timeline.service';

@Injectable()
export class OnboardingPaymentLinkService {
  constructor(
    @InjectModel(OnboardingPaymentLink.name)
    private readonly linkModel: Model<OnboardingPaymentLinkDocument>,
    private readonly config: ConfigService,
    private readonly timeline: OnboardingTimelineService,
  ) {}

  private getSecret() {
    const secret =
      this.config.get<string>('ONBOARDING_PAYMENT_LINK_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim();
    if (!secret) {
      throw new BadRequestException('Payment link signing is not configured');
    }
    return secret;
  }

  private sign(payload: string) {
    return createHmac('sha256', this.getSecret()).update(payload).digest('hex');
  }

  async createLink(input: {
    leadId: string;
    userId: string;
    planId?: string;
    linkType?: 'trial' | 'subscription' | 'custom';
    customAmount?: number;
    expiryHours?: number;
    createdBy?: string;
  }) {
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = new Date(
      Date.now() + (input.expiryHours ?? 72) * 60 * 60 * 1000,
    );
    const token = randomUUID().replace(/-/g, '');
    const payload = [
      input.leadId,
      input.userId,
      input.planId ?? '',
      input.linkType ?? 'trial',
      String(input.customAmount ?? ''),
      expiresAt.toISOString(),
      nonce,
    ].join('|');
    const signature = this.sign(payload);

    const link = await this.linkModel.create({
      token,
      leadId: new Types.ObjectId(input.leadId),
      userId: new Types.ObjectId(input.userId),
      planId: input.planId ? new Types.ObjectId(input.planId) : undefined,
      linkType: input.linkType ?? 'trial',
      customAmount: input.customAmount,
      nonce,
      expiresAt,
      signature,
      createdBy: input.createdBy,
    });

    const frontendUrl = resolvePaymentReturnBaseUrl(this.config);
    const url = `${frontendUrl.replace(/\/+$/, '')}/pay/l/${token}`;

    await this.timeline.record({
      leadId: input.leadId,
      userId: input.userId,
      eventType: ONBOARDING_TIMELINE_EVENTS.PAYMENT_LINK_SENT,
      message: 'Payment link generated',
      payload: { linkType: link.linkType, expiresAt },
      actorId: input.createdBy,
      actorRole: 'sales_manager',
    });

    return { link, url, token };
  }

  async validateToken(token: string) {
    const link = await this.linkModel.findOne({ token }).exec();
    if (!link) {
      throw new NotFoundException('Payment link not found');
    }
    if (link.revokedAt) {
      throw new BadRequestException('Payment link has been revoked');
    }
    if (link.usedAt) {
      throw new BadRequestException('Payment link has already been used');
    }
    if (link.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Payment link has expired');
    }

    const payload = [
      String(link.leadId),
      String(link.userId),
      link.planId ? String(link.planId) : '',
      link.linkType,
      String(link.customAmount ?? ''),
      link.expiresAt.toISOString(),
      link.nonce,
    ].join('|');
    const expected = this.sign(payload);
    if (expected !== link.signature) {
      throw new BadRequestException('Invalid payment link signature');
    }

    return link;
  }

  async markUsed(token: string) {
    await this.linkModel.updateOne(
      { token, usedAt: { $exists: false } },
      { $set: { usedAt: new Date() } },
    );
  }
}
