import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { NotificationsService } from '../notifications/notifications.service';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreatePanSlotRequestDto } from './dto/create-pan-slot-request.dto';
import { GeneratePaymentLinkDto } from './dto/generate-payment-link.dto';
import {
  PanSlotPricing,
  PanSlotPricingDocument,
} from './schemas/pan-slot-pricing.schema';
import {
  PanSlotRequest,
  PanSlotRequestDocument,
  PanSlotRequestStatus,
} from './schemas/pan-slot-request.schema';
import {
  PanSlotTransaction,
  PanSlotTransactionDocument,
} from './schemas/pan-slot-transaction.schema';

type RequestUser = {
  id?: string;
  role?: string;
  email?: string;
  fullName?: string;
  name?: string;
};

const ACTIVE_STATUSES: PanSlotRequestStatus[] = [
  'PENDING',
  'PAYMENT_PENDING',
  'PAYMENT_RECEIVED',
];

const GST_PERCENTAGE = 18;

const DEFAULT_PRICING = [
  { durationType: 'monthly', label: 'Monthly', durationMonths: 1, pricePerSlot: 1000 },
  {
    durationType: 'quarterly',
    label: 'Quarterly',
    durationMonths: 3,
    pricePerSlot: 3000,
  },
  {
    durationType: 'half_yearly',
    label: 'Half Yearly',
    durationMonths: 6,
    pricePerSlot: 6000,
  },
  { durationType: 'annual', label: 'Annual', durationMonths: 12, pricePerSlot: 12000 },
] as const;

