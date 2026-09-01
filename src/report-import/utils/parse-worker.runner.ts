import { existsSync } from 'fs';
import { Worker } from 'worker_threads';
import * as path from 'path';

export type ParseWorkerKind = 'flipkart' | 'amazon';

const resolveImportParseWorkerPath = () => {
  const base = path.resolve(__dirname, '../workers/import-parse.worker');
  const jsPath = `${base}.js`;
  if (existsSync(jsPath)) return jsPath;
  const tsPath = `${base}.ts`;
  if (existsSync(tsPath)) return tsPath;
  throw new Error('import-parse.worker not found');
};

export function runParseInWorkerThread<T>(
  kind: ParseWorkerKind,
  buffer: Buffer,
  timeoutMs = 120_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const workerPath = resolveImportParseWorkerPath();
    const worker = new Worker(workerPath, {
      workerData: {
        kind,
        buffer: Uint8Array.from(buffer),
      },
      ...(workerPath.endsWith('.ts')
        ? {
            execArgv: [
              '-r',
              'ts-node/register',
              '-r',
              'tsconfig-paths/register',
            ],
          }
        : {}),
    });

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      void worker.terminate();
      settle(() =>
        reject(new Error(`Parse worker timed out after ${timeoutMs}ms`)),
      );
    }, timeoutMs);

    worker.once(
      'message',
      (message: { ok: boolean; result?: T; error?: string }) => {
        if (message.ok && message.result !== undefined) {
          settle(() => resolve(message.result as T));
        } else {
          settle(() =>
            reject(new Error(message.error ?? 'Parse worker failed')),
          );
        }
      },
    );
    worker.once('error', (err) => settle(() => reject(err)));
    worker.once('exit', (code) => {
      if (code !== 0) {
        settle(() =>
          reject(new Error(`Parse worker exited with code ${code}`)),
        );
      }
    });
  });
}
