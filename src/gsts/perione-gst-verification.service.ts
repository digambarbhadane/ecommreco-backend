import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { AxiosError } from 'axios';
import { Model } from 'mongoose';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import {
  GstinVerification,
  GstinVerificationDocument,
} from '../gstin-verification/schemas/gstin-verification.schema';
import {
  isActiveGstStatus,
  isValidGstinFormat,
  normalizeGstin,
  parsePerioneRegistrationDate,
} from './gst-verification.constants';

export type VerifiedGstPreview = {
  verificationId: string;
  gstNumber: string;
  businessName: string;
  tradeName: string;
  state: string;
  status: string;
  taxpayerType: string;
  registrationDate: string;
  address: string;
  verifiedAt: string;
};

type PerioneRecord = Record<string, unknown>;

@Injectable()
export class PerioneGstVerificationService {
  private readonly logger = new Logger(PerioneGstVerificationService.name);

  constructor(
    @InjectModel(GstinVerification.name)
    private readonly verificationModel: Model<GstinVerificationDocument>,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async verifyGstNumber(gstNumber: string, sellerId?: string) {
    try {
      const gstin = normalizeGstin(gstNumber);
      if (!isValidGstinFormat(gstin)) {
        throw new BadRequestException({
          success: false,
          message: 'Please enter a valid GST number.',
          errorCode: 'INVALID_GST_FORMAT',
        });
      }

      const credentials = this.getCredentials();
      const raw = await this.callPerioneApi(gstin, credentials);
      const parsed = this.parsePerioneResponse(raw, gstin);

      if (!parsed.found) {
        throw new BadRequestException({
          success: false,
          message:
            'GST number not found. Please verify the GST number and try again.',
          errorCode: 'GST_NOT_FOUND',
        });
      }

      if (!isActiveGstStatus(parsed.status)) {
        throw new BadRequestException({
          success: false,
          message:
            'GST found but status is inactive. Only active GST registrations can be added.',
          errorCode: 'GST_INACTIVE',
          data: this.toPreviewPayload(parsed, ''),
        });
      }

      const verifiedAt = new Date();
      const update: Record<string, unknown> = {
        gstin,
        valid: true,
        legalName: parsed.businessName,
        tradeName: parsed.tradeName,
        status: parsed.status,
        taxpayerType: parsed.taxpayerType,
        principalAddress: parsed.address,
        lastVerifiedAt: verifiedAt,
        rawResponse: this.sanitizeRawResponse(raw),
        sellerId: sellerId ?? null,
      };
      if (parsed.registrationDate) {
        const registrationDate = parsePerioneRegistrationDate(
          parsed.registrationDate,
        );
        if (registrationDate) {
          update.registrationDate = registrationDate;
        }
      }

      const saved = await this.verificationModel.findOneAndUpdate(
        { gstin },
        { $set: update },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
      );

      if (!saved) {
        throw new ServiceUnavailableException({
          success: false,
          message:
            'Unable to save GST verification result. Please try again.',
          errorCode: 'VERIFICATION_SAVE_FAILED',
        });
      }

      const verificationId = String(saved._id);
      return {
        success: true,
        data: this.toPreviewPayload(parsed, verificationId, verifiedAt),
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const detail =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      this.logger.error(
        `Unexpected GST verification failure for ${gstNumber}: ${detail}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException({
        success: false,
        message:
          'Unable to verify GST number right now. Please try again in a moment.',
        errorCode: 'VERIFICATION_FAILED',
      });
    }
  }

  async getRecentVerification(verificationId: string, gstNumber?: string) {
    const record = await this.verificationModel.findById(verificationId).lean();
    if (!record || !record.valid) {
      throw new BadRequestException({
        success: false,
        message: 'GST verification expired. Please verify the GST number again.',
        errorCode: 'VERIFICATION_NOT_FOUND',
      });
    }

    const expectedGst = normalizeGstin(gstNumber ?? record.gstin);
    if (normalizeGstin(record.gstin) !== expectedGst) {
      throw new BadRequestException({
        success: false,
        message: 'Verification does not match the GST number provided.',
        errorCode: 'VERIFICATION_MISMATCH',
      });
    }

    const verifiedAt = record.lastVerifiedAt
      ? new Date(record.lastVerifiedAt)
      : null;
    if (
      !verifiedAt ||
      Date.now() - verifiedAt.getTime() > 30 * 60 * 1000
    ) {
      throw new BadRequestException({
        success: false,
        message: 'GST verification expired. Please verify the GST number again.',
        errorCode: 'VERIFICATION_EXPIRED',
      });
    }

    if (!isActiveGstStatus(record.status)) {
      throw new BadRequestException({
        success: false,
        message:
          'GST found but status is inactive. Only active GST registrations can be added.',
        errorCode: 'GST_INACTIVE',
      });
    }

    return record;
  }

  async getVerificationBusinessProfile(
    verificationId: string,
    gstNumber: string,
  ) {
    const record = await this.getRecentVerification(verificationId, gstNumber);
    const gstin = normalizeGstin(record.gstin);
    const panNumber = gstin.length >= 12 ? gstin.slice(2, 12) : '';
    const state = this.readStateFromRaw(record.rawResponse as PerioneRecord);

    return {
      gstNumber: gstin,
      panNumber,
      businessName: String(record.legalName ?? record.tradeName ?? '').trim(),
      tradeName: String(record.tradeName ?? record.legalName ?? '').trim(),
      state,
      address: String(record.principalAddress ?? '').trim(),
      businessType: String(
        record.constitution ?? record.taxpayerType ?? '',
      ).trim(),
      taxpayerType: String(record.taxpayerType ?? '').trim(),
    };
  }

  private readStateFromRaw(raw?: PerioneRecord | null): string {
    if (!raw) {
      return '';
    }
    return (
      this.readString(raw, ['stj', 'state', 'state_name', 'stateName']) || ''
    );
  }

  private getCredentials() {
    const email = this.config.get<string>('GST_VERIFICATION_EMAIL')?.trim();
    const clientId = this.config
      .get<string>('GST_VERIFICATION_CLIENT_ID')
      ?.trim();
    const clientSecret = this.config
      .get<string>('GST_VERIFICATION_CLIENT_SECRET')
      ?.trim();
    const apiUrl =
      this.config.get<string>('GST_VERIFICATION_API_URL')?.trim() ||
      'https://api.perione.in/public/search';
    const env =
      this.config.get<string>('GST_VERIFICATION_ENV')?.trim() || 'production';

    if (!email || !clientId || !clientSecret) {
      throw new ServiceUnavailableException({
        success: false,
        message: 'GST verification service is not configured.',
        errorCode: 'GST_VERIFICATION_NOT_CONFIGURED',
      });
    }

    return { email, clientId, clientSecret, apiUrl, env };
  }

  private async callPerioneApi(
    gstin: string,
    credentials: {
      email: string;
      clientId: string;
      clientSecret: string;
      apiUrl: string;
      env: string;
    },
  ) {
    try {
      const response = await lastValueFrom(
        this.httpService
          .get<unknown>(credentials.apiUrl, {
            params: {
              email: credentials.email,
              gstin,
            },
            headers: {
              accept: '*/*',
              client_id: credentials.clientId,
              client_secret: credentials.clientSecret,
              env: credentials.env,
            },
            timeout: 15000,
          })
          .pipe(timeout(15000)),
      );
      return response.data;
    } catch (error: unknown) {
      const apiDetail = this.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : String(error);
      this.logger.error(
        `Perione GST verification failed for ${gstin}: ${apiDetail}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new HttpException(
          {
            success: false,
            message:
              'GST verification timed out. Please try again in a moment.',
            errorCode: 'VERIFICATION_TIMEOUT',
          },
          504,
        );
      }
      if (this.isAxiosError(error)) {
        const status = error.response?.status ?? 502;
        const apiMessage = this.readPerioneErrorMessage(error.response?.data);
        if (status === 404) {
          throw new BadRequestException({
            success: false,
            message:
              'GST number not found. Please verify the GST number and try again.',
            errorCode: 'GST_NOT_FOUND',
          });
        }
        if (status >= 500) {
          throw new ServiceUnavailableException({
            success: false,
            message:
              'GST verification service is temporarily unavailable. Please try again later.',
            errorCode: 'VERIFICATION_UNAVAILABLE',
          });
        }
        throw new HttpException(
          {
            success: false,
            message:
              apiMessage ||
              'Unable to verify GST number right now. Please try again.',
            errorCode: 'VERIFICATION_FAILED',
          },
          status,
        );
      }
      throw new ServiceUnavailableException({
        success: false,
        message: 'Network error while verifying GST. Please try again.',
        errorCode: 'NETWORK_ERROR',
      });
    }
  }

  private parsePerioneResponse(raw: unknown, gstin: string) {
    const root =
      raw && typeof raw === 'object' ? (raw as PerioneRecord) : ({} as PerioneRecord);
    const statusCd = String(root.status_cd ?? root.statusCd ?? '').trim();

    if (statusCd && statusCd !== '1' && statusCd.toLowerCase() !== 'success') {
      const rootMessage = this.readApiMessage(root);
      if (
        rootMessage.toLowerCase().includes('not found') ||
        rootMessage.toLowerCase().includes('invalid gstin') ||
        statusCd === '0'
      ) {
        return this.emptyParseResult(gstin, false);
      }
    }

    const payload = this.unwrapPayload(raw);
    const record = this.pickRecord(payload, gstin);

    const gstNumber = this.readString(record, [
      'gstin',
      'GSTIN',
      'gst_number',
      'gstNumber',
    ]) || gstin;
    const businessName = this.readString(record, [
      'lgnm',
      'legal_name',
      'legalName',
      'business_name',
      'businessName',
      'legal_name_of_business',
    ]);
    const tradeName = this.readString(record, [
      'trdnm',
      'tradeNam',
      'trade_name',
      'tradeName',
      'trade_name_of_business',
    ]);
    const status = this.readString(record, [
      'sts',
      'status',
      'gst_in_status',
      'gstin_status',
    ]);
    const state =
      this.readString(record, ['stj', 'state', 'state_name', 'stateName']) ||
      this.readStateFromPradr(record);
    const taxpayerType = this.readString(record, [
      'taxpayer_type',
      'taxpayerType',
      'dty',
      'constitution_of_business',
      'ctb',
    ]);
    const registrationDate = this.readString(record, [
      'registration_date',
      'registrationDate',
      'date_of_registration',
      'rgdt',
    ]);
    const address = this.readAddress(record);

    const explicitNotFound =
      this.readBoolean(record, ['found', 'exists', 'valid']) === false ||
      this.readApiMessage(root).toLowerCase().includes('not found');

    const found =
      !explicitNotFound &&
      (statusCd === '1' ||
        statusCd.toLowerCase() === 'success' ||
        Boolean(businessName || tradeName || address)) &&
      Boolean(gstNumber);

    return {
      found,
      gstNumber,
      businessName: businessName || tradeName || '',
      tradeName: tradeName || businessName || '',
      status: status || (found ? 'Active' : ''),
      state,
      taxpayerType: taxpayerType || '',
      registrationDate: registrationDate || '',
      address,
    };
  }

  private emptyParseResult(gstin: string, found: boolean) {
    return {
      found,
      gstNumber: gstin,
      businessName: '',
      tradeName: '',
      status: '',
      state: '',
      taxpayerType: '',
      registrationDate: '',
      address: '',
    };
  }

  private unwrapPayload(raw: unknown): PerioneRecord {
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    const root = raw as PerioneRecord;
    const nested = root.data ?? root.result ?? root.response ?? root.taxpayer;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as PerioneRecord;
    }
    return root;
  }

  private readStateFromPradr(record: PerioneRecord) {
    const pradr = record.pradr;
    if (!pradr || typeof pradr !== 'object' || Array.isArray(pradr)) {
      return '';
    }
    const pradrRecord = pradr as PerioneRecord;
    const addr = pradrRecord.addr ?? pradrRecord;
    if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
      return this.readString(addr as PerioneRecord, ['stcd', 'state', 'dst']);
    }
    return '';
  }

