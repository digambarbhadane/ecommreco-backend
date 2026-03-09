import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { Model } from 'mongoose';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { VerifyGstinDto } from './dto/verify-gstin.dto';
import {
  GstinVerification,
  GstinVerificationDocument,
} from './schemas/gstin-verification.schema';
import { Gst, GstDocument } from '../gsts/schemas/gst.schema';
type CashfreePayload = {
  GSTIN: string;
  business_name?: string;
};

type CashfreeData = {
  GSTIN?: string;
  valid?: boolean;
  legal_name_of_business?: string;
  trade_name_of_business?: string;
  gst_in_status?: string;
  constitution_of_business?: string;
  taxpayer_type?: string;
  date_of_registration?: string;
  principal_place_address?: string;
  nature_of_business_activities?: string[];
  last_update_date?: string;
};

type CashfreeResponse = Record<string, unknown> & {
  data?: CashfreeData;
};
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[0-9A-Z]{1}$/;

@Injectable()
export class GstinVerificationService {
  private readonly logger = new Logger(GstinVerificationService.name);

  constructor(
    @InjectModel(GstinVerification.name)
    private readonly gstinModel: Model<GstinVerificationDocument>,
    @InjectModel(Gst.name)
    private readonly gstModel: Model<GstDocument>,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async verify(dto: VerifyGstinDto, sellerId?: string) {
    const gstin = dto.gstin.toUpperCase();
    if (!GSTIN_REGEX.test(gstin)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid GSTIN',
        errorCode: 'INVALID_GST',
      });
    }
    const cacheThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const cached = await this.gstinModel
      .findOne({ gstin, lastVerifiedAt: { $gte: cacheThreshold } })
      .lean();
    if (cached) {
      return this.buildSuccess(cached);
    }