@Injectable()
export class PanSlotRequestsService {
  constructor(
    @InjectModel(PanSlotRequest.name)
    private readonly requestModel: Model<PanSlotRequestDocument>,
    @InjectModel(PanSlotTransaction.name)
    private readonly transactionModel: Model<PanSlotTransactionDocument>,
    @InjectModel(PanSlotPricing.name)
    private readonly pricingModel: Model<PanSlotPricingDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  async ensureDefaultPricing() {
    const count = await this.pricingModel.countDocuments().exec();
    if (count > 0) return;
    await this.pricingModel.insertMany(
      DEFAULT_PRICING.map((item) => ({ ...item, isActive: true })),
    );
  }

  async listPricing() {
    await this.ensureDefaultPricing();
    const data = await this.pricingModel.find().sort({ durationMonths: 1 }).lean().exec();
    return { success: true, data };
  }

  async updatePricing(
    durationType: string,
    body: { pricePerSlot?: number; isActive?: boolean },
  ) {
    await this.ensureDefaultPricing();
    const pricing = await this.pricingModel
      .findOne({ durationType: durationType as PanSlotRequest['durationType'] })
      .exec();
    if (!pricing) {
      throw new NotFoundException('Pricing configuration not found');
    }
    if (typeof body.pricePerSlot === 'number' && body.pricePerSlot >= 0) {
      pricing.pricePerSlot = body.pricePerSlot;
    }
    if (typeof body.isActive === 'boolean') {
      pricing.isActive = body.isActive;
    }
    await pricing.save();
    return { success: true, data: pricing };
  }

  private async generateRequestNumber() {
    const date = new Date();
    const ymd = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('');
    const prefix = `PSR-${ymd}-`;
    const latest = await this.requestModel
      .findOne({ requestNumber: new RegExp(`^${prefix}`) })
      .sort({ requestNumber: -1 })
      .lean()
      .exec();
    const seq = latest?.requestNumber
      ? Number(latest.requestNumber.split('-').pop() ?? 0) + 1
      : 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  private async generateTransactionNumber() {
    const date = new Date();
    const ymd = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('');
    const prefix = `PST-${ymd}-`;
    const latest = await this.transactionModel
      .findOne({ transactionNumber: new RegExp(`^${prefix}`) })
      .sort({ transactionNumber: -1 })
      .lean()
      .exec();
    const seq = latest?.transactionNumber
      ? Number(latest.transactionNumber.split('-').pop() ?? 0) + 1
      : 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  private async findSellerByUser(user: RequestUser) {
    const userId = String(user.id ?? '').trim();
    const email = String(user.email ?? '').trim().toLowerCase();
    if (Types.ObjectId.isValid(userId)) {
      const byId = await this.sellerModel.findById(userId).exec();
      if (byId) return byId;
    }
    if (email) {
      const byEmail = await this.sellerModel
        .findOne({ $or: [{ email }, { username: email }] })
        .exec();
      if (byEmail) return byEmail;
    }
    const sellerUser = await this.userModel
      .findOne({ _id: userId, role: 'seller' })
      .exec();
    if (sellerUser?.email) {
      return this.sellerModel
        .findOne({
          $or: [
            { email: sellerUser.email.toLowerCase() },
            { username: sellerUser.email.toLowerCase() },
          ],
        })
        .exec();
    }
    return null;
  }

  private getSellerIdString(seller: SellerDocument) {
    const id = seller._id as Types.ObjectId | string;
    return typeof id === 'string' ? id : id.toString();
  }

  private async getSellerEntitlements(seller: SellerDocument) {
    const legacyTotal = Math.max(
      0,
      Number(seller.gstSlotsPurchased ?? seller.gstSlots ?? 0),
    );
    const planPanSlots = Math.max(
      0,
      Number(
        seller.allocatedPanSlots != null
          ? seller.allocatedPanSlots
          : legacyTotal,
      ),
    );
    const purchasedPanSlots = Math.max(0, Number(seller.purchasedPanSlots ?? 0));
    const totalPanSlots = Math.max(planPanSlots + purchasedPanSlots, legacyTotal);
    const usedPanSlots = Math.max(
      0,
      Number(seller.usedPanSlots ?? seller.gstSlotsUsed ?? 0),
    );
    return { planPanSlots, purchasedPanSlots, totalPanSlots, usedPanSlots };
  }

  private async syncSellerEntitlementFields(seller: SellerDocument) {
    const { planPanSlots, purchasedPanSlots, totalPanSlots, usedPanSlots } =
      await this.getSellerEntitlements(seller);
    if (seller.allocatedPanSlots == null) {
      seller.allocatedPanSlots = planPanSlots;
    }
    seller.usedPanSlots = usedPanSlots;
    seller.totalPanSlots = totalPanSlots;
    seller.gstSlotsPurchased = totalPanSlots;
    seller.gstSlots = Math.max(Number(seller.gstSlots ?? 0), totalPanSlots);
    await seller.save();
    return { planPanSlots, purchasedPanSlots, totalPanSlots, usedPanSlots };
  }

  private toTwoDecimals(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private toRupee(value: number) {
    return Math.round(value);
  }

  private async resolvePricingTier(durationType: string) {
    await this.ensureDefaultPricing();
    const pricing = await this.pricingModel
      .findOne({
        durationType: durationType as PanSlotRequest['durationType'],
        isActive: true,
      })
      .lean()
      .exec();
    if (!pricing) {
      throw new BadRequestException('Invalid or inactive duration type');
    }
    return pricing;
  }

  private calculatePricingBreakdown(
    requestedPanSlots: number,
    pricePerSlot: number,
  ) {
    const estimatedBaseAmount = this.toRupee(requestedPanSlots * pricePerSlot);
    const gstAmount = this.toTwoDecimals(
      (estimatedBaseAmount * GST_PERCENTAGE) / 100,
    );
    const paymentAmount = this.toRupee(estimatedBaseAmount + gstAmount);
    return { estimatedBaseAmount, gstAmount, paymentAmount };
  }

  async getQuote(requestedPanSlots: number, durationType: string) {
    if (requestedPanSlots < 1) {
      throw new BadRequestException('requestedPanSlots must be at least 1');
    }
    const pricing = await this.resolvePricingTier(durationType);
    const breakdown = this.calculatePricingBreakdown(
      requestedPanSlots,
      pricing.pricePerSlot,
    );
    return {
      success: true,
      data: {
        requestedPanSlots,
        durationType,
        durationMonths: pricing.durationMonths,
        durationLabel: pricing.label,
        pricePerSlot: pricing.pricePerSlot,
        gstPercentage: GST_PERCENTAGE,
        ...breakdown,
      },
    };
  }

  private applyPricingToRequest(
    request: PanSlotRequestDocument,
    requestedPanSlots: number,
    pricing: { label: string; pricePerSlot: number; durationMonths: number },
  ) {
    const breakdown = this.calculatePricingBreakdown(
      requestedPanSlots,
      pricing.pricePerSlot,
    );
    request.estimatedBaseAmount = breakdown.estimatedBaseAmount;
    request.gstAmount = breakdown.gstAmount;
    request.paymentAmount = breakdown.paymentAmount;
    request.pricePerSlot = pricing.pricePerSlot;
    request.durationLabel = pricing.label;
    request.durationMonths = pricing.durationMonths;
  }

  private buildPaymentLink(request: PanSlotRequestDocument, amount: number) {
    const base =
      process.env.PAN_SLOT_PAYMENT_BASE_URL ??
      'https://payments.sellerinsights.com/pan-slots';
    const params = new URLSearchParams({
      requestId: String(request._id),
      requestNumber: request.requestNumber,
      sellerId: request.sellerId,
      slots: String(request.requestedPanSlots),
      amount: String(amount),
      duration: request.durationType,
    });
    return `${base}?${params.toString()}`;
  }

  private async notifyRole(event: string, recipientRole: string, message: string) {
    await this.notificationsService.createNotification({
      event,
      recipientRole,
      message,
    });
  }

  private async sendPanSlotEmail(
    to: string,
    subject: string,
    payload: Record<string, unknown>,
  ) {
    try {
      await this.emailService.sendEmail({
        to,
        type: EmailType.NOTIFICATION,
        subject,
        payload: {
          title: subject,
          body: String(payload.message ?? ''),
          ...payload,
        },
      });
    } catch {
      // Email is best-effort when Postmark is not configured
    }
  }

  async createForSeller(user: RequestUser, dto: CreatePanSlotRequestDto) {
    const seller = await this.findSellerByUser(user);
    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }
    const sellerId = this.getSellerIdString(seller);

    const duplicate = await this.requestModel
      .findOne({ sellerId, status: { $in: ACTIVE_STATUSES } })
      .lean()
      .exec();
    if (duplicate) {
      throw new BadRequestException(
        'You already have an active PAN slot request in progress',
      );
    }

    const pricing = await this.resolvePricingTier(dto.durationType);
    const entitlements = await this.syncSellerEntitlementFields(seller);
    const breakdown = this.calculatePricingBreakdown(
      dto.requestedPanSlots,
      pricing.pricePerSlot,
    );

    const created = await this.requestModel.create({
      requestNumber: await this.generateRequestNumber(),
      sellerId,
      sellerName: seller.fullName,
      sellerEmail: seller.email,
      currentPlanId: seller.subscriptionId,
      currentPlanName: undefined,
      currentPanSlots: entitlements.totalPanSlots,
      currentUsedPanSlots: entitlements.usedPanSlots,
      requestedPanSlots: dto.requestedPanSlots,
      durationType: dto.durationType,
      durationMonths: pricing.durationMonths,
      durationLabel: pricing.label,
      pricePerSlot: pricing.pricePerSlot,
      estimatedBaseAmount: breakdown.estimatedBaseAmount,
      gstAmount: breakdown.gstAmount,
      paymentAmount: breakdown.paymentAmount,
      remarks: dto.remarks,
      status: 'PENDING',
      paymentStatus: 'unpaid',
    });

    await this.notifyRole(
      'pan_slot_requested',
      'super_admin',
      `PAN slot request ${created.requestNumber} submitted by ${seller.fullName} for ${dto.requestedPanSlots} slot(s).`,
    );

    return { success: true, data: created };
  }

  async listForSeller(user: RequestUser) {
    const seller = await this.findSellerByUser(user);
    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }
    const sellerId = this.getSellerIdString(seller);
    const data = await this.requestModel
      .find({ sellerId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return { success: true, data };
  }

  async getByIdForSeller(user: RequestUser, id: string) {
    const seller = await this.findSellerByUser(user);
    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }
    const request = await this.requestModel.findById(id).lean().exec();
    if (!request || request.sellerId !== this.getSellerIdString(seller)) {
      throw new NotFoundException('Request not found');
    }
    return { success: true, data: request };
  }

  async uploadPaymentProof(
    user: RequestUser,
    id: string,
    body: { paymentProof?: string; paymentReference?: string },
  ) {
    const seller = await this.findSellerByUser(user);
    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }
    const request = await this.requestModel.findById(id).exec();
    if (!request || request.sellerId !== this.getSellerIdString(seller)) {
      throw new NotFoundException('Request not found');
    }
    if (!['PAYMENT_PENDING', 'PAYMENT_RECEIVED'].includes(request.status)) {
      throw new BadRequestException('Payment proof can only be uploaded after payment link is generated');
    }
    if (body.paymentProof) request.paymentProof = body.paymentProof;
    if (body.paymentReference) request.paymentReference = body.paymentReference;
    request.paymentStatus = 'proof_uploaded';
    await request.save();
    await this.notifyRole(
      'pan_slot_payment_proof',
      'super_admin',
      `Payment proof uploaded for ${request.requestNumber}.`,
    );
    return { success: true, data: request };
  }

  async markPaymentCompleted(user: RequestUser, id: string, paymentReference?: string) {
    const seller = await this.findSellerByUser(user);
    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }
    const request = await this.requestModel.findById(id).exec();
    if (!request || request.sellerId !== this.getSellerIdString(seller)) {
      throw new NotFoundException('Request not found');
    }
    if (request.status !== 'PAYMENT_PENDING') {
      throw new BadRequestException('Payment can only be marked when status is PAYMENT_PENDING');
    }
    request.paymentStatus = 'completed_by_seller';
    if (paymentReference) request.paymentReference = paymentReference;
    await request.save();
    await this.notifyRole(
      'pan_slot_payment_completed',
      'super_admin',
      `Seller marked payment completed for ${request.requestNumber}.`,
    );
    return { success: true, data: request };
  }

  async cancelBySeller(user: RequestUser, id: string) {
    const seller = await this.findSellerByUser(user);
    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }
    const request = await this.requestModel.findById(id).exec();
    if (!request || request.sellerId !== this.getSellerIdString(seller)) {
      throw new NotFoundException('Request not found');
    }
    if (!['PENDING', 'PAYMENT_PENDING'].includes(request.status)) {
      throw new BadRequestException('This request cannot be cancelled');
    }
    request.status = 'CANCELLED';
    await request.save();
    return { success: true, data: request };
  }

