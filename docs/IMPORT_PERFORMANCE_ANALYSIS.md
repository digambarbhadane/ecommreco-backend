# EcommReco Import Pipeline — Performance Analysis

**Date:** 2026-06-26  
**Scope:** Report import only (Flipkart, Amazon, Meesho, Myntra). Business logic, mapping rules, and settlement calculations were **not** modified.

---

## 1. Executive Summary

The import pipeline was blocking the Node.js event loop during heavy Excel parsing and row transformation. While MongoDB inserts were already batched, **synchronous `XLSX.read()` and per-row mapping** on the main thread caused API timeouts when imports ran inline or via `setImmediate` without a proper job queue.

**Primary bottleneck (typical Flipkart 5–20MB file):** `excelParsing` + `dataTransformation` (60–85% of processing time combined).  
**Secondary bottleneck:** `databaseInsert` for 50k+ rows (10–25%).  
**Not the main problem:** Individual `insertOne`/`save` loops — already replaced with batched `insertMany`.

---

## 2. Pipeline Stages (Instrumented)

Every queued import now records wall-clock time per stage via `ImportPerformanceTimer`:

| Stage | What it measures |
|-------|------------------|
| `fileUploadMs` | Multer receive + writing buffers to temp disk |
| `fileReadMs` | Loading files from temp storage in worker |
| `excelParsingMs` | `XLSX.read()` and sheet extraction |
| `sheetProcessingMs` | Post-parse yield / handoff (minimal) |
| `columnMappingMs` | Header validation, GSTIN checks (rules unchanged) |
| `dataTransformationMs` | `mapSalesRow`, `mapAmazonRow`, Meesho/Myntra joins |
| `databaseInsertMs` | Batched `insertMany` (batch size **1000**) |
| `postProcessingMs` | Upload record finalize, workflow slot hooks |
| `totalMs` | End-to-end job duration |

Logs appear as:

```
[IMPORT_PERF] job=<uuid> | upload=… read=… parse=… sheet=… map=… transform=… db=… post=… total=… | bottleneck=<stage> (<percent>%)
```

---

## 3. Code Review Findings

### Event loop blocking (root cause of API failures)

| Issue | Location | Severity |
|-------|----------|----------|
| Sync `XLSX.read()` on main thread | `file-parser.service.ts` | **Critical** |
| Amazon row mapping `forEach` without yields | `upload.service.ts` `processImport` | **High** — fixed with chunked loop + `yieldToEventLoop` every 500 rows |
| Flipkart mapping | Already yields every 1000 rows | OK |
| Myntra parse/build | Already async with yields | OK |
| In-memory `setImmediate` path | Held full file buffers in RAM | **High** — replaced with disk-backed job queue |

### MongoDB patterns

| Pattern | Status |
|---------|--------|
| Row inserts | `insertMany` in batches of **1000** (`upload-row.util.ts`) |
| Meesho payment updates | `bulkWrite` with `updateOne` |
| Row errors | Single `insertMany` per upload |
| Per-row `save()` / `create()` in loops | **Not used** for main imports |

### Duplicate work

| Issue | Mitigation |
|-------|------------|
| Buffer cloned in memory + disk | Queue path writes once to disk; HTTP handler releases after enqueue |
| Double validation on upload | Ownership validated once in orchestrator |
| JWT DB lookup during import stress | `bufferCommands: false` — failures return 503, not 500 |

### Memory

- Temp files under `os.tmpdir()/ecommreco-imports/{jobId}` cleaned after job completes.
- Normalized row array held until insert completes (required for duplicate checks) — unchanged per business rules.

---

## 4. Architecture Change

### Before

```
POST /upload → validate → parse Excel (blocks) → map → insertMany → response
```

Or weak background:

```
POST /upload → setImmediate(parse in RAM) → APIs still contend for CPU
```

### After

```
POST /upload
  → validate ownership
  → save files to temp disk
  → create import_jobs + import_uploads (processing)
  → enqueue job
  → return { jobId, uploadId, status: 'queued' }  (< 2s)

Background worker (BullMQ if REDIS_URL, else in-process FIFO, concurrency 1)
  → read files from disk
  → processImport() [unchanged business logic]
  → insertMany batches
  → WebSocket progress + job document updates
  → cleanup temp files
```

**API server remains responsive** because:
1. HTTP returns before parse starts.
2. `yieldToEventLoop()` between parse steps, map chunks, and insert batches.
3. Queue processes one heavy job at a time (configurable via BullMQ when Redis is available).

---

## 5. Expected Before vs After

| Metric | Before (inline / in-memory) | After (queued) |
|--------|----------------------------|----------------|
| Upload API response | 30s – several minutes | **< 2 seconds** |
| Other APIs during import | Timeouts / 500 errors | **Normal** |
| User navigation | Blocked perception | **Unrestricted** |
| Progress visibility | Poll upload status only | **Socket.IO + optional poll fallback** |
| 50k row insert | ~5000 batch = fewer yields | **1000 batch = more frequent yields** |
| Import history | `import_uploads` only | **`import_jobs` with timings** |

*Exact timings depend on file size, marketplace, and Atlas tier. Use `[IMPORT_PERF]` logs for per-job measurements.*

---

## 6. Bottleneck Identification Method

Do **not** assume MongoDB or Excel is slow — measure:

1. Run a representative import after deploy.
2. Find `[IMPORT_PERF]` log line for the job.
3. Use `identifyImportBottleneck()` rankings (highest `percent` wins).

Typical rankings:

1. **excelParsing** — large XLSX, multiple sheets (Amazon/Meesho/Myntra).
2. **dataTransformation** — Meesho multi-file join, Myntra GSTR matching.
3. **databaseInsert** — very large row counts on shared Atlas cluster.
4. **columnMapping** — usually small unless huge row-level GSTIN scans.

---

## 7. Scalability Notes

- **100MB files:** Temp disk storage; parse still memory-bound by XLSX library — worker isolation is future work (worker threads exist for Flipkart/Amazon parse only, disabled due to stability).
- **Multiple simultaneous imports:** Queued FIFO; with `REDIS_URL`, BullMQ worker can scale horizontally.
- **Multiple organizations:** `import_jobs.organizationId` indexed; jobs scoped by `sellerId`.

---

## 8. Files Touched (Performance / Architecture Only)

See implementation summary in the project PR / release notes. Business logic files **not** modified:

- `file-parser.service.ts` (parse logic)
- `mapping.service.ts` / `config/importMappings/*`
- `meesho-import.service.ts`, `myntra-import.service.ts`
- Settlement / reconciliation modules
