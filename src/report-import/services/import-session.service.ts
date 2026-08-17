import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AMAZON_MAX_PAYMENT_FILES,
  buildAmazonPaymentSlotKey,
} from '../utils/amazon-payment-upload.util';
import {
  isMyntraPaymentSlot,
  MYNTRA_PAYMENT_SLOTS,
} from '../utils/myntra-payment-upload.util';
import type { MarketplaceUploadKey } from '../marketplace-upload.routes';
import { UploadReportDto } from '../dto/upload-report.dto';
import { UploadService } from './upload.service';
import { ValidationService } from './validation.service';
import { ImportWorkflowService } from './import-workflow.service';
import { isPaymentUploadSlot } from '../utils/payment-upload-slot.util';

type SessionFile = { buffer: Buffer; originalname: string };

type ImportSession = {
  sellerId: string;
  gstId: string;
  marketplaceId: string;
  marketplaceType: MarketplaceUploadKey;
  files: Map<string, SessionFile>;
  createdAt: number;
};

const SESSION_TTL_MS = 60 * 60 * 1000;

const REQUIRED_SLOTS: Record<MarketplaceUploadKey, string[]> = {
  // Sales / return / payment-only rules are validated in commit() (like Amazon & Meesho).
  flipkart: [],
  amazon: [], // B2C is preferred but B2B-only is valid; checked in commit()
  meesho: [],
  myntra: [],
};

const OPTIONAL_SLOTS: Partial<Record<MarketplaceUploadKey, string[]>> = {
  flipkart: ['file', 'returnReportFile', 'paymentReportFile'],
  amazon: [
    'mtrB2cFile',
    'mtrB2bFile',
    'amazonReturnReportFile',
    'paymentReportFile',
  ],
  meesho: [
    'tcsSalesFile',
    'tcsSalesReturnFile',
    'orderReportFile',
    'returnInTransitReportFile',
    'returnOutForDeliveryReportFile',
    'returnDeliveryCompleteReportFile',
    'paymentReportFile',
  ],
  myntra: [
    'gstrReportPackedFile',
    'salesRevenuePackedB2cFile',
    'gstrReportRtoFile',
    'gstrReportRtFile',
    'mDirectOrdersReportFile',
    'mDirectReturnsReportFile',
    'pgForwardSettledFile',
    'pgReverseSettledFile',
  ],
};

const MEESHO_IMPORT_SLOTS = [
  'tcsSalesFile',
  'tcsSalesReturnFile',
  'orderReportFile',
  'returnInTransitReportFile',
  'returnOutForDeliveryReportFile',
  'returnDeliveryCompleteReportFile',
] as const;

@Injectable()
export class ImportSessionService {
  private readonly sessions = new Map<string, ImportSession>();

  constructor(
    private readonly validation: ValidationService,
    private readonly uploadService: UploadService,
    private readonly importWorkflow: ImportWorkflowService,
  ) {}