  async adminList(params: {
    status?: string;
    sellerId?: string;
    from?: string;
    to?: string;
    limit?: number;
    skip?: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (params.status) filter.status = params.status;
    if (params.sellerId) filter.sellerId = params.sellerId;
    if (params.from || params.to) {
      filter.createdAt = {};
      if (params.from) {
        (filter.createdAt as Record<string, Date>).$gte = new Date(params.from);
      }
      if (params.to) {
        (filter.createdAt as Record<string, Date>).$lte = new Date(params.to);
      }
    }
    const limit = Math.max(0, params.limit ?? 50);
    const skip = Math.max(0, params.skip ?? 0);
    const [data, total] = await Promise.all([
      this.requestModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.requestModel.countDocuments(filter),
    ]);
    return { success: true, data, total, limit, skip };
  }

  async adminGetById(id: string) {
    const data = await this.requestModel.findById(id).lean().exec();
    if (!data) throw new NotFoundException('Request not found');
    return { success: true, data };
  }

  async adminApprove(id: string, user: RequestUser, adminRemarks?: string) {
    const request = await this.requestModel.findById(id).exec();
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be approved for payment');
    }
    request.approvedBy = user.email ?? user.id;
    request.approvedAt = new Date();
    if (adminRemarks) request.adminRemarks = adminRemarks;

    const pricing = await this.resolvePricingTier(request.durationType);
    this.applyPricingToRequest(request, request.requestedPanSlots, pricing);

    await request.save();
    await this.sendPanSlotEmail(
      request.sellerEmail ?? '',
      `PAN slot request ${request.requestNumber} approved`,
      {
        message: `Your PAN slot request has been approved. Estimated amount ₹${request.estimatedBaseAmount} + GST ₹${request.gstAmount} = ₹${request.paymentAmount} payable.`,
        requestNumber: request.requestNumber,
        estimatedBaseAmount: request.estimatedBaseAmount,
        gstAmount: request.gstAmount,
        paymentAmount: request.paymentAmount,
      },
    );
    await this.notifyRole(
      'pan_slot_approved_for_payment',
      'seller',
      `Your PAN slot request ${request.requestNumber} was approved. Awaiting payment link.`,
    );
    return { success: true, data: request };
  }

