import { Logger } from '@nestjs/common';

export type ImportStageTimings = {
  fileUploadMs: number;
  fileReadMs: number;
  excelParsingMs: number;
  sheetProcessingMs: number;
  columnMappingMs: number;
  dataTransformationMs: number;
  databaseInsertMs: number;
  postProcessingMs: number;
  totalMs: number;
};

const STAGE_KEYS = [
  'fileUpload',
  'fileRead',
  'excelParsing',
  'sheetProcessing',
  'columnMapping',
  'dataTransformation',
  'databaseInsert',
  'postProcessing',
] as const;

type StageKey = (typeof STAGE_KEYS)[number];

export class ImportPerformanceTimer {
  private readonly stageMs = new Map<StageKey, number>();
  private readonly stageStart = new Map<StageKey, number>();
  private readonly startedAt = Date.now();

  startStage(stage: StageKey) {
    this.stageStart.set(stage, Date.now());
  }

  endStage(stage: StageKey) {
    const start = this.stageStart.get(stage);
    if (start === undefined) return;
    const elapsed = Date.now() - start;
    this.stageMs.set(stage, (this.stageMs.get(stage) ?? 0) + elapsed);
    this.stageStart.delete(stage);
  }

  addStageMs(stage: StageKey, ms: number) {
    this.stageMs.set(stage, (this.stageMs.get(stage) ?? 0) + ms);
  }

  getTimings(): ImportStageTimings {
    const pick = (key: StageKey) => this.stageMs.get(key) ?? 0;
    return {
      fileUploadMs: pick('fileUpload'),
      fileReadMs: pick('fileRead'),
      excelParsingMs: pick('excelParsing'),
      sheetProcessingMs: pick('sheetProcessing'),
      columnMappingMs: pick('columnMapping'),
      dataTransformationMs: pick('dataTransformation'),
      databaseInsertMs: pick('databaseInsert'),
      postProcessingMs: pick('postProcessing'),
      totalMs: Date.now() - this.startedAt,
    };
  }

  logSummary(logger: Logger, label: string, timings: ImportStageTimings) {
    const bottleneck = identifyImportBottleneck(timings);
    logger.log(
      `[IMPORT_PERF] ${label} | upload=${timings.fileUploadMs}ms read=${timings.fileReadMs}ms parse=${timings.excelParsingMs}ms sheet=${timings.sheetProcessingMs}ms map=${timings.columnMappingMs}ms transform=${timings.dataTransformationMs}ms db=${timings.databaseInsertMs}ms post=${timings.postProcessingMs}ms total=${timings.totalMs}ms | bottleneck=${bottleneck.stage} (${bottleneck.percent}%)`,
    );
  }
}

export type ImportBottleneckReport = {
  stage: string;
  ms: number;
  percent: number;
  rankings: Array<{ stage: string; ms: number; percent: number }>;
};

/** Rank pipeline stages by wall-clock share (excludes upload/read overhead). */
export function identifyImportBottleneck(
  timings: ImportStageTimings,
): ImportBottleneckReport {
  const stages: Array<{ key: string; ms: number }> = [
    { key: 'excelParsing', ms: timings.excelParsingMs },
    { key: 'sheetProcessing', ms: timings.sheetProcessingMs },
    { key: 'columnMapping', ms: timings.columnMappingMs },
    { key: 'dataTransformation', ms: timings.dataTransformationMs },
    { key: 'databaseInsert', ms: timings.databaseInsertMs },
    { key: 'postProcessing', ms: timings.postProcessingMs },
  ];
  const processingTotal = stages.reduce((sum, s) => sum + s.ms, 0) || 1;
  const rankings = stages
    .map((s) => ({
      stage: s.key,
      ms: s.ms,
      percent: Math.round((s.ms / processingTotal) * 100),
    }))
    .sort((a, b) => b.ms - a.ms);
  const top = rankings[0] ?? { stage: 'unknown', ms: 0, percent: 0 };
  return { stage: top.stage, ms: top.ms, percent: top.percent, rankings };
}

export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));
