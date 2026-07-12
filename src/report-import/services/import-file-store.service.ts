import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

type StoredFile = { buffer: Buffer; originalname: string };

export type StoredMarketplaceFiles = Record<string, StoredFile>;

const SLOT_MANIFEST = 'manifest.json';

@Injectable()
export class ImportFileStoreService {
  private readonly logger = new Logger(ImportFileStoreService.name);
  private readonly baseDir = path.join(os.tmpdir(), 'ecommreco-imports');

  async saveJobFiles(
    jobId: string,
    files: StoredMarketplaceFiles,
  ): Promise<string> {
    const jobDir = this.jobDir(jobId);
    await fs.mkdir(jobDir, { recursive: true });

    const manifest: Record<string, { originalname: string; storedAs: string }> =
      {};
    for (const [slot, file] of Object.entries(files)) {
      if (!file?.buffer?.length) continue;
      const storedAs = `${slot}${path.extname(file.originalname) || '.xlsx'}`;
      const filePath = path.join(jobDir, storedAs);
      await fs.writeFile(filePath, file.buffer);
      manifest[slot] = {
        originalname: file.originalname,
        storedAs,
      };
    }

    await fs.writeFile(
      path.join(jobDir, SLOT_MANIFEST),
      JSON.stringify(manifest),
      'utf8',
    );

    return jobDir;
  }

  async loadJobFiles(jobId: string): Promise<StoredMarketplaceFiles> {
    const jobDir = this.jobDir(jobId);
    const manifestRaw = await fs.readFile(
      path.join(jobDir, SLOT_MANIFEST),
      'utf8',
    );
    const manifest = JSON.parse(manifestRaw) as Record<
      string,
      { originalname: string; storedAs: string }
    >;

    const out: StoredMarketplaceFiles = {};
    for (const [slot, meta] of Object.entries(manifest)) {
      const buffer = await fs.readFile(path.join(jobDir, meta.storedAs));
      out[slot] = { buffer, originalname: meta.originalname };
    }
    return out;
  }

  async cleanupJobFiles(jobId: string) {
    const jobDir = this.jobDir(jobId);
    try {
      await fs.rm(jobDir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(
        `Failed to cleanup import files for job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private jobDir(jobId: string) {
    return path.join(this.baseDir, jobId);
  }
}