    const clientId = this.config.get<string>('CASHFREE_CLIENT_ID')?.trim();
    const clientSecret =
      this.config.get<string>('CASHFREE_CLIENT_SECRET')?.trim() ??
      this.config.get<string>('CASHFREE_CLIENT_SECRET_ID')?.trim();
    if (!clientId || !clientSecret) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          'Cashfree credentials missing in dev mode. Using mock response.',
        );
        return {
          success: true,
          data: {
            gstin: gstin,
            valid: true,
            legalName: dto.businessName || 'Mock Legal Name',
            tradeName: 'Mock Trade Name',
            status: 'Active',
            taxpayerType: 'Regular',
            constitution: 'Private Limited Company',
            registrationDate: new Date().toISOString(),
            principalAddress: 'Mock Address, City, State - 000000',
            natureOfBusinessActivities: ['Retail'],
            lastUpdateDate: new Date().toISOString(),
            lastVerifiedAt: new Date().toISOString(),
          },
        };
      }
      throw new UnauthorizedException({
        success: false,
        message: 'Cashfree credentials are not configured',
        errorCode: 'INVALID_CREDENTIALS',
      });
    }
    const baseUrl = this.resolveBaseUrl(
      this.config.get<string>('CASHFREE_BASE_URL'),
      clientSecret,
    );
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

    const payload: CashfreePayload = {
      GSTIN: gstin,
      business_name: dto.businessName || undefined,
    };

    try {
      const urls = this.getCashfreeUrls(normalizedBaseUrl);
      let response: { data: unknown } | undefined;
      let lastError: unknown;
      for (const url of urls) {
        try {
          response = await lastValueFrom(
            this.httpService
              .post<unknown>(url, payload, {
                headers: {
                  'x-client-id': clientId,
                  'x-client-secret': clientSecret,
                  'Content-Type': 'application/json',
                },
              })
              .pipe(timeout(8000)),
          );
          lastError = undefined;
          break;
        } catch (error: unknown) {
          lastError = error;
          if (
            this.isAxiosError(error) &&
            error.response?.status === 404 &&
            url !== urls[urls.length - 1]
          ) {
            continue;
          }
          throw error;
        }
      }
      if (!response) {
        if (lastError instanceof Error) {
          throw lastError;
        }
        throw new Error('Cashfree endpoint not found');
      }

      const { raw, data } = this.normalizeResponse(response.data);

      const update = {
        gstin: data.GSTIN ?? gstin,
        valid: Boolean(data.valid),
        legalName: data.legal_name_of_business ?? null,
        tradeName: data.trade_name_of_business ?? null,
        status: data.gst_in_status ?? null,
        taxpayerType: data.taxpayer_type ?? null,
        constitution: data.constitution_of_business ?? null,
        registrationDate:
          typeof data.date_of_registration === 'string'
            ? new Date(data.date_of_registration)
            : null,
        principalAddress: data.principal_place_address ?? null,
        natureOfBusinessActivities: Array.isArray(
          data.nature_of_business_activities,
        )
          ? data.nature_of_business_activities.filter(
              (item) => typeof item === 'string',
            )
          : null,
        lastUpdateDate:
          typeof data.last_update_date === 'string'
            ? new Date(data.last_update_date)
            : null,
        lastVerifiedAt: new Date(),
        rawResponse: raw,
        sellerId: sellerId ?? null,
      };

      const saved = await this.gstinModel.findOneAndUpdate(
        { gstin },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      if (sellerId && update.valid) {
        await this.gstModel.findOneAndUpdate(
          { sellerId, gstNumber: update.gstin },
          {
            $set: {
              sellerId,
              gstNumber: update.gstin,
              status: 'active',
              gstinVerificationId: saved?._id?.toString(),
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        );
      }

      return this.buildSuccess(saved);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'GST verification failed';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(message, stack);
      if (this.isAxiosError(error) && error.response) {
        const status = error.response.status;
        const apiMessage = this.getCashfreeMessage(error.response.data);
        const apiCode = this.getCashfreeCode(error.response.data);
        if (status === 400) {
          throw new BadRequestException({
            success: false,
            message: apiMessage ?? 'Invalid GSTIN',
            errorCode: apiCode ?? 'INVALID_GST',
          });
        }
        if (status === 401 || status === 403) {
          throw new UnauthorizedException({
            success: false,
            message: apiMessage ?? 'Invalid Cashfree credentials',
            errorCode: apiCode ?? 'INVALID_CREDENTIALS',
          });
        }
        if (status === 429) {
          throw new HttpException(
            {
              success: false,
              message: apiMessage ?? 'Rate limit exceeded',
              errorCode: apiCode ?? 'RATE_LIMIT',
            },
            429,
          );
        }
        if (status === 404) {
          const requestUrl =
            typeof error.config?.url === 'string'
              ? error.config.url
              : undefined;
          throw new HttpException(
            {
              success: false,
              message: `Cashfree endpoint not found${
                requestUrl ? `: ${requestUrl}` : ''
              }. Check base URL and API access.`,
              errorCode: apiCode ?? 'CASHFREE_ENDPOINT_NOT_FOUND',
            },
            502,
          );
        }
        throw new HttpException(
          {
            success: false,
            message: apiMessage ?? 'Cashfree API error',
            errorCode: apiCode ?? 'CASHFREE_ERROR',
          },
          status,
        );
      }
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new HttpException(
          {
            success: false,
            message: 'Cashfree API timeout',
            errorCode: 'TIMEOUT',
          },
          504,
        );
      }
      throw new HttpException(
        {
          success: false,
          message: 'Network error',
          errorCode: 'NETWORK_ERROR',
        },
        502,
      );
    }
  }

  private buildSuccess(record: Partial<GstinVerification>) {
    return {
      success: true,
      data: {
        gstin: record.gstin,
        valid: record.valid,
        legalName: record.legalName ?? null,
        tradeName: record.tradeName ?? null,
        status: record.status ?? null,
        taxpayerType: record.taxpayerType ?? null,
        constitution: record.constitution ?? null,
        registrationDate: record.registrationDate ?? null,
        principalAddress: record.principalAddress ?? null,
        natureOfBusinessActivities: record.natureOfBusinessActivities ?? null,
        lastUpdateDate: record.lastUpdateDate ?? null,
        lastVerifiedAt: record.lastVerifiedAt ?? null,
      },
    };
  }

  async getLatestRecord(gstin: string, sellerId?: string) {
    const filter: Record<string, unknown> = { gstin };
    if (sellerId) {
      filter.sellerId = sellerId;
    }
    return this.gstinModel.findOne(filter).sort({ lastVerifiedAt: -1 });
  }

  private normalizeResponse(rawInput: unknown) {
    if (rawInput && typeof rawInput === 'object') {
      const raw = rawInput as CashfreeResponse;
      const dataCandidate = raw.data;
      if (dataCandidate && typeof dataCandidate === 'object') {
        return { raw, data: dataCandidate };
      }
      return { raw, data: raw as CashfreeData };
    }
    return {
      raw: { value: rawInput } as Record<string, unknown>,
      data: {} as CashfreeData,
    };
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return Boolean(
      error && typeof error === 'object' && 'isAxiosError' in error,
    );
  }

  private resolveBaseUrl(
    configuredBaseUrl: string | undefined,
    clientSecret: string,
  ) {
    const normalizedConfigured = configuredBaseUrl?.trim().replace(/\/$/, '');
    const secret = clientSecret.toLowerCase();
    const isProdSecret = secret.includes('_prod_');

    if (normalizedConfigured) {
      return normalizedConfigured;
    }

    if (isProdSecret) {
      return 'https://api.cashfree.com';
    }
    return 'https://sandbox.cashfree.com';
  }

  private getCashfreeUrls(normalizedBaseUrl: string) {
    const base = normalizedBaseUrl.replace(/\/$/, '');
    const urls = new Set<string>();
    const addUrl = (url: string) => {
      const trimmed = url.replace(/\/$/, '');
      urls.add(trimmed);
    };
    const addVerificationUrl = (root: string) =>
      addUrl(`${root.replace(/\/$/, '')}/verification/gstin`);

    if (
      base.endsWith('/verification/gstin') ||
      base.includes('/verification/gstin')
    ) {
      addUrl(base);
    } else if (base.endsWith('/verification')) {
      addUrl(`${base}/gstin`);
    } else {
      addVerificationUrl(base);
    }

    return Array.from(urls);
  }

  private getCashfreeMessage(data: unknown) {
    if (!data || typeof data !== 'object') {
      return undefined;
    }
    const candidate = data as Record<string, unknown>;
    const message =
      candidate.message ?? candidate.error ?? candidate.reason ?? candidate.msg;
    return typeof message === 'string' && message.trim().length > 0
      ? message
      : undefined;
  }

  private getCashfreeCode(data: unknown) {
    if (!data || typeof data !== 'object') {
      return undefined;
    }
    const candidate = data as Record<string, unknown>;
    const code =
      candidate.code ?? candidate.error_code ?? candidate.errorCode ?? null;
    return typeof code === 'string' && code.trim().length > 0
      ? code
      : undefined;
  }
}