  private readApiMessage(record: PerioneRecord) {
    const direct = this.readString(record, [
      'message',
      'status_desc',
      'statusDesc',
      'error_message',
    ]);
    if (direct) return direct;

    const errorValue = record.error;
    if (typeof errorValue === 'string' && errorValue.trim()) {
      return errorValue.trim();
    }
    if (errorValue && typeof errorValue === 'object' && !Array.isArray(errorValue)) {
      return this.readString(errorValue as PerioneRecord, [
        'message',
        'error_message',
        'status_desc',
        'statusDesc',
      ]);
    }
    return '';
  }

  private readPerioneErrorMessage(data: unknown) {
    if (!data || typeof data !== 'object') return '';
    return this.readApiMessage(data as PerioneRecord);
  }

  private pickRecord(payload: PerioneRecord, gstin: string): PerioneRecord {
    if (Array.isArray(payload)) {
      const match = payload.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const record = item as PerioneRecord;
        const candidate = this.readString(record, ['gstin', 'GSTIN']);
        return candidate === gstin;
      });
      return (match as PerioneRecord) ?? {};
    }
    return payload;
  }

  private readAddress(record: PerioneRecord) {
    const direct = this.readString(record, [
      'address',
      'principal_place_address',
      'principalAddress',
      'principal_place_of_business',
    ]);
    if (direct) return direct;

    const pradr = record.pradr;
    if (pradr && typeof pradr === 'object' && !Array.isArray(pradr)) {
      const pradrRecord = pradr as PerioneRecord;
      const addr = pradrRecord.addr ?? pradrRecord;
      if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
        const addrRecord = addr as PerioneRecord;
        const parts = [
          this.readString(addrRecord, ['bnm', 'bno', 'st', 'loc', 'flno']),
          this.readString(addrRecord, ['dst', 'city', 'landmark']),
          this.readString(addrRecord, ['stcd', 'state']),
          this.readString(addrRecord, ['pncd', 'pincode']),
        ].filter(Boolean);
        if (parts.length > 0) return parts.join(', ');
      }
    }

    const addr = record.address;
    if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
      const parts = [
        this.readString(addr as PerioneRecord, ['bnm', 'bno', 'st', 'loc']),
        this.readString(addr as PerioneRecord, ['dst', 'city']),
        this.readString(addr as PerioneRecord, ['stcd', 'state']),
        this.readString(addr as PerioneRecord, ['pncd', 'pincode']),
      ].filter(Boolean);
      if (parts.length > 0) return parts.join(', ');
    }
    return '';
  }

  private readString(record: PerioneRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  }

  private readBoolean(record: PerioneRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'boolean') return value;
    }
    return undefined;
  }

  private sanitizeRawResponse(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object') {
      return { value: raw };
    }
    try {
      const clone = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
      for (const key of [
        'client_secret',
        'clientSecret',
        'client_id',
        'clientId',
      ]) {
        if (key in clone) {
          delete clone[key];
        }
      }
      return clone;
    } catch {
      return { serialized: false };
    }
  }

  private toPreviewPayload(
    parsed: {
      gstNumber: string;
      businessName: string;
      tradeName: string;
      status: string;
      state: string;
      taxpayerType: string;
      registrationDate: string;
      address: string;
    },
    verificationId: string,
    verifiedAt?: Date,
  ): VerifiedGstPreview {
    return {
      verificationId,
      gstNumber: parsed.gstNumber,
      businessName: parsed.businessName,
      tradeName: parsed.tradeName,
      state: parsed.state,
      status: parsed.status,
      taxpayerType: parsed.taxpayerType,
      registrationDate: parsed.registrationDate,
      address: parsed.address,
      verifiedAt: (verifiedAt ?? new Date()).toISOString(),
    };
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return Boolean(
      error && typeof error === 'object' && 'isAxiosError' in error,
    );
  }
}
