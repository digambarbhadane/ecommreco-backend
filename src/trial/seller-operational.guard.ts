import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { TrialValidationService } from './trial-validation.service';
import { SKIP_OPERATIONAL_CHECK_KEY } from './skip-operational-check.decorator';

type RequestUser = {
  role?: string;
  id?: string;
  sub?: string;
  sellerId?: string;
};

type RequestWithUser = Request & {
  user?: RequestUser;
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const EXEMPT_PATH_PREFIXES = [
  '/api/v1/trial',
  '/api/v1/onboarding',
  '/api/v1/payments',
  '/api/v1/auth',
  '/api/v1/billing',
  '/api/v1/health',
];

@Injectable()
export class SellerOperationalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly trialValidation: TrialValidationService,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_OPERATIONAL_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user || user.role !== 'seller') {
      return true;
    }

    const method = String(request.method ?? 'GET').toUpperCase();
    if (!MUTATING_METHODS.has(method)) {
      return true;
    }

    const path = String(request.path ?? request.url ?? '').split('?')[0];
    if (EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return true;
    }

    const sellerId = String(
      user.sellerId ?? user.sub ?? user.id ?? '',
    ).trim();
    if (!sellerId) {
      return true;
    }

    const seller = await this.sellerModel
      .findById(sellerId)
      .select(
        'isTrial trialStatus trialEnd convertedToPaid subscriptionEndsAt paymentStatus',
      )
      .lean()
      .exec();
    if (!seller) {
      return true;
    }

    this.trialValidation.assertSellerOperationalAccess(seller);
    return true;
  }
}
