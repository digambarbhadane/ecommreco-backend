import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { NotificationsService } from '../notifications/notifications.service';
import { GenerateCredentialsDto } from './dto/generate-credentials.dto';
import { RegisterSellerDto } from './dto/register-seller.dto';
import { SendPaymentLinkDto } from './dto/send-payment-link.dto';
import { Seller, SellerDocument } from './schemas/seller.schema';
import { LeadsService } from '../leads/leads.service';
import { generatePublicId } from '../common/public-id';

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  fullName?: string;
  username?: string;
  name?: string;
};

@Injectable()
export class SellersService {
  constructor(
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    private readonly leadsService: LeadsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async register(dto: RegisterSellerDto) {
    return this.leadsService.createLead(
      {
        ...dto,
        captchaToken: dto.captchaToken || 'manual-entry',
      },
      'website',
    );
  }

  async listSellers(
    params: {
      status?: string;
      limit?: number;
      skip?: number;
      search?: string;
    },
    user?: RequestUser,
  ) {
    const limit = Math.max(0, params.limit ?? 10);
    const skip = Math.max(0, params.skip ?? 0);
    const role = typeof user?.role === 'string' ? user.role : undefined;
    const email =
      typeof user?.email === 'string' ? user.email.toLowerCase() : undefined;
    const requestedStatus =
      typeof params.status === 'string' ? params.status : undefined;

    const and: Array<Record<string, unknown>> = [];
    if (requestedStatus && role !== 'training_and_support_manager') {
      and.push({ onboardingStatus: requestedStatus });
    }
    if (params.search) {
      const pattern = new RegExp(params.search, 'i');
      and.push({
        $or: [
          { fullName: pattern },
          { email: pattern },
          { contactNumber: pattern },
          { gstNumber: pattern },
        ],
      });
    }

    if (role === 'sales_manager') {
      and.push({ salesManager: email });
    } else if (role === 'accounts_manager') {
      and.push({
        onboardingStatus: {
          $in: [
            'payment_completed',
            'payment_verified',
            'account_created',
            'credentials_generated',
            'credentials_sent',
            'awaiting_super_admin_approval',
          ],
        },
      });
      and.push({
        $or: [
          { assignedAccountsManager: email },
          { assignedAccountsManager: { $exists: false } },
          { assignedAccountsManager: null },
          { assignedAccountsManager: '' },
        ],
      });
    } else if (role === 'training_and_support_manager') {
      const viewStatus =
        requestedStatus === 'active' ? 'active' : 'training_pending';
      and.push({ onboardingStatus: viewStatus });
      if (viewStatus === 'training_pending') {
        and.push({
          $or: [
            { assignedTrainingSupportManager: email },
            { assignedTrainingSupportManager: { $exists: false } },
            { assignedTrainingSupportManager: null },
            { assignedTrainingSupportManager: '' },
          ],
        });
      } else {
        and.push({ trainingCompletedAt: { $exists: true, $ne: null } });
        and.push({
          $or: [
            { trainingCompletedBy: email },
            { assignedTrainingSupportManager: email },
          ],
        });
      }
    }

    const filter: Record<string, unknown> = and.length ? { $and: and } : {};
    const data = await this.sellerModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    if (role === 'accounts_manager' && email) {
      const toAssign = data
        .filter((s) => !s.assignedAccountsManager)
        .map((s) => s._id);
      if (toAssign.length) {
        await this.sellerModel.updateMany(
          {
            _id: { $in: toAssign },
            $or: [
              { assignedAccountsManager: { $exists: false } },
              { assignedAccountsManager: null },
              { assignedAccountsManager: '' },
            ],
          },
          { $set: { assignedAccountsManager: email } },
        );
      }
    }

    if (
      role === 'training_and_support_manager' &&
      email &&
      requestedStatus !== 'active'
    ) {
      const toAssign = data
        .filter((s) => !s.assignedTrainingSupportManager)
        .map((s) => s._id);
      if (toAssign.length) {
        await this.sellerModel.updateMany(
          {
            _id: { $in: toAssign },
            $or: [
              { assignedTrainingSupportManager: { $exists: false } },
              { assignedTrainingSupportManager: null },
              { assignedTrainingSupportManager: '' },
            ],
          },
          { $set: { assignedTrainingSupportManager: email } },
        );
      }
    }

    const total = await this.sellerModel.countDocuments(filter);
    return {
      success: true,
      data,
      total,
      limit,
      skip,
    };
  }

  async getSeller(sellerId: string, user?: RequestUser) {
    const role = typeof user?.role === 'string' ? user.role : undefined;
    const email =
      typeof user?.email === 'string' ? user.email.toLowerCase() : undefined;
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }

    if (!seller.publicId) {
      seller.publicId = generatePublicId('seller', seller.email);
      await seller.save();
    }

    if (role === 'sales_manager') {
      if (!email || (seller.salesManager ?? '').toLowerCase() !== email) {
        throw new ForbiddenException({
          success: false,
          message: 'Access denied',
        });
      }
    }

    if (role === 'accounts_manager') {
      const allowed = new Set([
        'payment_completed',
        'payment_verified',
        'account_created',
        'credentials_generated',
        'credentials_sent',
        'awaiting_super_admin_approval',
      ]);
      if (!allowed.has(seller.onboardingStatus)) {
        throw new ForbiddenException({
          success: false,
          message: 'Access denied',
        });
      }
      if (
        seller.assignedAccountsManager &&
        seller.assignedAccountsManager.toLowerCase() !== email
      ) {
        throw new ForbiddenException({
          success: false,
          message: 'Access denied',
        });
      }
      if (!seller.assignedAccountsManager && email) {
        seller.assignedAccountsManager = email;
        await seller.save();
      }
    }

    if (role === 'training_and_support_manager') {
      const allowed = new Set(['training_pending', 'active']);
      if (!allowed.has(seller.onboardingStatus)) {
        throw new ForbiddenException({
          success: false,
          message: 'Access denied',
        });
      }
      if (seller.onboardingStatus === 'training_pending') {
        if (
          seller.assignedTrainingSupportManager &&
          seller.assignedTrainingSupportManager.toLowerCase() !== email
        ) {
          throw new ForbiddenException({
            success: false,
            message: 'Access denied',
          });
        }
        if (!seller.assignedTrainingSupportManager && email) {
          seller.assignedTrainingSupportManager = email;
          await seller.save();
        }
      } else {
        const matchesAssignee =
          !!email &&
          (seller.assignedTrainingSupportManager ?? '').toLowerCase() === email;
        const matchesCompleter =
          !!email && (seller.trainingCompletedBy ?? '').toLowerCase() === email;
        if (!!email && !matchesAssignee && !matchesCompleter) {
          throw new ForbiddenException({
            success: false,
            message: 'Access denied',
          });
        }
      }
    }

    return {
      success: true,
      data: seller.toObject(),
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

  async markPaymentCompleted(sellerId: string, user?: RequestUser) {
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }

    const paymentCompletedAt = new Date();
    if (!seller.subscriptionId) {
      seller.subscriptionId = this.generateSubscriptionId();
    }
    seller.onboardingStatus = 'payment_completed';
    seller.paymentCompletedAt = paymentCompletedAt;
    seller.paymentCompletedBy = user?.email || 'admin';
    seller.paymentStatus = 'payment_completed';
    seller.paymentDate = paymentCompletedAt;
    if (typeof seller.amount === 'number') {
      seller.paymentAmount = seller.amount;
    }
    const updated = await seller.save();

    await this.notificationsService.createNotification({
      event: 'payment_completed',
      recipientRole: 'operations_admin',
      message: `Payment completed for seller ${updated._id.toString()} by ${user?.email || 'admin'}.`,
    });
    await this.notificationsService.createNotification({
      event: 'payment_completed',
      recipientRole: 'super_admin',
      message: `Payment completed for seller ${updated._id.toString()} by ${user?.email || 'admin'}.`,
    });
    await this.notificationsService.createNotification({
      event: 'payment_completed',
      recipientRole: 'accounts_manager',
      message: `Payment completed for seller ${updated._id.toString()} by ${user?.email || 'admin'}.`,
    });

    return {
      success: true,
      data: updated.toObject(),
    };
  }

  async generateCredentials(
    sellerId: string,
    dto: GenerateCredentialsDto,
    user?: RequestUser,
  ) {
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
    const hashedPassword = await bcrypt.hash(password, 10);
    seller.password = hashedPassword;
    seller.username = seller.email;
    const actorRole = typeof user?.role === 'string' ? user.role : undefined;
    const credentialsGeneratedAt = new Date();
    seller.credentialsGeneratedAt = credentialsGeneratedAt;
    seller.credentialGeneratedBy = user?.email || 'admin';
    seller.onboardingStatus =
      actorRole === 'super_admin'
        ? 'credentials_sent'
        : 'awaiting_super_admin_approval';
    if (actorRole === 'super_admin') {
      seller.credentialsApprovedAt = credentialsGeneratedAt;
      seller.credentialsApprovedBy = user?.email || 'admin';
      seller.credentialsSentAt = credentialsGeneratedAt;
    }
    if (!seller.subscriptionStartsAt) {
      const durationYears =
        seller.durationYears ?? seller.subscriptionDuration ?? 1;
      const endsAt = new Date(credentialsGeneratedAt);
      endsAt.setFullYear(endsAt.getFullYear() + durationYears);
      seller.subscriptionStartsAt = credentialsGeneratedAt;
      seller.subscriptionEndsAt = endsAt;
    }
    await seller.save();
    await this.notificationsService.createNotification({
      event: 'credentials_generated',
      recipientRole: 'super_admin',
      message: `Credentials generated for ${seller.fullName} (Seller ID: ${seller._id.toString()}, Username: ${seller.email}, Email: ${seller.email}, GST: ${seller.gstNumber || '—'}, GST Slots: ${typeof seller.gstSlots === 'number' ? seller.gstSlots : '—'}, Duration: ${typeof seller.durationYears === 'number' ? seller.durationYears : typeof seller.subscriptionDuration === 'number' ? seller.subscriptionDuration : '—'} year(s), Amount: ${typeof seller.amount === 'number' ? seller.amount : typeof seller.paymentAmount === 'number' ? seller.paymentAmount : '—'}).`,
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

  async approveCredentials(sellerId: string, user?: RequestUser) {
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) {
      throw new NotFoundException({
        success: false,
        message: 'Seller not found',
      });
    }
    if (
      seller.onboardingStatus !== 'awaiting_super_admin_approval' &&
      seller.onboardingStatus !== 'credentials_sent'
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Credentials are not awaiting approval',
      });
    }
    seller.onboardingStatus = 'training_pending';
    seller.credentialsApprovedAt = new Date();
    seller.credentialsSentAt = new Date();
    seller.credentialsApprovedBy = user?.email || 'admin';
    await seller.save();
    await this.notificationsService.createNotification({
      event: 'credentials_approved',
      recipientRole: 'seller',
      message: `Your login credentials are approved. Username: ${seller.email}`,
    });
    await this.notificationsService.createNotification({
      event: 'credentials_approved',
      recipientRole: 'operations_admin',
      message: `Super admin approved credentials for ${seller.fullName} (Seller ID: ${seller._id.toString()}).`,
    });
    await this.notificationsService.createNotification({
      event: 'credentials_approved',
      recipientRole: 'customer_success_manager',
      message: `Seller credentials approved for ${seller.fullName}.`,
    });
    await this.notificationsService.createNotification({
      event: 'onboarding_ready',
      recipientRole: 'onboarding_manager',
      message: `Seller ${seller.fullName} (Seller ID: ${seller._id.toString()}) is ready for onboarding.`,
    });

    await this.notificationsService.createNotification({
      event: 'credentials_approved',
      recipientRole: 'accounts_manager',
      message: `Credentials approved for ${seller.fullName} (Seller ID: ${seller._id.toString()}, Email: ${seller.email}, GST: ${seller.gstNumber || '—'}). Moved to training.`,
    });

    await this.notificationsService.createNotification({
      event: 'credentials_approved',
      recipientRole: 'training_and_support_manager',
      message: `New seller ready for training: ${seller.fullName} (Seller ID: ${seller._id.toString()}, Email: ${seller.email}, Contact: ${seller.contactNumber}, GST: ${seller.gstNumber || '—'}).`,
    });
    return {
      success: true,
      data: seller.toObject(),
    };
  }

  async completeTraining(sellerId: string, user?: RequestUser) {
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
    seller.onboardingStatus = 'active';
    seller.trainingCompletedAt = new Date();
    seller.trainingCompletedBy = user?.email || 'admin';
    await seller.save();
    await this.notificationsService.createNotification({
      event: 'training_completed',
      recipientRole: 'super_admin',
      message: `Seller ${seller.fullName} onboarding completed by ${user?.email || 'admin'}.`,
    });
    await this.notificationsService.createNotification({
      event: 'training_completed',
      recipientRole: 'seller',
      message:
        'Training completed. Your account is now active and you can use the platform.',
    });
    return {
      success: true,
      data: seller.toObject(),
    };
  }

  private generateSubscriptionId() {
    const date = new Date();
    const y = date.getFullYear().toString();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `SUB-${y}${m}${d}-${rand}`;
  }
}