  async createSession(
    marketplaceType: MarketplaceUploadKey,
    dto: UploadReportDto,
  ) {
    const ctx = await this.validation.validateOwnership(dto);
    await this.validation.assertTrialImportAllowed(
      dto.sellerId,
      dto.reportMonth,
    );
    if (!ctx.marketplaceIdentifier.includes(marketplaceType)) {
      throw new BadRequestException(
        `Selected marketplace does not match ${marketplaceType} import.`,
      );
    }

    this.purgeExpiredSessions();

    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      sellerId: dto.sellerId,
      gstId: dto.gstId,
      marketplaceId: dto.marketplaceId,
      marketplaceType,
      files: new Map(),
      createdAt: Date.now(),
    });

    return {
      success: true,
      sessionId,
      requiredSlots: REQUIRED_SLOTS[marketplaceType],
      optionalSlots: OPTIONAL_SLOTS[marketplaceType] ?? [],
      message: 'Upload each report file separately, then commit.',
    };
  }

  async addFile(
    sessionId: string,
    sellerId: string,
    slot: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    const session = this.getSessionOrThrow(sessionId);
    if (String(session.sellerId) !== String(sellerId).trim()) {
      throw new BadRequestException('Invalid import session');
    }

    let slotKey = slot;
    if (session.marketplaceType === 'amazon' && slot === 'paymentReportFile') {
      const contentHash = this.validation.computeFileHash(file.buffer);
      slotKey = buildAmazonPaymentSlotKey(contentHash);
      const paymentCount = [...session.files.keys()].filter(
        (key) => key === 'paymentReportFile' || key.startsWith('amazonPaymentFile:'),
      ).length;
      if (!session.files.has(slotKey) && paymentCount >= AMAZON_MAX_PAYMENT_FILES) {
        throw new BadRequestException(
          `Amazon allows up to ${AMAZON_MAX_PAYMENT_FILES} payment report files per month`,
        );
      }
    }

    const allowed = [
      ...REQUIRED_SLOTS[session.marketplaceType],
      ...(OPTIONAL_SLOTS[session.marketplaceType] ?? []),
    ];
    if (
      !allowed.includes(slot) &&
      !slotKey.startsWith('amazonPaymentFile:')
    ) {
      throw new BadRequestException(
        `Unknown file slot "${slot}". Expected one of: ${allowed.join(', ')}`,
      );
    }

    if (isPaymentUploadSlot(slot) || isPaymentUploadSlot(slotKey)) {
      await this.validation.assertMainGstForPaymentUpload(
        session.gstId,
        session.sellerId,
      );
    }

    session.files.set(slotKey, {
      buffer: Buffer.from(file.buffer),
      originalname: file.originalname,
    });

    const required = REQUIRED_SLOTS[session.marketplaceType];

    return {
      success: true,
      sessionId,
      slot,
      receivedCount: session.files.size,
      requiredCount: required.length,
    };
  }

  async commit(sessionId: string, dto: UploadReportDto) {
    const session = this.getSessionOrThrow(sessionId);
    if (
      String(session.sellerId) !== String(dto.sellerId).trim() ||
      String(session.gstId) !== String(dto.gstId).trim() ||
      String(session.marketplaceId) !== String(dto.marketplaceId).trim()
    ) {
      throw new BadRequestException('Import session does not match request');
    }

    if (!dto.reportMonth) {
      throw new BadRequestException('reportMonth is required for marketplace imports');
    }

    const hasPaymentFile = [...session.files.keys()].some((key) =>
      isPaymentUploadSlot(key),
    );
    if (hasPaymentFile) {
      await this.validation.assertMainGstForPaymentUpload(
        session.gstId,
        session.sellerId,
      );
    }

    const required = REQUIRED_SLOTS[session.marketplaceType];
    const missing = required.filter((slot) => !session.files.has(slot));
    if (missing.length) {
      throw new BadRequestException(
        `Missing required report file(s): ${missing.join(', ')}`,
      );
    }

    if (session.marketplaceType === 'amazon') {
      if (session.files.size === 0) {
        throw new BadRequestException('Upload at least one Amazon report file');
      }
      const hasMtr =
        session.files.has('mtrB2cFile') || session.files.has('mtrB2bFile');
      const hasPayment = [...session.files.keys()].some(
        (key) => key === 'paymentReportFile' || key.startsWith('amazonPaymentFile:'),
      );
      const hasReturn = session.files.has('amazonReturnReportFile');
      if (!hasMtr && !hasReturn && !hasPayment) {
        throw new BadRequestException(
          'Amazon upload requires an MTR, return, or payment report file',
        );
      }
      const hasReturnOnly = hasReturn && !hasMtr;
      if (hasReturnOnly) {
        const b2cAlreadyUploaded = await this.importWorkflow.hasCompletedSlot({
          sellerId: dto.sellerId,
          gstId: dto.gstId,
          marketplaceId: dto.marketplaceId,
          reportMonth: dto.reportMonth,
          slot: 'mtrB2cFile',
        });
        const b2bAlreadyUploaded = await this.importWorkflow.hasCompletedSlot({
          sellerId: dto.sellerId,
          gstId: dto.gstId,
          marketplaceId: dto.marketplaceId,
          reportMonth: dto.reportMonth,
          slot: 'mtrB2bFile',
        });
        if (!b2cAlreadyUploaded && !b2bAlreadyUploaded) {
          throw new BadRequestException(
            'MTR B2C or B2B report is required before uploading the return report',
          );
        }
      }
    }

    if (session.marketplaceType === 'flipkart') {
      if (session.files.size === 0) {
        throw new BadRequestException('Upload at least one Flipkart report file');
      }
      const hasSales = session.files.has('file');
      const hasPaymentOnly =
        session.files.has('paymentReportFile') && !hasSales && !session.files.has('returnReportFile');
      const hasReturnOnly =
        session.files.has('returnReportFile') && !hasSales && !session.files.has('paymentReportFile');
      if ((hasPaymentOnly || hasReturnOnly) && !hasSales) {
        const salesAlreadyUploaded = await this.importWorkflow.hasCompletedSlot({
          sellerId: dto.sellerId,
          gstId: dto.gstId,
          marketplaceId: dto.marketplaceId,
          reportMonth: dto.reportMonth,
          slot: 'file',
        });
        if (!salesAlreadyUploaded) {
          throw new BadRequestException(
            'Sales Report is required before uploading the return or payment report',
          );
        }
      }
    }

    if (session.marketplaceType === 'meesho') {
      if (session.files.size === 0) {
        throw new BadRequestException('Upload at least one Meesho report file');
      }
      const hasImportFile = MEESHO_IMPORT_SLOTS.some((slot) =>
        session.files.has(slot),
      );
      const hasPaymentOnly =
        session.files.has('paymentReportFile') && !hasImportFile;
      if (!hasImportFile && !hasPaymentOnly) {
        throw new BadRequestException('Upload at least one Meesho report file');
      }
      if (hasImportFile && !session.files.has('tcsSalesFile')) {
        const tcsAlreadyUploaded = await this.importWorkflow.hasCompletedSlot({
          sellerId: dto.sellerId,
          gstId: dto.gstId,
          marketplaceId: dto.marketplaceId,
          reportMonth: dto.reportMonth,
          slot: 'tcsSalesFile',
        });
        if (!tcsAlreadyUploaded) {
          throw new BadRequestException(
            'TCS Sales Report is required when uploading sales or return reports',
          );
        }
      }
    }

    if (session.marketplaceType === 'myntra') {
      if (session.files.size === 0) {
        throw new BadRequestException('Upload at least one Myntra report file');
      }
      const MYNTRA_SALES_SLOTS = [
        'gstrReportPackedFile',
        'salesRevenuePackedB2cFile',
        'gstrReportRtoFile',
        'gstrReportRtFile',
        'mDirectOrdersReportFile',
        'mDirectReturnsReportFile',
      ] as const;
      const MYNTRA_REQUIRED_SALES_SLOTS = [
        'gstrReportPackedFile',
        'salesRevenuePackedB2cFile',
        'gstrReportRtoFile',
        'gstrReportRtFile',
      ] as const;
      const hasSalesInBatch = MYNTRA_SALES_SLOTS.some((slot) =>
        session.files.has(slot),
      );
      const hasPayment = MYNTRA_PAYMENT_SLOTS.some((slot) =>
        session.files.has(slot),
      );
      if (hasPayment && hasSalesInBatch) {
        throw new BadRequestException(
          'Myntra Payment Report must be uploaded separately from sales and return reports',
        );
      }
      if (hasPayment && !hasSalesInBatch) {
        for (const slot of MYNTRA_REQUIRED_SALES_SLOTS) {
          const alreadyUploaded = await this.importWorkflow.hasCompletedSlot({
            sellerId: dto.sellerId,
            gstId: dto.gstId,
            marketplaceId: dto.marketplaceId,
            reportMonth: dto.reportMonth,
            slot,
          });
          if (!alreadyUploaded) {
            throw new BadRequestException(
              'Upload all required Myntra sales and return reports before uploading the payment report',
            );
          }
        }
      }
      if (!hasPayment && !hasSalesInBatch) {
        throw new BadRequestException('Upload at least one Myntra report file');
      }
      if (hasSalesInBatch) {
        const missingRequired = MYNTRA_REQUIRED_SALES_SLOTS.filter(
          (slot) => !session.files.has(slot),
        );
        if (missingRequired.length) {
          for (const slot of missingRequired) {
            const alreadyUploaded = await this.importWorkflow.hasCompletedSlot({
              sellerId: dto.sellerId,
              gstId: dto.gstId,
              marketplaceId: dto.marketplaceId,
              reportMonth: dto.reportMonth,
              slot,
            });
            if (!alreadyUploaded) {
              throw new BadRequestException(
                'Myntra upload requires: GSTR Report Packed, Sales Revenue Packed B2C, GSTR Report RTO, and GSTR Report RT.',
              );
            }
          }
        }
      }
    }

    const files = this.toMarketplaceFiles(session);
    this.sessions.delete(sessionId);

    return this.uploadService.uploadMarketplaceReport(
      session.marketplaceType,
      files,
      dto,
    );
  }

  private toMarketplaceFiles(session: ImportSession) {
    const out: Record<string, SessionFile | SessionFile[]> = {};
    const paymentReportFiles: SessionFile[] = [];
    for (const [slot, file] of session.files.entries()) {
      if (slot === 'paymentReportFile' || slot.startsWith('amazonPaymentFile:')) {
        paymentReportFiles.push(file);
        continue;
      }
      out[slot] = file;
    }
    if (paymentReportFiles.length) {
      out.paymentReportFiles = paymentReportFiles;
      out.paymentReportFile = paymentReportFiles[0];
    }
    return out;
  }

  private getSessionOrThrow(sessionId: string): ImportSession {
    this.purgeExpiredSessions();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException('Import session not found or expired');
    }
    return session;
  }

  private purgeExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}

