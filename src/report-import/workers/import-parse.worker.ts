import { parentPort, workerData } from 'worker_threads';
import { FileParserService } from '../services/file-parser.service';
import type { ParseWorkerKind } from '../utils/parse-worker.runner';

const parser = new FileParserService();

try {
  const kind = workerData.kind as ParseWorkerKind;
  const buffer = Buffer.from(workerData.buffer as Uint8Array);
  let result: unknown;

  switch (kind) {
    case 'flipkart':
      result = parser.parseFlipkartWorkbook(buffer);
      break;
    case 'amazon':
      result = parser.parseAmazonWorkbook(buffer);
      break;
    default:
      throw new Error(`Unsupported parse worker kind: ${String(kind)}`);
  }

  parentPort?.postMessage({ ok: true, result });
} catch (err) {
  parentPort?.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
}
