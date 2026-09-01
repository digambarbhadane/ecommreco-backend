import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
import { randomBytes } from 'crypto';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { generatePublicId } from '../common/public-id';
import { NotificationsService } from '../notifications/notifications.service';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { GenerateCredentialsDto } from './dto/generate-credentials.dto';
import { RequestAdminApprovalDto } from './dto/request-approval.dto';
import { CreateSellerFromLeadDto } from './dto/create-seller-from-lead.dto';
import {
  PaymentOrder,
  PaymentOrderDocument,
} from '../payments/schemas/payment-order.schema';
import {
  buildSubscriptionPeriodFromMonths,
  extractQuoteFromPaymentMetadata,
  normalizeReportMonths,
  type LeadConversionQuoteSnapshot,
} from '../billing/utils/reconciliation-subscription.util';

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
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(PaymentOrder.name)
    private paymentOrderModel: Model<PaymentOrderDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  private assertAccountManagerAccess(user?: RequestUser) {
    const role = typeof user?.role === 'string' ? user.role : undefined;
    const email =
      typeof user?.email === 'string' ? user.email.toLowerCase() : undefined;
    if (role !== 'accounts_manager' && role !== 'super_admin') {
      throw new ForbiddenException('Access denied');
    }
    return { role, email };
  }

  private formatSellerResponse(
    seller: SellerDocument | Record<string, unknown>,
  ) {
    const raw =
      typeof (seller as SellerDocument).toObject === 'function'
        ? (seller as SellerDocument).toObject()
        : { ...seller };
    const { password, ...rest } = raw as Record<string, unknown> & {
      password?: string;
      _id?: Types.ObjectId;
    };
    void password;
    const id =
      rest._id instanceof Types.ObjectId
        ? rest._id.toString()
        : typeof rest._id === 'string'
          ? rest._id
          : undefined;
    return {
      success: true,
      data: {
        ...rest,
        id: id ?? rest.id,
      },
    };
  }

  private async findSellerByIdentifier(identifier: string) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;
    if (Types.ObjectId.isValid(value) && value.length === 24) {
      const sellerById = await this.sellerModel.findById(value).exec();
      if (sellerById) return sellerById;
    }
    const sellerByPublicId = await this.sellerModel
      .findOne({ publicId: value })
      .exec();
    if (sellerByPublicId) return sellerByPublicId;
    return this.sellerModel.findOne({ leadId: value }).exec();
  }

  private async syncSellerUserAccount(
    seller: SellerDocument,
    options?: {
      password?: string;
      username?: string;
      actorEmail?: string;
    },
  ) {
    const email = seller.email.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email }).exec();
    if (existing && existing.role !== 'seller') {
      throw new BadRequestException(
        'A user with this email already exists with a different role',
      );
    }

    const companyName = seller.firmName || seller.tradeName || '';
    const update: Record<string, unknown> = {
      fullName: seller.fullName,
      email,
      username: email,
      mobile: seller.contactNumber,
      companyName,
      role: 'seller',
      status: 'approved',
      profileCompleted: true,
    };

    if (options?.password) {
      update.password = await bcrypt.hash(options.password, 10);
      update.mustChangePassword = true;
      update.credentialsGeneratedAt = new Date();
      update.credentialsGeneratedBy = options.actorEmail || 'account_manager';
    }

    if (existing) {
      await this.userModel
        .updateOne({ _id: existing._id }, { $set: update })
        .exec();
      return existing._id.toString();
    }

    const created = await this.userModel.create({
      publicId: generatePublicId('user', email),
      ...update,
      password:
        typeof update.password === 'string'
          ? update.password
          : await bcrypt.hash(randomBytes(12).toString('hex'), 10),
      mustChangePassword: true,
      credentialsGeneratedAt: options?.password ? new Date() : undefined,
      credentialsGeneratedBy: options?.actorEmail,
    });
    return created._id.toString();
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

    await this.repairStuckConversionLeads();

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
      {
        $or: [
          { conversionRequestedAt: { $exists: true, $ne: null } },
          { convertedAt: { $exists: true, $ne: null } },
        ],
      },
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
    this.repairConversionLeadFields(lead);
    if (lead.isModified()) {
      lead.markModified('paymentDetails');
      await lead.save();
    }
    if (lead.paymentDetails?.status !== 'completed') {
      throw new BadRequestException('Payment is not completed');
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
    this.repairConversionLeadFields(lead);
    if (lead.isModified()) {
      lead.markModified('paymentDetails');
      await lead.save();
    }
    if (lead.paymentDetails?.status !== 'completed') {
      throw new BadRequestException('Payment is not completed');
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

    const normalizedEmail = dto.email.trim().toLowerCase();
    const resolvedGstNumber =
      (typeof dto.gstNumber === 'string' && dto.gstNumber.trim()
        ? dto.gstNumber.trim().toUpperCase()
        : '') ||
      (typeof lead.gstNumber === 'string' && lead.gstNumber.trim()
        ? lead.gstNumber.trim().toUpperCase()
        : '') ||
      'PENDING';

    const conflictConditions: Array<Record<string, unknown>> = [
      { email: normalizedEmail },
      { contactNumber: dto.contactNumber },
    ];
    if (resolvedGstNumber !== 'PENDING') {
      conflictConditions.push({ gstNumber: resolvedGstNumber });
    }

    const conflict = await this.sellerModel
      .findOne({ $or: conflictConditions })
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
    lead.email = normalizedEmail;
    lead.gstNumber = resolvedGstNumber;
    if (dto.businessType) lead.businessType = dto.businessType;
    lead.subscriptionConfig = {
      gstSlots,
      durationYears,
      amount,
      updatedAt: new Date(),
      updatedBy: user?.email || 'accounts_manager',
    };
    await lead.save();

    const paymentCompletedAt = lead.paymentDetails?.paymentDate
      ? new Date(lead.paymentDetails.paymentDate)
      : new Date(
          (lead as unknown as { conversionRequestedAt?: Date })
            .conversionRequestedAt ?? new Date(),
        );

    const conversionQuote = await this.resolveLeadConversionQuote(lead);
    const quoteMonths = normalizeReportMonths(
      conversionQuote?.selectedMonths ??
        lead.subscriptionConfig?.selectedMonths ??
        [],
    );
    const subscriptionPeriod = buildSubscriptionPeriodFromMonths(
      quoteMonths,
      paymentCompletedAt,
    );
    const panSlots =
      conversionQuote?.panSlots ??
      conversionQuote?.gstSlots ??
      gstSlots;
    const marketplaceSlots =
      conversionQuote?.marketplaceSlots ??
      (conversionQuote?.planType === 'single_gst' ||
      lead.subscriptionConfig?.planType === 'single_gst'
        ? 1
        : undefined);
    const subscriptionDurationDays =
      conversionQuote?.durationDays ??
      (quoteMonths.length > 0 ? quoteMonths.length * 30 : durationYears * 365);

    const seller = await this.sellerModel.create({
      publicId: generatePublicId('seller', lead.email),
      fullName: lead.fullName,
      contactNumber: lead.contactNumber,
      email: lead.email,
      gstNumber: lead.gstNumber,
      leadId: lead.leadId || lead._id.toString(),
      gstSlots,
      gstSlotsPurchased: gstSlots,
      allocatedPanSlots: panSlots,
      totalPanSlots: panSlots,
      marketplaceSlotsPurchased: marketplaceSlots,
      durationYears:
        quoteMonths.length > 0
          ? Math.max(1, Math.ceil(quoteMonths.length / 12))
          : durationYears,
      subscriptionDuration: subscriptionDurationDays,
      subscriptionPlanType: (conversionQuote?.planType ??
        lead.subscriptionConfig?.planType) as
        | 'single_gst'
        | 'multi_gst_pan'
        | 'single_gst_multi_marketplace'
        | undefined,
      subscriptionPlanLabel:
        conversionQuote?.packageName ??
        lead.subscriptionConfig?.packageName ??
        undefined,
      reconciliationMonths: quoteMonths.length ? quoteMonths : undefined,
      subscriptionStartsAt: subscriptionPeriod.startsAt,
      subscriptionEndsAt: subscriptionPeriod.endsAt,
      amount,
      subscriptionId:
        (lead as unknown as { conversionSubscriptionId?: string })
          .conversionSubscriptionId ?? this.generateSubscriptionId(),
      paymentCompletedAt,
      paymentCompletedBy:
        (lead as unknown as { conversionRequestedBy?: string })
          .conversionRequestedBy || 'sales_manager',
      paymentStatus: 'payment_completed',
      paymentDate: paymentCompletedAt,
      paymentAmount: amount,
      onboardingStatus: 'payment_completed',
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
      verificationNotes: dto.verificationNotes ?? '',
    });

    const sellerId = String((seller as unknown as { _id: unknown })._id);
    lead.sellerId = sellerId;
    await lead.save();

    await this.syncSellerUserAccount(seller, {
      actorEmail: user?.email || 'account_manager',
    });

    await this.notificationsService.createNotification({
      event: 'seller_created',
      recipientRole: 'super_admin',
      message: `Seller created for lead ${lead.fullName} by ${user?.email || 'Account Manager'}. Credentials can be generated after account setup.`,
    });

    const created = await this.sellerModel.findById(sellerId).exec();
    if (!created) {
      throw new NotFoundException('Seller not found after creation');
    }
    return this.formatSellerResponse(created);
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

    return sellers.map((seller) => {
      const id = seller._id.toString();
      return {
        ...seller,
        id,
      };
    });
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

    try {
      await this.syncSellerUserAccount(seller, {
        actorEmail: user?.email || 'account_manager',
      });
    } catch {
      // Non-fatal: seller details should still load even if user sync fails.
    }

    return this.formatSellerResponse(seller);
  }

  async verifyPayment(dto: VerifyPaymentDto, user?: RequestUser) {
    const seller = await this.ensureAccountManagerSellerAccess(
      dto.sellerId,
      user,
    );

    if (!seller.subscriptionId) {
      seller.subscriptionId = this.generateSubscriptionId();
    }
    seller.onboardingStatus = 'payment_verified';
    seller.paymentStatus = 'payment_verified';
    seller.paymentVerifiedAt = new Date();
    seller.paymentVerifiedBy = user?.email || 'account_manager';
    if (dto.verificationNotes) {
      seller.verificationNotes = dto.verificationNotes;
    }
    return seller.save();
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

    await this.syncSellerUserAccount(saved, {
      actorEmail: user?.email || 'account_manager',
    });

    await this.notificationsService.createNotification({
      event: 'account_created',
      recipientRole: 'super_admin',
      message: `Account created for ${seller.fullName} (Seller ID: ${seller._id.toString()}, Email: ${seller.email}, GST: ${seller.gstNumber || '—'}, GST Slots: ${typeof seller.gstSlots === 'number' ? seller.gstSlots : '—'}, Duration: ${typeof seller.durationYears === 'number' ? seller.durationYears : typeof seller.subscriptionDuration === 'number' ? seller.subscriptionDuration : '—'} year(s), Amount: ${typeof seller.amount === 'number' ? seller.amount : typeof seller.paymentAmount === 'number' ? seller.paymentAmount : '—'}).`,
    });

    return this.formatSellerResponse(saved);
  }

  async generateCredentials(dto: GenerateCredentialsDto, user?: RequestUser) {
    const seller = await this.ensureAccountManagerSellerAccess(
      dto.sellerId,
      user,
    );

    const username = seller.email.trim().toLowerCase();
    const password =
      dto.password || Math.random().toString(36).slice(-8) + 'A1!';

    const hashedPassword = await bcrypt.hash(password, 10);

    seller.username = username;
    seller.password = hashedPassword;
    seller.onboardingStatus = 'awaiting_super_admin_approval';
    const credentialsGeneratedAt = new Date();
    seller.credentialsGeneratedAt = credentialsGeneratedAt;
    seller.credentialGeneratedBy = user?.email || 'account_manager';
    if (!seller.subscriptionStartsAt) {
      const anchor = credentialsGeneratedAt;
      const months = normalizeReportMonths(seller.reconciliationMonths ?? []);
      if (months.length) {
        const period = buildSubscriptionPeriodFromMonths(months, anchor);
        seller.subscriptionStartsAt = period.startsAt;
        seller.subscriptionEndsAt = period.endsAt;
      } else {
        const durationYears =
          seller.durationYears ?? seller.subscriptionDuration ?? 1;
        const endsAt = new Date(anchor);
        endsAt.setFullYear(endsAt.getFullYear() + Number(durationYears));
        seller.subscriptionStartsAt = anchor;
        seller.subscriptionEndsAt = endsAt;
      }
    }

    await seller.save();

    await this.syncSellerUserAccount(seller, {
      password,
      username,
      actorEmail: user?.email || 'account_manager',
    });

    await this.notificationsService.createNotification({
      event: 'credentials_generated',
      recipientRole: 'super_admin',
      message: `Credentials generated for ${seller.fullName} (Seller ID: ${seller._id.toString()}, Username: ${username}, Email: ${seller.email}, GST: ${seller.gstNumber || '—'}, GST Slots: ${typeof seller.gstSlots === 'number' ? seller.gstSlots : '—'}, Duration: ${typeof seller.durationYears === 'number' ? seller.durationYears : typeof seller.subscriptionDuration === 'number' ? seller.subscriptionDuration : '—'} year(s), Amount: ${typeof seller.amount === 'number' ? seller.amount : typeof seller.paymentAmount === 'number' ? seller.paymentAmount : '—'}).`,
    });

    return {
      success: true,
      username,
      password,
      message: 'Credentials generated and sent for approval',
      data: this.formatSellerResponse(seller).data,
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

  private async resolveLeadConversionQuote(
    lead: LeadDocument,
  ): Promise<LeadConversionQuoteSnapshot | null> {
    const fromLeadConfig = lead.subscriptionConfig;
    if (
      fromLeadConfig?.selectedMonths?.length ||
      fromLeadConfig?.packageName ||
      fromLeadConfig?.planType
    ) {
      return {
        packageName: fromLeadConfig.packageName,
        planType: fromLeadConfig.planType,
        selectedMonths: normalizeReportMonths(fromLeadConfig.selectedMonths ?? []),
        monthCount: fromLeadConfig.selectedMonths?.length,
        gstSlots: fromLeadConfig.gstSlots,
        panSlots: fromLeadConfig.gstSlots,
        durationYears: fromLeadConfig.durationYears,
        totalPayable: fromLeadConfig.amount,
      };
    }

    const order = await this.paymentOrderModel
      .findOne({
        leadId: lead._id,
        'metadata.checkoutType': 'lead_conversion',
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return extractQuoteFromPaymentMetadata(
      (order?.metadata ?? null) as Record<string, unknown> | null,
    );
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

    return savedSeller;
  }

  private async ensureAccountManagerSellerAccess(
    sellerId: string,
    user?: RequestUser,
  ) {
    const seller = await this.findSellerByIdentifier(sellerId);
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

  private repairConversionLeadFields(lead: LeadDocument) {
    const now = new Date();
    if (!lead.conversionRequestedAt) {
      lead.conversionRequestedAt =
        lead.convertedAt ??
        (lead.paymentDetails?.paymentDate
          ? new Date(lead.paymentDetails.paymentDate)
          : now);
    }
    if (!lead.convertedAt) {
      lead.convertedAt = lead.conversionRequestedAt;
    }
    const paymentDetails = lead.paymentDetails ?? {
      link: 'manual-conversion',
      status: 'completed' as const,
      generatedBy: 'system',
      generatedAt: now,
    };
    if (paymentDetails.status !== 'completed') {
      paymentDetails.status = 'completed';
    }
    if (!paymentDetails.paymentDate) {
      paymentDetails.paymentDate = lead.conversionRequestedAt ?? now;
    }
    lead.paymentDetails = paymentDetails;
    lead.markModified('paymentDetails');
  }

  async findSellerByLeadId(leadId: string, user?: RequestUser) {
    this.assertAccountManagerAccess(user);

    const lead = await this.leadModel
      .findOne(this.buildLeadIdentityFilter(leadId))
      .exec();
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    let seller: SellerDocument | null = null;
    if (typeof lead.sellerId === 'string' && lead.sellerId.trim()) {
      seller = await this.findSellerByIdentifier(lead.sellerId);
    }
    if (!seller && lead.leadId) {
      seller = await this.findSellerByIdentifier(lead.leadId);
    }
    if (!seller && lead.email) {
      seller = await this.sellerModel
        .findOne({
          email: lead.email.trim().toLowerCase(),
          leadId: lead.leadId || lead._id.toString(),
        })
        .exec();
    }
    if (!seller) {
      throw new NotFoundException('Seller not found for this lead');
    }

    if (!lead.sellerId) {
      lead.sellerId = seller._id.toString();
      await lead.save();
    }

    return this.findOne(seller._id.toString(), user);
  }

  private async repairStuckConversionLeads() {
    const stuckLeads = await this.leadModel
      .find({
        leadStatus: 'converted',
        $and: [
          {
            $or: [
              { sellerId: { $exists: false } },
              { sellerId: null },
              { sellerId: '' },
            ],
          },
          {
            $or: [
              { 'paymentDetails.status': { $ne: 'completed' } },
              { conversionRequestedAt: { $exists: false } },
              { conversionRequestedAt: null },
            ],
          },
        ],
      })
      .exec();

    for (const lead of stuckLeads) {
      this.repairConversionLeadFields(lead);
      await lead.save();
    }
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