  async adminReject(id: string, user: RequestUser, adminRemarks?: string) {
    const request = await this.requestModel.findById(id).exec();
    if (!request) throw new NotFoundException('Request not found');
    if (['APPROVED', 'CANCELLED'].includes(request.status)) {
      throw new BadRequestException('Request cannot be rejected');
    }
    request.status = 'REJECTED';
    request.adminRemarks = adminRemarks;
    request.approvedBy = user.email ?? user.id;
    request.approvedAt = new Date();
    await request.save();
    await this.notifyRole(
      'pan_slot_rejected',
      'seller',
      `PAN slot request ${request.requestNumber} was rejected.`,
    );
    if (request.sellerEmail) {
      await this.sendPanSlotEmail(
        request.sellerEmail,
        `PAN slot request ${request.requestNumber} rejected`,
        {
          message: adminRemarks ?? 'Your request was rejected by the admin team.',
          requestNumber: request.requestNumber,
        },
      );
    }
    return { success: true, data: request };
  }

  async adminGeneratePaymentLink(
    id: string,
    user: RequestUser,
    dto: GeneratePaymentLinkDto,
  ) {
    const request = await this.requestModel.findById(id).exec();
    if (!request) throw new NotFoundException('Request not found');
    if (!['PENDING', 'PAYMENT_PENDING'].includes(request.status)) {
      throw new BadRequestException('Payment link cannot be generated for this request');
    }
    if (request.status === 'PENDING' && !request.approvedAt) {
      throw new BadRequestException('Approve the request before generating a payment link');
    }
    const totalPayable =
      dto.amount > 0 ? dto.amount : (request.paymentAmount ?? 0);
    request.paymentAmount = totalPayable;
    request.paymentLink = this.buildPaymentLink(request, totalPayable);
    request.paymentLinkNotes = dto.notes;
    request.paymentLinkExpiresAt = dto.expiryDate
      ? new Date(dto.expiryDate)
      : undefined;
    request.status = 'PAYMENT_PENDING';
    request.paymentStatus = 'link_sent';
    await request.save();

    if (request.sellerEmail) {
      await this.sendPanSlotEmail(
        request.sellerEmail,
        `Payment link for PAN slot request ${request.requestNumber}`,
        {
          message: `Please complete payment of ₹${dto.amount} using the link below.`,
          requestNumber: request.requestNumber,
          paymentLink: request.paymentLink,
          amount: dto.amount,
        },
      );
    }
    await this.notifyRole(
      'pan_slot_payment_link',
      'seller',
      `Payment link generated for ${request.requestNumber}. Amount: ₹${dto.amount}.`,
    );
    return { success: true, data: request };
  }

