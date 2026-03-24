import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { generatePublicId } from '../common/public-id';
import { NotificationsService } from '../notifications/notifications.service';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { GenerateCredentialsDto } from './dto/generate-credentials.dto';
import { RequestAdminApprovalDto } from './dto/request-approval.dto';
import { CreateSellerFromLeadDto } from './dto/create-seller-from-lead.dto';

const PRICE_PER_GST_PER_YEAR = 12000;

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  fullName?: string;
  username?: string;
  name?: string;
};

type LeanSellerForAssignment = {
  _id: Types.ObjectId;
  assignedAccountsManager?: string | null;
  email?: string;
  publicId?: string;
};

@Injectable()
export class AccountManagerService {
  constructor(
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  private sanitizeSellerForResponse(seller: unknown) {
    const raw =
      seller &&
      typeof seller === 'object' &&
      'toObject' in seller &&
      typeof (seller as { toObject?: unknown }).toObject === 'function'
        ? (seller as { toObject: () => Record<string, unknown> }).toObject()
        : (seller as Record<string, unknown>);

    if (!raw || typeof raw !== 'object') return raw;

    const {
      password,
      pendingPasswordCiphertext,
      pendingPasswordIv,
      pendingPasswordTag,
      ...rest
    } = raw;
    void password;
    void pendingPasswordCiphertext;
    void pendingPasswordIv;
    void pendingPasswordTag;
    return rest;
  }

  private credentialsKey() {
    const seed =
      process.env.CREDENTIALS_ENCRYPTION_KEY ??
      process.env.JWT_SECRET ??
      'dev-secret';
    return crypto.createHash('sha256').update(seed).digest();
  }

  private encryptCredential(value: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.credentialsKey(),
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  private assertAccountManagerAccess(user?: RequestUser) {
    const role = typeof user?.role === 'string' ? user.role : undefined;
    const email =
      typeof user?.email === 'string' ? user.email.toLowerCase() : undefined;
    if (role !== 'accounts_manager' && role !== 'super_admin') {
      throw new ForbiddenException('Access denied');
    }
    return { role, email };
  }

  private buildLeadIdentityFilter(id: string) {
    const or: Array<Record<string, unknown>> = [
      { leadId: id },
      { publicId: id },
    ];
    if (id.length === 24 && Types.ObjectId.isValid(id)) {
      or.push({ _id: new Types.ObjectId(id) });
    }
    return { $or: or };
  }

  async findAllConversionLeads(user?: RequestUser) {
    const { role, email } = this.assertAccountManagerAccess(user);

    const baseAnd: Array<Record<string, unknown>> = [
      { leadStatus: 'converted' },
      {
        $or: [
          { sellerId: { $exists: false } },
          { sellerId: null },
          { sellerId: '' },
        ],
      },
      { 'paymentDetails.status': 'completed' },
      { conversionRequestedAt: { $exists: true } },
    ];

    if (role === 'accounts_manager' && email) {
      baseAnd.push({
        $or: [
          { assignedAccountsManager: email },
          { assignedAccountsManager: { $exists: false } },
          { assignedAccountsManager: null },
          { assignedAccountsManager: '' },
        ],
      });
    }

    const leads = await this.leadModel
      .find({ $and: baseAnd })
      .sort({ conversionRequestedAt: -1, updatedAt: -1 })
      .lean()
      .exec();

    if (role === 'accounts_manager' && email) {
      const toAssign = leads
        .filter(
          (l) =>
            !(l as unknown as { assignedAccountsManager?: string })
              .assignedAccountsManager,
        )
        .map((l) => (l as unknown as { _id: Types.ObjectId })._id);
      if (toAssign.length) {
        await this.leadModel.updateMany(
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

    return { success: true, data: leads };
  }

  async findOneConversionLead(id: string, user?: RequestUser) {
    const { role, email } = this.assertAccountManagerAccess(user);
    const lead = await this.leadModel
      .findOne(this.buildLeadIdentityFilter(id))
      .exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    if (lead.sellerId) {
      throw new BadRequestException('Seller already created for this lead');
    }
    if (lead.leadStatus !== 'converted') {
      throw new BadRequestException('Lead is not ready for conversion');
    }
    if (lead.paymentDetails?.status !== 'completed') {
      throw new BadRequestException('Payment is not completed');
    }
    if (
      !(lead as unknown as { conversionRequestedAt?: Date })
        .conversionRequestedAt
    ) {
      throw new BadRequestException('Conversion request not found');
    }

    if (role === 'accounts_manager') {
      if (
        lead.assignedAccountsManager &&
        email &&
        lead.assignedAccountsManager.toLowerCase() !== email
      ) {
        throw new ForbiddenException('Access denied');
      }
      if (!lead.assignedAccountsManager && email) {
        lead.assignedAccountsManager = email;
        await lead.save();
      }
    }

    return { success: true, data: lead.toObject() };
  }

  async createSellerFromLead(dto: CreateSellerFromLeadDto, user?: RequestUser) {
    const { role, email } = this.assertAccountManagerAccess(user);

    const lead = await this.leadModel
      .findOne(this.buildLeadIdentityFilter(dto.leadId))
      .exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    if (lead.sellerId) {
      throw new BadRequestException('Seller already created for this lead');
    }
    if (lead.leadStatus !== 'converted') {
      throw new BadRequestException('Lead is not ready for conversion');
    }
    if (lead.paymentDetails?.status !== 'completed') {
      throw new BadRequestException('Payment is not completed');
    }
    if (
      !(lead as unknown as { conversionRequestedAt?: Date })
        .conversionRequestedAt
    ) {
      throw new BadRequestException('Conversion request not found');
    }

    if (role === 'accounts_manager') {
      if (
        lead.assignedAccountsManager &&
        email &&
        lead.assignedAccountsManager.toLowerCase() !== email
      ) {
        throw new ForbiddenException('Access denied');
      }
      if (!lead.assignedAccountsManager && email) {
        lead.assignedAccountsManager = email;
      }
    }

    const conflict = await this.sellerModel
      .findOne({
        $or: [
          { email: dto.email.toLowerCase() },
          { contactNumber: dto.contactNumber },
          { gstNumber: dto.gstNumber },
        ],
      })
      .lean()
      .exec();
    if (conflict) {
      throw new BadRequestException('Seller already exists with these details');
    }

    const gstSlots = dto.gstSlots ?? lead.subscriptionConfig?.gstSlots ?? 1;
    const durationYears =
      dto.durationYears ?? lead.subscriptionConfig?.durationYears ?? 1;
    const amount =
      dto.amount ??
      lead.subscriptionConfig?.amount ??
      gstSlots * durationYears * PRICE_PER_GST_PER_YEAR;

    lead.fullName = dto.fullName;
    lead.contactNumber = dto.contactNumber;
    lead.email = dto.email.toLowerCase();
    lead.gstNumber = dto.gstNumber;
    if (dto.businessType) lead.businessType = dto.businessType;
    lead.subscriptionConfig = {
      gstSlots,
      durationYears,
      amount,
      updatedAt: new Date(),
      updatedBy: user?.email || 'accounts_manager',
    };

    const paymentCompletedAt = lead.paymentDetails?.paymentDate
      ? new Date(lead.paymentDetails.paymentDate)
      : new Date(
          (lead as unknown as { conversionRequestedAt?: Date })
            .conversionRequestedAt ?? new Date(),
        );

    const seller = await this.sellerModel.create({
      publicId: generatePublicId('seller', lead.email),
      fullName: lead.fullName,
      contactNumber: lead.contactNumber,
      email: lead.email,
      gstNumber: lead.gstNumber,
      leadId: lead.leadId || lead._id.toString(),
      accountStatus: 'paused',
      gstSlots,
      gstSlotsPurchased: gstSlots,
      durationYears,
      subscriptionDuration: durationYears,
      amount,
      subscriptionId:
        (lead as unknown as { conversionSubscriptionId?: string })
          .conversionSubscriptionId ?? this.generateSubscriptionId(),
      paymentCompletedAt,
      paymentCompletedBy:
        (lead as unknown as { conversionRequestedBy?: string })
          .conversionRequestedBy || 'sales_manager',
      paymentStatus: 'payment_verified',
      paymentDate: paymentCompletedAt,
      paymentAmount: amount,
      onboardingStatus: 'payment_verified',
      paymentVerifiedAt: new Date(),
      paymentVerifiedBy: user?.email || 'account_manager',
      verificationNotes: dto.verificationNotes ?? '',
      salesManager: lead.assignedSalesManager || '',
      businessType: lead.businessType || '',
      leadSource: lead.source || '',
      leadCreatedAt:
        (lead as unknown as { conversionLeadCreatedAt?: Date })
          .conversionLeadCreatedAt ||
        (lead as unknown as { createdAt?: Date }).createdAt ||
        new Date(),
      leadConvertedAt: new Date(
        (lead as unknown as { conversionRequestedAt?: Date })
          .conversionRequestedAt ?? new Date(),
      ),
      leadConvertedBy:
        (lead as unknown as { conversionRequestedBy?: string })
          .conversionRequestedBy || 'sales_manager',
      leadCreatedBy: lead.createdBy || '',
      leadContactedBy: '',
      paymentLinkGeneratedBy: lead.paymentDetails?.generatedBy || '',
      assignedAccountsManager: lead.assignedAccountsManager || email || '',
      salesNotes: '',
    });

    const sellerId = String((seller as unknown as { _id: unknown })._id);
    lead.sellerId = sellerId;
    await lead.save();

    await this.notificationsService.createNotification({
      event: 'seller_created',
      recipientRole: 'super_admin',
      message: `Seller created for lead ${lead.fullName} by ${user?.email || 'Account Manager'}.`,
    });

    const created = await this.sellerModel.findById(sellerId).lean().exec();
    return { success: true, data: created };
  }

  async findAllPaymentCompletedSellers(user?: RequestUser) {
    const role = typeof user?.role === 'string' ? user.role : undefined;
    const email =
      typeof user?.email === 'string' ? user.email.toLowerCase() : undefined;

    const actionableStatuses = [
      'payment_completed',
      'payment_verified',
      'account_created',
      'credentials_generated',
      'awaiting_super_admin_approval',
    ];

    const query: Record<string, unknown> =
      role === 'accounts_manager' && email
        ? {
            $or: [
              { assignedAccountsManager: email },
              {
                $and: [
                  { onboardingStatus: { $in: actionableStatuses } },
                  {
                    $or: [
                      { assignedAccountsManager: { $exists: false } },
                      { assignedAccountsManager: null },
                      { assignedAccountsManager: '' },
                    ],
                  },
                ],
              },
            ],
          }
        : {
            onboardingStatus: {
              $in: [
                ...actionableStatuses,
                'credentials_sent',
                'training_pending',
                'training_completed',
                'active',
              ],
            },
          };

    const sellers = (await this.sellerModel
      .find(query)
      .sort({ updatedAt: -1 })
      .lean()
      .exec()) as LeanSellerForAssignment[];

    const missingPublicIds = sellers
      .map((s) => {
        if (s.publicId) return undefined;
        if (typeof s.email !== 'string' || s.email.trim().length === 0)
          return undefined;
        const publicId = generatePublicId('seller', s.email);
        return { _id: s._id, publicId };
      })
      .filter((v): v is { _id: Types.ObjectId; publicId: string } =>
        Boolean(v),
      );

    if (missingPublicIds.length) {
      await this.sellerModel.bulkWrite(
        missingPublicIds.map((s) => ({
          updateOne: {
            filter: {
              _id: s._id,
              $or: [{ publicId: { $exists: false } }, { publicId: '' }],
            },
            update: { $set: { publicId: s.publicId } },
          },
        })),
      );

      const byId = new Map<string, string>(
        missingPublicIds.map((s) => [s._id.toString(), s.publicId]),
      );
      for (const seller of sellers) {
        if (!seller.publicId) {
          const computed = byId.get(seller._id.toString());
          if (computed) seller.publicId = computed;
        }
      }
    }

    if (role === 'accounts_manager' && email) {
      const toAssign = sellers
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

    return sellers.map((seller) => this.sanitizeSellerForResponse(seller));
  }

  async findOne(id: string, user?: RequestUser) {
    const seller = await this.ensureAccountManagerSellerAccess(id, user);

    if (!seller.publicId) {
      seller.publicId = generatePublicId('seller', seller.email);
      await seller.save();
    }

    const leadRef = seller.leadId;
    if (
      typeof leadRef === 'string' &&
      leadRef.length === 24 &&
      Types.ObjectId.isValid(leadRef)
    ) {
      const lead = await this.leadModel
        .findById(leadRef)
        .select('leadId')
        .lean()
        .exec();
      if (lead?.leadId) {
        seller.leadId = lead.leadId;
      }
    }

    return this.sanitizeSellerForResponse(seller);
  }

  async verifyPayment(dto: VerifyPaymentDto, user?: RequestUser) {
    const seller = await this.ensureAccountManagerSellerAccess(
      dto.sellerId,
      user,
    );

    if (!seller.subscriptionId) {
      seller.subscriptionId = this.generateSubscriptionId();
    }
    seller.underReview = false;
    seller.onboardingStatus = 'payment_verified';
    seller.paymentStatus = 'payment_verified';
    seller.paymentVerifiedAt = new Date();
    seller.paymentVerifiedBy = user?.email || 'account_manager';
    if (dto.verificationNotes) {
      seller.verificationNotes = dto.verificationNotes;
    }
    const saved = await seller.save();
    return this.sanitizeSellerForResponse(saved);
  }

  async createAccount(dto: CreateAccountDto, user?: RequestUser) {
    const seller = await this.ensureAccountManagerSellerAccess(
      dto.sellerId,
      user,
    );

    seller.onboardingStatus = 'account_created';
    seller.accountCreatedAt = new Date();
    seller.accountCreatedBy = user?.email || 'account_manager';
    const saved = await seller.save();

    await this.notificationsService.createNotification({
      event: 'account_created',
      recipientRole: 'super_admin',
      message: `Account created for ${seller.fullName} (Seller ID: ${seller._id.toString()}, Email: ${seller.email}, GST: ${seller.gstNumber || '—'}, GST Slots: ${typeof seller.gstSlots === 'number' ? seller.gstSlots : '—'}, Duration: ${typeof seller.durationYears === 'number' ? seller.durationYears : typeof seller.subscriptionDuration === 'number' ? seller.subscriptionDuration : '—'} year(s), Amount: ${typeof seller.amount === 'number' ? seller.amount : typeof seller.paymentAmount === 'number' ? seller.paymentAmount : '—'}).`,
    });

    return this.sanitizeSellerForResponse(saved);
  }

  async generateCredentials(dto: GenerateCredentialsDto, user?: RequestUser) {
    const seller = await this.ensureAccountManagerSellerAccess(
      dto.sellerId,
      user,
    );

    const username = seller.email.toLowerCase();
    if (
      typeof dto.username === 'string' &&
      dto.username.trim().length > 0 &&
      dto.username.trim().toLowerCase() !== username
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Username must be the seller email',
      });
    }
    const password =
      dto.password || Math.random().toString(36).slice(-8) + 'A1!';

    const hashedPassword = await bcrypt.hash(password, 10);

    seller.username = username;
    seller.password = hashedPassword;
    const encrypted = this.encryptCredential(password);
    seller.pendingPasswordCiphertext = encrypted.ciphertext;
    seller.pendingPasswordIv = encrypted.iv;
    seller.pendingPasswordTag = encrypted.tag;
    seller.accountStatus = 'paused';
    seller.onboardingStatus = 'awaiting_super_admin_approval';
    const credentialsGeneratedAt = new Date();
    seller.credentialsGeneratedAt = credentialsGeneratedAt;
    seller.credentialGeneratedBy = user?.email || 'account_manager';

    await seller.save();

    await this.notificationsService.createNotification({
      event: 'credentials_generated',
      recipientRole: 'super_admin',
      message: `Credentials generated for ${seller.fullName} (Seller ID: ${seller._id.toString()}, Username: ${username}, Email: ${seller.email}, GST: ${seller.gstNumber || '—'}, GST Slots: ${typeof seller.gstSlots === 'number' ? seller.gstSlots : '—'}, Duration: ${typeof seller.durationYears === 'number' ? seller.durationYears : typeof seller.subscriptionDuration === 'number' ? seller.subscriptionDuration : '—'} year(s), Amount: ${typeof seller.amount === 'number' ? seller.amount : typeof seller.paymentAmount === 'number' ? seller.paymentAmount : '—'}).`,
    });

    return {
      username,
      password,
      message: 'Credentials generated and sent for approval',
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

  async requestAdminApproval(dto: RequestAdminApprovalDto, user?: RequestUser) {
    const seller = await this.ensureAccountManagerSellerAccess(
      dto.sellerId,
      user,
    );

    seller.onboardingStatus = 'awaiting_super_admin_approval';
    seller.adminApprovalRequestedAt = new Date();
    seller.adminApprovalRequestedBy = user?.email || 'account_manager';
    const savedSeller = await seller.save();

    await this.notificationsService.createNotification({
      event: 'admin_approval_requested',
      recipientRole: 'super_admin',
      message: `Seller ${seller.fullName} (ID: ${seller._id.toString()}) has requested account approval from ${user?.email || 'Account Manager'}.`,
    });

    return this.sanitizeSellerForResponse(savedSeller);
  }

  private async ensureAccountManagerSellerAccess(
    sellerId: string,
    user?: RequestUser,
  ) {
    const seller = await this.sellerModel.findById(sellerId).exec();
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    const role = typeof user?.role === 'string' ? user.role : undefined;
    const email =
      typeof user?.email === 'string' ? user.email.toLowerCase() : undefined;
    if (role !== 'accounts_manager' && role !== 'super_admin') {
      throw new ForbiddenException('Access denied');
    }

    const allowed = new Set([
      'payment_completed',
      'payment_verified',
      'account_created',
      'credentials_generated',
      'credentials_sent',
      'awaiting_super_admin_approval',
      'training_pending',
      'training_completed',
      'active',
    ]);
    if (!allowed.has(seller.onboardingStatus)) {
      throw new ForbiddenException('Access denied');
    }

    if (
      role === 'accounts_manager' &&
      seller.assignedAccountsManager &&
      seller.assignedAccountsManager.toLowerCase() !== email
    ) {
      throw new ForbiddenException('Access denied');
    }

    if (
      role === 'accounts_manager' &&
      !seller.assignedAccountsManager &&
      email
    ) {
      seller.assignedAccountsManager = email;
      await seller.save();
    }

    return seller;
  }

  private async sendCredentialsEmail(
    email: string,
    username: string,
    password: string,
  ) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.ethereal.email',
      port: parseInt(process.env.SMTP_PORT || '587'),
      auth: {
        user: process.env.SMTP_USER || 'ethereal_user',
        pass: process.env.SMTP_PASS || 'ethereal_pass',
      },
    });

    try {
      const fromEmail =
        process.env.EMAIL_NOTIFICATION || 'notifications@ecommreco.com';
      const fromName = process.env.EMAIL_NOTIFICATION_NAME || 'Ecommreco';
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: 'Your Seller Account Credentials',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Welcome to Seller Insights Hub!</h2>
            <p>Your seller account has been created successfully.</p>
            <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Username:</strong> ${username}</p>
              <p><strong>Password:</strong> ${password}</p>
            </div>
            <p>Please login and change your password immediately.</p>
            <p>Best regards,<br>Seller Insights Hub Team</p>
          </div>
        `,
      });
      console.log(`Credentials email sent to ${email}`);
    } catch (error) {
      console.error('Failed to send credentials email:', error);
    }
  }
}
