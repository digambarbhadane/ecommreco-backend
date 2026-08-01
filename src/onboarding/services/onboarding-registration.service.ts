import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Connection, Model } from 'mongoose';
import { Lead, LeadDocument } from '../../leads/schemas/lead.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { Seller, SellerDocument } from '../../sellers/schemas/seller.schema';
import { generatePublicId } from '../../common/public-id';
import {
  extractPanFromGstin,
} from '../../trial/trial.constants';
import { OnboardingRegisterDto } from '../dto/onboarding.dto';
import { ONBOARDING_TIMELINE_EVENTS } from '../constants/onboarding-status';
import { OnboardingStateMachineService } from './onboarding-state-machine.service';
import { OnboardingTimelineService } from './onboarding-timeline.service';
import { OnboardingPaymentService } from './onboarding-payment.service';

@Injectable()
export class OnboardingRegistrationService {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly stateMachine: OnboardingStateMachineService,
    private readonly timeline: OnboardingTimelineService,
    private readonly paymentService: OnboardingPaymentService,
  ) {}

  async register(dto: OnboardingRegisterDto) {
    if (!dto.acceptTerms) {
      throw new BadRequestException('You must accept the Terms to continue.');
    }
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Password and Confirm Password do not match.');
    }

    const email = dto.email.trim().toLowerCase();
    const mobile = dto.mobile.trim();
    const panNumber = dto.panNumber.trim().toUpperCase();
    const gstNumber = dto.gstNumber.trim().toUpperCase();
    const panFromGst = extractPanFromGstin(gstNumber);
    if (panFromGst && panFromGst !== panNumber) {
      throw new BadRequestException(
        'PAN number does not match the PAN embedded in GSTIN.',
      );
    }

    const existingUser = await this.userModel.findOne({ email }).exec();
    if (existingUser) {
      return this.handleExistingUser(existingUser);
    }

    await this.assertIdentityAvailable({ email, mobile, panNumber, gstNumber });

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const leadNumber = generatePublicId('lead', email);
    const session = await this.connection.startSession();
    let lead: LeadDocument;
    let user: UserDocument;

    try {
      session.startTransaction();

      const createdLeads = await this.leadModel.create(
        [
          {
            publicId: generatePublicId('lead', email),
            leadId: leadNumber,
            leadNumber,
            fullName: dto.ownerName.trim(),
            firmName: dto.companyName.trim(),
            contactNumber: mobile,
            email,
            gstNumber,
            panNumber,
            city: dto.city?.trim(),
            state: dto.state?.trim(),
            country: dto.country?.trim() ?? 'India',
            businessType: dto.businessType?.trim(),
            source: dto.source?.trim() || 'self_service_trial',
            onboardingStatus: 'REGISTERED',
            pipelineStage: 'Payment Pending',
            leadStatus: 'interested',
            status: 'FOLLOW_UP',
            metadata: { panNumber, registrationSource: 'onboarding_v2' },
          },
        ],
        { session },
      );
      lead = createdLeads[0];

      const createdUsers = await this.userModel.create(
        [
          {
            publicId: generatePublicId('seller', email),
            fullName: dto.ownerName.trim(),
            companyName: dto.companyName.trim(),
            email,
            mobile,
            username: email,
            password: hashedPassword,
            role: 'seller',
            status: 'pending',
            profileCompleted: false,
            leadId: lead._id,
            onboardingUserStatus: 'PENDING_PAYMENT',
            isEmailVerified: false,
            registrationSource: dto.source?.trim() || 'self_service_trial',
          },
        ],
        { session },
      );
      user = createdUsers[0];

      lead.userId = user._id;
      this.stateMachine.assertTransition('REGISTERED', 'PAYMENT_PENDING');
      lead.onboardingStatus = 'PAYMENT_PENDING';
      await lead.save({ session });

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }

    await this.timeline.record({
      leadId: lead._id,
      userId: user._id,
      eventType: ONBOARDING_TIMELINE_EVENTS.REGISTRATION_COMPLETED,
      message: 'Registration completed. Payment pending.',
    });

    const payment = await this.paymentService.createPaymentAttempt({
      leadId: String(lead._id),
      userId: String(user._id),
      email,
      mobile,
      fullName: dto.ownerName.trim(),
    });

    return {
      success: true,
      scenario: 'NEW_REGISTRATION',
      data: {
        leadId: String(lead._id),
        userId: String(user._id),
        leadNumber,
        orderId: payment.order_id,
        payment_session_id: payment.payment_session_id,
        totalAmount: payment.total_amount,
        pricing: payment.pricing,
        redirectPath: '/onboarding/payment',
      },
      message: 'Registration successful. Complete payment to activate your trial.',
    };
  }

  private async handleExistingUser(user: UserDocument) {
    if (user.onboardingUserStatus === 'ACTIVE' && user.sellerId) {
      throw new ConflictException({
        success: false,
        errorCode: 'ACCOUNT_EXISTS',
        message: 'An account already exists with this email. Please login.',
        scenario: 'LOGIN_REQUIRED',
      });
    }

    if (user.onboardingUserStatus === 'PENDING_PAYMENT') {
      const lead = user.leadId
        ? await this.leadModel.findById(user.leadId).exec()
        : null;
      return {
        success: true,
        scenario: 'WELCOME_BACK',
        data: {
          leadId: lead ? String(lead._id) : undefined,
          userId: String(user._id),
          leadNumber: lead?.leadNumber,
          status: lead?.onboardingStatus ?? 'PAYMENT_PENDING',
          message:
            'Your registration has already been completed. Your payment is still pending.',
          actions: ['CONTINUE_PAYMENT', 'FORGOT_PASSWORD'],
        },
      };
    }

    throw new ConflictException({
      success: false,
      errorCode: 'ACCOUNT_EXISTS',
      message: 'An account already exists with this email. Please login.',
    });
  }

  private async assertIdentityAvailable(input: {
    email: string;
    mobile: string;
    panNumber: string;
    gstNumber: string;
  }) {
    const seller = await this.sellerModel
      .findOne({
        $or: [
          { email: input.email },
          { contactNumber: input.mobile },
          { panNumber: input.panNumber },
          { gstNumber: input.gstNumber },
        ],
      })
      .lean()
      .exec();
    if (seller) {
      if (seller.isTrial && seller.trialStatus === 'pending_payment') {
        throw new ConflictException({
          success: false,
          errorCode: 'PENDING_PAYMENT_LEGACY',
          message:
            'A registration with these details is pending payment. Please login or contact support.',
        });
      }
      throw new ConflictException(
        'An account already exists with this email, mobile, PAN, or GST.',
      );
    }
  }

  async resumePayment(userId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.onboardingUserStatus !== 'PENDING_PAYMENT') {
      throw new BadRequestException('No pending payment for this account');
    }
    const lead = user.leadId
      ? await this.leadModel.findById(user.leadId).exec()
      : null;
    if (!lead) {
      throw new BadRequestException('Lead record not found');
    }

    const payment = await this.paymentService.createPaymentAttempt({
      leadId: String(lead._id),
      userId: String(user._id),
      email: user.email,
      mobile: user.mobile ?? '',
      fullName: user.fullName,
    });

    return {
      success: true,
      data: {
        orderId: payment.order_id,
        payment_session_id: payment.payment_session_id,
        totalAmount: payment.total_amount,
        attemptNumber: payment.attemptNumber,
        pricing: payment.pricing,
      },
    };
  }

  async confirmPayment(userId: string, orderId: string) {
    await this.paymentService.getOrderForUser(orderId, userId);
    return { orderId, userId };
  }

  async getStatus(userId: string) {
    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) {
      throw new BadRequestException('User not found');
    }
    const lead = user.leadId
      ? await this.leadModel.findById(user.leadId).lean().exec()
      : null;
    return {
      userId: String(user._id),
      sellerId: user.sellerId ? String(user.sellerId) : null,
      onboardingUserStatus: user.onboardingUserStatus,
      leadStatus: lead?.onboardingStatus,
      leadNumber: lead?.leadNumber,
      canAccessDashboard: user.onboardingUserStatus === 'ACTIVE',
      needsPayment: user.onboardingUserStatus === 'PENDING_PAYMENT',
    };
  }
}
