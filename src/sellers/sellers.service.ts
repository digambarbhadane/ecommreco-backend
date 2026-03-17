import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { GenerateCredentialsDto } from './dto/generate-credentials.dto';
import { RegisterSellerDto } from './dto/register-seller.dto';
import { SendPaymentLinkDto } from './dto/send-payment-link.dto';
import { Seller, SellerDocument } from './schemas/seller.schema';
import { LeadsService } from '../leads/leads.service';

type ViewerRole =
  | 'super_admin'
  | 'sales_manager'
  | 'accounts_manager'
  | 'training_and_support_manager'
  | 'seller'
  | (string & {});

@Injectable()
export class SellersService {
  constructor(
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    private readonly leadsService: LeadsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private sanitizeSellerForRole(
    seller: Record<string, unknown>,
    role: ViewerRole,
  ) {
    const { password, ...rest } = seller;
    void password;

    const sanitized: Record<string, unknown> = { ...rest };

    if (role !== 'super_admin' && role !== 'sales_manager') {
      delete sanitized.paymentLink;
      delete sanitized.paymentLinkSentAt;
    }

    if (role !== 'super_admin') {
      delete sanitized.credentialsGeneratedAt;
      delete sanitized.credentialsApprovedAt;
      delete sanitized.credentialsSentAt;
    }

    return sanitized;
  }

  async register(dto: RegisterSellerDto) {
    return this.leadsService.createLead(
      {
        ...dto,
      },
      'website',
    );
  }

  async listSellers(params: {
    status?: string;
    limit?: number;
    skip?: number;
    search?: string;
    role: ViewerRole;
  }) {
    const limit = Math.max(0, params.limit ?? 10);
    const skip = Math.max(0, params.skip ?? 0);
    const filter: Record<string, unknown> = {};
    if (params.status) {
      filter.onboardingStatus = params.status;
    }
    if (params.search) {
      const pattern = new RegExp(params.search, 'i');
      filter.$or = [
        { fullName: pattern },
        { email: pattern },
        { contactNumber: pattern },
        { gstNumber: pattern },
      ];
    }
    const data = await this.sellerModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    const total = await this.sellerModel.countDocuments(filter);

    const sanitizedData = data.map((seller) =>
      this.sanitizeSellerForRole(
        seller as unknown as Record<string, unknown>,
        params.role,
      ),
    );
    return {
      success: true,
      data: sanitizedData,
      total,
      limit,
      skip,
    };
  }

  async getSeller(sellerId: string, role: ViewerRole) {
    const seller = await this.sellerModel.findById(sellerId).lean().exec();
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }
    return {
      success: true,
      data: this.sanitizeSellerForRole(
        seller as unknown as Record<string, unknown>,
        role,
      ),
    };
  }

