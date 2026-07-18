import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import {
  TrialSubscription,
  TrialSubscriptionDocument,
} from './schemas/trial-subscription.schema';
import {
  extractPanFromGstin,
  getTrialAllowedReportMonths,
} from './trial.constants';

@Injectable()
export class TrialValidationService {
  constructor(
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(TrialSubscription.name)
    private readonly trialModel: Model<TrialSubscriptionDocument>,
  ) {}

  async assertEligibleForTrial(input: {
    email: string;
    mobile: string;
    panNumber: string;
    gstNumber: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const mobile = input.mobile.trim();
    const panNumber = input.panNumber.trim().toUpperCase();
    const gstNumber = input.gstNumber.trim().toUpperCase();
    const panFromGst = extractPanFromGstin(gstNumber);

    if (panFromGst && panFromGst !== panNumber) {
      throw new BadRequestException(
        'PAN number does not match the PAN embedded in GSTIN.',
      );
    }

    const existingTrialByPan = await this.trialModel
      .findOne({ panNumber })
      .lean()
      .exec();
    if (existingTrialByPan) {
      throw new ConflictException(
        'This PAN has already used the Trial and cannot register again.',
      );
    }

    const existingTrialByGst = await this.trialModel
      .findOne({ gstNumber })
      .lean()
      .exec();
    if (existingTrialByGst) {
      throw new ConflictException(
        'This GST has already used the Trial and cannot register again.',
      );
    }

    // Catch sellers whose trial row might be missing but identity remains
    // after data cleanup (GST/PAN must never get a second trial).
    const priorTrialSeller = await this.sellerModel
      .findOne({
        isTrial: true,
        $or: [{ panNumber }, { gstNumber }],
      })
      .lean()
      .exec();
    if (priorTrialSeller) {
      throw new ConflictException(
        'This PAN/GST has already used the Trial and cannot register again.',
      );
    }

    const sellerByIdentity = await this.sellerModel
      .findOne({
        $or: [
          { email: { $regex: `^${this.escape(email)}$`, $options: 'i' } },
          { contactNumber: mobile },
          { gstNumber },
          { panNumber },
        ],
      })
      .lean()
      .exec();

    if (sellerByIdentity) {
      if (
        String(sellerByIdentity.panNumber ?? '').toUpperCase() === panNumber ||
        extractPanFromGstin(String(sellerByIdentity.gstNumber ?? '')) ===
          panNumber
      ) {
        throw new ConflictException(
          'This PAN has already used the Trial and cannot register again.',
        );
      }
      if (
        String(sellerByIdentity.gstNumber ?? '').toUpperCase() === gstNumber
      ) {
        throw new ConflictException(
          'This GST has already used the Trial and cannot register again.',
        );
      }
      throw new ConflictException(
        'An account already exists with this email or mobile number.',
      );
    }
  }

  async getActiveTrialSeller(sellerId: string) {
    return this.sellerModel
      .findById(sellerId)
      .lean()
      .exec()
      .then((seller) => {
        if (!seller?.isTrial) return null;
        return seller;
      });
  }

  assertTrialGstLimit(seller: {
    isTrial?: boolean;
    trialStatus?: string;
    gstSlotsUsed?: number;
  }) {
    if (!seller.isTrial || seller.trialStatus === 'converted') return;
    if (Number(seller.gstSlotsUsed ?? 0) >= 1) {
      throw new BadRequestException(
        'Upgrade Subscription. Trial allows only one GST.',
      );
    }
  }

  assertTrialImportMonth(
    seller: {
      isTrial?: boolean;
      trialStatus?: string;
      trialStart?: Date | string;
      createdAt?: Date | string;
      convertedToPaid?: boolean;
      reconciliationMonths?: string[];
    },
    reportMonth?: string,
  ) {
    const month = String(reportMonth ?? '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('reportMonth must be YYYY-MM');
    }

    const purchasedMonths = Array.isArray(seller.reconciliationMonths)
      ? seller.reconciliationMonths.map((item) => String(item).trim())
      : [];

    // Paid / converted sellers: only purchased reconciliation months.
    if (
      seller.trialStatus === 'converted' ||
      seller.convertedToPaid ||
      (!seller.isTrial && purchasedMonths.length > 0)
    ) {
      if (purchasedMonths.length > 0 && !purchasedMonths.includes(month)) {
        throw new BadRequestException(
          'You can only upload reports for months included in your subscription.',
        );
      }
      return;
    }

    if (!seller.isTrial) return;

    if (seller.trialStatus !== 'active') {
      throw new BadRequestException(
        'Trial is not active. Please purchase a subscription to continue imports.',
      );
    }
    const reference = new Date(
      seller.trialStart ?? seller.createdAt ?? Date.now(),
    );
    const allowed = getTrialAllowedReportMonths(reference);
    if (!allowed.includes(month)) {
      throw new BadRequestException(
        'You can upload reports only for the last 3 months during Trial.',
      );
    }
  }

  assertTrialApiAccess(seller: {
    isTrial?: boolean;
    trialStatus?: string;
    trialEnd?: Date | string;
  }) {
    if (!seller.isTrial || seller.trialStatus === 'converted') return 'full';
    if (seller.trialStatus === 'active') {
      const end = seller.trialEnd ? new Date(seller.trialEnd) : null;
      if (end && end.getTime() < Date.now()) return 'expired';
      return 'trial';
    }
    if (seller.trialStatus === 'expired' || seller.trialStatus === 'data_deleted') {
      return 'expired';
    }
    if (seller.trialStatus === 'pending_payment') return 'pending_payment';
    if (seller.trialStatus === 'suspended') return 'suspended';
    return 'full';
  }

  private escape(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
