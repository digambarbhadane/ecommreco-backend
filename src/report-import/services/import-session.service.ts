import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UploadReportDto } from '../dto/upload-report.dto';
import type { MarketplaceUploadKey } from '../marketplace-upload.routes';
import { UploadService } from './upload.service';
import { ValidationService } from './validation.service';
import { ImportWorkflowService } from './import-workflow.service';

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
  myntra: [
    'gstrReportPackedFile',
    'salesRevenuePackedB2cFile',
    'gstrReportRtoFile',
    'gstrReportRtFile',
  ],
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
  myntra: ['mDirectOrdersReportFile', 'mDirectReturnsReportFile'],
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

  addFile(
    sessionId: string,
    sellerId: string,
    slot: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    const session = this.getSessionOrThrow(sessionId);
    if (String(session.sellerId) !== String(sellerId).trim()) {
      throw new BadRequestException('Invalid import session');
    }

    const allowed = [
      ...REQUIRED_SLOTS[session.marketplaceType],
      ...(OPTIONAL_SLOTS[session.marketplaceType] ?? []),
    ];
    if (!allowed.includes(slot)) {
      throw new BadRequestException(
        `Unknown file slot "${slot}". Expected one of: ${allowed.join(', ')}`,
      );
    }

    session.files.set(slot, {
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
      const hasPayment = session.files.has('paymentReportFile');
      const hasReturn = session.files.has('amazonReturnReportFile');
      if (hasPayment && (hasMtr || hasReturn)) {
        throw new BadRequestException(
          'Amazon Payment Report must be uploaded separately from MTR and return reports',
        );
      }
      const hasReturnOnly =
        hasReturn && !hasMtr;
      if (!hasMtr && !hasReturnOnly && !hasPayment) {
        throw new BadRequestException(
          'Amazon upload requires an MTR, return, or payment report file',
        );
      }
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

    const files = this.toMarketplaceFiles(session);
    this.sessions.delete(sessionId);

    return this.uploadService.uploadMarketplaceReport(
      session.marketplaceType,
      files,
      dto,
    );
  }

  private toMarketplaceFiles(session: ImportSession) {
    const out: Record<string, SessionFile> = {};
    for (const [slot, file] of session.files.entries()) {
      out[slot] = file;
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