  async sendPaymentLink(sellerId: string, dto: SendPaymentLinkDto) {
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }
    if (!seller.paymentLink) {
      throw new BadRequestException({
        success: false,
        message: 'Payment link not available',
      });
    }
    seller.paymentLinkSentAt = new Date();
    await seller.save();
    const channel = dto.channel ?? 'sms';
    const recipient =
      dto.recipient ??
      (channel === 'email' ? seller.email : seller.contactNumber);
    await this.notificationsService.createNotification({
      event: 'payment_link_sent',
      recipientRole: 'seller',
      message: `Payment link sent via ${channel} to ${recipient}. Link: ${seller.paymentLink}`,
    });
    return {
      success: true,
      data: {
        seller: seller.toObject(),
        paymentLink: seller.paymentLink,
        channel,
        recipient,
      },
    };
  }

  async markPaymentCompleted(sellerId: string) {
    const updated = await this.sellerModel
      .findByIdAndUpdate(
        sellerId,
        {
          onboardingStatus: 'payment_completed',
          paymentCompletedAt: new Date(),
        },
        { new: true },
      )
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }

    await this.notificationsService.createNotification({
      event: 'payment_completed',
      recipientRole: 'operations_admin',
      message: `Payment completed for seller ${updated._id.toString()}.`,
    });
    await this.notificationsService.createNotification({
      event: 'payment_completed',
      recipientRole: 'super_admin',
      message: `Payment completed for seller ${updated._id.toString()}.`,
    });

    return {
      success: true,
      data: updated,
    };
  }

  async generateCredentials(sellerId: string, dto: GenerateCredentialsDto) {
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }
    if (seller.onboardingStatus !== 'payment_completed') {
      throw new BadRequestException({
        success: false,
        message: 'Payment not completed',
      });
    }
    const password =
      dto.password ??
      Math.random().toString(36).slice(-8) +
        Math.random().toString(36).slice(-2);
    seller.password = password;
    seller.onboardingStatus = 'awaiting_super_admin_approval';
    seller.credentialsGeneratedAt = new Date();
    await seller.save();
    await this.notificationsService.createNotification({
      event: 'credentials_generated',
      recipientRole: 'super_admin',
      message: `Credentials generated for seller ${seller.fullName}.`,
    });
    return {
      success: true,
      data: {
        seller: seller.toObject(),
        username: seller.email,
        password,
      },
    };
  }

  async approveCredentials(sellerId: string) {
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }
    if (seller.onboardingStatus !== 'awaiting_super_admin_approval') {
      throw new BadRequestException({
        success: false,
        message: 'Credentials are not awaiting approval',
      });
    }
    seller.onboardingStatus = 'training_pending';
    seller.credentialsApprovedAt = new Date();
    seller.credentialsSentAt = new Date();
    await seller.save();
    await this.notificationsService.createNotification({
      event: 'credentials_approved',
      recipientRole: 'seller',
      message: `Your login credentials are approved. Username: ${seller.email}`,
    });
    await this.notificationsService.createNotification({
      event: 'credentials_approved',
      recipientRole: 'operations_admin',
      message: `Super admin approved credentials for ${seller.fullName}.`,
    });
    await this.notificationsService.createNotification({
      event: 'onboarding_ready',
      recipientRole: 'onboarding_manager',
      message: `Seller ${seller.fullName} is ready for onboarding.`,
    });
    return {
      success: true,
      data: seller.toObject(),
    };
  }

  async completeTraining(sellerId: string) {
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }
    if (seller.onboardingStatus !== 'training_pending') {
      throw new BadRequestException({
        success: false,
        message: 'Seller is not ready for training completion',
      });
    }
    const startsAt = new Date();
    const durationYears = seller.durationYears ?? 1;
    const endsAt = new Date(startsAt);
    endsAt.setFullYear(endsAt.getFullYear() + durationYears);
    seller.onboardingStatus = 'active';
    seller.trainingCompletedAt = new Date();
    seller.subscriptionStartsAt = startsAt;
    seller.subscriptionEndsAt = endsAt;
    await seller.save();
    await this.notificationsService.createNotification({
      event: 'training_completed',
      recipientRole: 'super_admin',
      message: `Seller ${seller.fullName} onboarding completed.`,
    });
    return {
      success: true,
      data: seller.toObject(),
    };
  }

  async updateAccountStatus(sellerId: string, status: string) {
    const allowed = new Set(['active', 'paused', 'suspended', 'suspected']);
    if (!allowed.has(status)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid account status',
      });
    }

    const updated = await this.sellerModel
      .findByIdAndUpdate(sellerId, { accountStatus: status }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }

    await this.notificationsService.createNotification({
      event: 'seller_account_status_updated',
      recipientRole: 'super_admin',
      message: `Seller ${updated._id.toString()} account status updated to ${status}.`,
    });

    return {
      success: true,
      data: this.sanitizeSellerForRole(
        updated as unknown as Record<string, unknown>,
        'super_admin',
      ),
    };
  }
}
