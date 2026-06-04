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
  flipkart: ['file'],
  amazon: ['mtrB2cFile'],
  meesho: [
    'tcsSalesFile',
    'tcsSalesReturnFile',
    'orderReportFile',
    'returnReportFile',
  ],
  myntra: [
    'gstrReportPackedFile',
    'salesRevenuePackedB2cFile',
    'gstrReportRtoFile',
    'gstrReportRtFile',
  ],
};

const OPTIONAL_SLOTS: Partial<Record<MarketplaceUploadKey, string[]>> = {
  amazon: ['mtrB2bFile'],
  myntra: ['mDirectOrdersReportFile', 'mDirectReturnsReportFile'],
};

@Injectable()
export class ImportSessionService {
  private readonly sessions = new Map<string, ImportSession>();

  constructor(
    private readonly validation: ValidationService,
    private readonly uploadService: UploadService,
  ) {}

  async createSession(
    marketplaceType: MarketplaceUploadKey,
    dto: UploadReportDto,
  ) {
    const ctx = await this.validation.validateOwnership(dto);
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

    const required = REQUIRED_SLOTS[session.marketplaceType];
    const missing = required.filter((slot) => !session.files.has(slot));
    if (missing.length) {
      throw new BadRequestException(
        `Missing required report file(s): ${missing.join(', ')}`,
      );
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