  async adminVerifyPayment(
    id: string,
    user: RequestUser,
    body: { paymentReference?: string; adminRemarks?: string },
  ) {
    const request = await this.requestModel.findById(id).exec();
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PAYMENT_PENDING') {
      throw new BadRequestException('Payment can only be verified when status is PAYMENT_PENDING');
    }
    request.status = 'PAYMENT_RECEIVED';
    request.paymentStatus = 'verified';
    request.paymentVerifiedBy = user.email ?? user.id;
    request.paymentVerifiedAt = new Date();
    if (body.paymentReference) request.paymentReference = body.paymentReference;
    if (body.adminRemarks) request.adminRemarks = body.adminRemarks;
    await request.save();
    await this.notifyRole(
      'pan_slot_payment_verified',
      'seller',
      `Payment verified for ${request.requestNumber}. Slots will be assigned shortly.`,
    );
    if (request.sellerEmail) {
      await this.sendPanSlotEmail(
        request.sellerEmail,
        `Payment verified — ${request.requestNumber}`,
        {
          message: 'Your payment has been verified. PAN slots will be assigned shortly.',
          requestNumber: request.requestNumber,
        },
      );
    }
    return { success: true, data: request };
  }

  async adminAssignSlots(id: string, user: RequestUser, adminRemarks?: string) {
    const request = await this.requestModel.findById(id).exec();
    if (!request) throw new NotFoundException('Request not found');
    if (request.slotsAssigned) {
      throw new BadRequestException('Slots have already been assigned for this request');
    }
    if (request.status !== 'PAYMENT_RECEIVED') {
      throw new BadRequestException('Assign slots only after payment is verified');
    }

    const existingTxn = await this.transactionModel
      .findOne({ requestId: String(request._id) })
      .lean()
      .exec();
    if (existingTxn) {
      throw new BadRequestException('Transaction already exists for this request');
    }

    const seller = await this.sellerModel.findById(request.sellerId).exec();
    if (!seller) throw new NotFoundException('Seller not found');

    const entitlements = await this.getSellerEntitlements(seller);
    const previousTotal = entitlements.totalPanSlots;
    if (seller.allocatedPanSlots == null) {
      seller.allocatedPanSlots = entitlements.planPanSlots;
    }
    const newPurchased =
      (seller.purchasedPanSlots ?? entitlements.purchasedPanSlots) +
      request.requestedPanSlots;
    const newTotal = (seller.allocatedPanSlots ?? 0) + newPurchased;

    seller.purchasedPanSlots = newPurchased;
    seller.totalPanSlots = newTotal;
    seller.gstSlotsPurchased = newTotal;
    seller.gstSlots = Math.max(Number(seller.gstSlots ?? 0), newTotal);
    seller.usedPanSlots = entitlements.usedPanSlots;
    await seller.save();

    const transaction = await this.transactionModel.create({
      transactionNumber: await this.generateTransactionNumber(),
      sellerId: request.sellerId,
      requestId: String(request._id),
      slotType: 'PAN',
      purchasedSlots: request.requestedPanSlots,
      durationMonths: request.durationMonths,
      amount: request.paymentAmount ?? 0,
      paymentReference: request.paymentReference,
      paymentDate: request.paymentVerifiedAt ?? new Date(),
      assignedBy: user.email ?? user.id,
      assignedAt: new Date(),
      previousTotalSlots: previousTotal,
      newTotalSlots: newTotal,
      status: 'completed',
      notes: adminRemarks,
    });

    request.status = 'APPROVED';
    request.slotsAssigned = true;
    request.slotsAssignedBy = user.email ?? user.id;
    request.slotsAssignedAt = new Date();
    if (adminRemarks) request.adminRemarks = adminRemarks;
    await request.save();

    await this.notifyRole(
      'pan_slot_assigned',
      'seller',
      `${request.requestedPanSlots} PAN slot(s) assigned for request ${request.requestNumber}. New total: ${newTotal}.`,
    );
    if (request.sellerEmail) {
      await this.sendPanSlotEmail(
        request.sellerEmail,
        `PAN slots assigned — ${request.requestNumber}`,
        {
          message: `${request.requestedPanSlots} PAN slot(s) have been added to your account.`,
          requestNumber: request.requestNumber,
          newTotalSlots: newTotal,
        },
      );
    }

    return { success: true, data: { request, transaction, seller } };
  }

  async adminListTransactions(params: {
    sellerId?: string;
    from?: string;
    to?: string;
    status?: string;
    limit?: number;
    skip?: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (params.sellerId) filter.sellerId = params.sellerId;
    if (params.status) filter.status = params.status;
    if (params.from || params.to) {
      filter.createdAt = {};
      if (params.from) {
        (filter.createdAt as Record<string, Date>).$gte = new Date(params.from);
      }
      if (params.to) {
        (filter.createdAt as Record<string, Date>).$lte = new Date(params.to);
      }
    }
    const limit = Math.max(0, params.limit ?? 50);
    const skip = Math.max(0, params.skip ?? 0);
    const [data, total] = await Promise.all([
      this.transactionModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.transactionModel.countDocuments(filter),
    ]);
    return { success: true, data, total, limit, skip };
  }

  async revenueReport(params: { from?: string; to?: string; sellerId?: string }) {
    const filter: Record<string, unknown> = { status: 'completed' };
    if (params.sellerId) filter.sellerId = params.sellerId;
    if (params.from || params.to) {
      filter.paymentDate = {};
      if (params.from) {
        (filter.paymentDate as Record<string, Date>).$gte = new Date(params.from);
      }
      if (params.to) {
        (filter.paymentDate as Record<string, Date>).$lte = new Date(params.to);
      }
    }
    const data = await this.transactionModel
      .find(filter)
      .sort({ paymentDate: -1 })
      .lean()
      .exec();
    const totalRevenue = data.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    return { success: true, data, totalRevenue };
  }
}
