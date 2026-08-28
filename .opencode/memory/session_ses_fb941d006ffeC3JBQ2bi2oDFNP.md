<!-- stm:v1 -->
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- None captured yet.

### Long Horizon Context
- None captured yet.

### Decisions
- None captured yet.

### Conclusions
- None captured yet.

### Active References
- None captured yet.

</existing_memory>

<conversation_update>
USER:
Explore the ReconciliationAI backend to understand what needs to be removed when deleting the Сверка (reconciliation) routes.

I need to know:
1. In `backend/src/index.ts` — which routes are Сверка-only (POST /api/upload, GET /api/jobs/:id/status, POST /api/jobs/:id/mapping, GET /api/jobs/:id/report, POST /api/jobs/:id/cancel)
2. Which files in `backend/src/jobs/` are used ONLY by these routes
3. Which files in `backend/src/services/` are used ONLY by these routes (not by testAnalyze)
4. Which files in `backend/src/services/export/` exist
5. What the smoke test (`backend/scripts/smoke.ts`) imports and uses

I need to know the full dependency tree to safely delete these routes without breaking the test flow.

Return:
- List of files to delete entirely
- List of routes to remove from index.ts
- List of imports to remove from index.ts
- Any circular dependencies or shared code that must stay

---

ASSISTANT:
Now let me read all the job and service files, plus the smoke script, to trace dependencies:

---

ASSISTANT:
Now let me read the remaining service and parser files to complete the dependency tree:

---

ASSISTANT:
Let me check the remaining parsers and also verify if any tests reference these files:

---

ASSISTANT:
Now I have a complete picture. Here is the full dependency analysis.

---

## 1. Routes to remove from `backend/src/index.ts`

| Route | Lines | Handler uses |
|---|---|---|
| `POST /api/upload` | 71--120 | `createJob`, `runPipeline` |
| `GET /api/jobs/:id/status` | 197--201 | `getJob`, `toStatus` |
| `POST /api/jobs/:id/mapping` | 205--227 | `getJob`, `confirmMapping` |
| `GET /api/jobs/:id/report` | 231--281 | `getJob`, `buildHtmlReport`, `buildXlsxReport`, `buildPdfReport`, `PdfFontError` |
| `POST /api/jobs/:id/cancel` | 285--289 | `requestCancel` |

Routes that **stay**:
- `POST /api/test/analyze` (lines 124--193) -- the testAnalyze flow
- `GET /api/health` (line 293)

Also remove the block-comment headers for each removed section (lines 49, 195, 203, 229, 283) and the top-of-file docstring that documents the Сверка routes (lines 1--12).

---

## 2. Imports to remove from `backend/src/index.ts`

| Line | Import | Why removable |
|---|---|---|
| 22 | `import type { ConfirmPayload } from '@recon/shared'` | Only used in the `POST /api/jobs/:id/mapping` body type |
| 24 | `import { createJob, getJob, toStatus, confirmMapping, requestCancel } from './jobs/store.js'` | Every symbol is only used by Сверка routes |
| 25 | `import { runPipeline } from './jobs/pipeline.js'` | Only called in `POST /api/upload` |
| 28 | `import { buildHtmlReport } from './services/export/htmlReport.js'` | Only used in the report route |
| 29 | `import { buildXlsxReport } from './services/export/xlsxReport.js'` | Only used in the report route |
| 30 | `import { buildPdfReport, PdfFontError } from './services/export/pdfReport.js'` | Only used in the report route |

**Imports that STAY** (used by `POST /api/test/analyze`):

| Line | Import | Used by test/analyze |
|---|---|---|
| 21 | `ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES` from `@recon/shared` | `validateFile`, error message |
| 26 | `parseExcel` from `./parsers/excelParser.js` | Excel branch of test/analyze |
| 27 | `parsePdf` from `./parsers/pdfParser.js` | PDF branch of test/analyze |
| 31 | `aiConfigFromEnv` from `./services/ai/client.js` | Creates config for testAnalyze |
| 32 | `testAnalyze` from `./services/ai/testAnalyze.js` | Core of test/analyze |

**Shared helpers inside `index.ts` that must stay** (used by `test/analyze`):
- `UploadedFile` interface (lines 51--54)
- `EXT_RE` regex (line 56)
- `validateFile()` (lines 58--64) -- called from both upload (being removed) AND test/analyze (line 146)
- `readUploadFile()` (lines 66--69) -- called from both upload and test/analyze

---

## 3. Files in `backend/src/jobs/` -- NONE are Сверка-only

Both files are consumed by the **smoke test** (`backend/scripts/smoke.ts`), so neither can be deleted:

| File | Imported by (beyond index.ts) |
|---|---|
| `backend/src/jobs/store.ts` | `smoke.ts` (line 12: `createJob, confirmMapping, toStatus`) |
| `backend/src/jobs/pipeline.ts` | `smoke.ts` (line 13: `runPipeline`) |

They also have deep dependency trees into `services/` (heuristics, applyMapping, reconcile, reportBuilder, hypotheses, structureAssist, aiConfigFromEnv, all parsers) which are needed for the pipeline smoke to work.

---

## 4. Files in `backend/src/services/` -- exclusive to Сверка routes

I traced every import chain. Two export files are used **only** by the report route in `index.ts` and are **not** reached by smoke.ts or testAnalyze:

| File | Consumer |
|---|---|
| `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/export/xlsxReport.ts` | `index.ts` line 29 (report route) |
| `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/export/pdfReport.ts` | `index.ts` line 30 (report route) |

All other service files are shared:

| File | Shared with (not Сверka-route-only) |
|---|---|
| `services/export/htmlReport.ts` | `smoke.ts` line 14 |
| `services/reportBuilder.ts` | `pipeline.ts` line 33 -> `smoke.ts` |
| `services/reconcile.ts` | `pipeline.ts` line 31 -> `smoke.ts` |
| `services/applyMapping.ts` | `testAnalyze.ts` line 12 (`cellToString`) + `pipeline.ts` -> `smoke.ts` |
| `services/heuristics.ts` | `pipeline.ts` line 26 -> `smoke.ts` |
| `services/ai/client.ts` | `testAnalyze.ts`, `structureAssist.ts`, `structuredParse.ts`, `hypotheses.ts`, `pipeline.ts` |
| `services/ai/testAnalyze.ts` | `index.ts` test/analyze route (not Сверka at all) |
| `services/ai/structureAssist.ts` | `pipeline.ts` line 28 -> `smoke.ts` |
| `services/ai/hypotheses.ts` | `pipeline.ts` line 29 + `reportBuilder.ts` -> `smoke.ts` |
| `services/ai/structuredParse.ts` | `pdfParser.ts` line 23 -> both `testAnalyze` and `pipeline` |

---

## 5. What `backend/scripts/smoke.ts` imports and uses

```
Line 12:  import { confirmMapping, createJob, toStatus } from '../src/jobs/store.js';
Line 13:  import { runPipeline } from '../src/jobs/pipeline.js';
Line 14:  import { buildHtmlReport } from '../src/services/export/htmlReport.js';
Line 15:  import { buildScenarios, buildPdfPairs } from './generate-samples.js';
Line 16:  import type { SamplePair } from './generate-samples.js';
```

Full dependency pull from smoke.ts:
```
smoke.ts
  -> jobs/store.ts
  -> jobs/pipeline.ts
       -> parsers/excelParser.ts
       -> parsers/pdfParser.ts
            -> parsers/tableGeometry.ts
            -> services/ai/structuredParse.ts
                 -> services/ai/client.ts
       -> parsers/ocrPipeline.ts
            -> parsers/tableGeometry.ts
            -> parsers/pdfParser.ts (loadPdfjs)
       -> services/heuristics.ts
       -> services/applyMapping.ts
       -> services/ai/structureAssist.ts
       -> services/ai/hypotheses.ts
       -> services/ai/client.ts
       -> services/reconcile.ts
       -> services/reportBuilder.ts
            -> services/ai/hypotheses.ts
            -> services/reconcile.ts
  -> services/export/htmlReport.ts
  -> scripts/generate-samples.ts
```

---

## Files to delete entirely

| Absolute path | Reason |
|---|---|
| `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/export/xlsxReport.ts` | Only imported by report route in index.ts |
| `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/export/pdfReport.ts` | Only imported by report route in index.ts |

---

## Routes to remove from `index.ts`

1. `POST /api/upload` -- lines 49--120 (the `/* --------------------------------- Upload --------------------------------- */` section including `UploadedFile` is kept, only the route handler `app.post('/api/upload', ...)` is removed)
2. `GET /api/jobs/:id/status` -- lines 195--201
3. `POST /api/jobs/:id/mapping` -- lines 203--227
4. `GET /api/jobs/:id/report` -- lines 229--281
5. `POST /api/jobs/:id/cancel` -- lines 283--289

---

## Imports to remove from `index.ts`

1. Line 22: `import type { ConfirmPayload } from '@recon/shared'`
2. Line 24: `import { createJob, getJob, toStatus, confirmMapping, requestCancel } from './jobs/store.js'`
3. Line 25: `import { runPipeline } from './jobs/pipeline.js'`
4. Line 28: `import { buildHtmlReport } from './services/export/htmlReport.js'`
5. Line 29: `import { buildXlsxReport } from './services/export/xlsxReport.js'`
6. Line 30: `import { buildPdfReport, PdfFontError } from './services/export/pdfReport.js'`

---

## Shared code that MUST stay (would break smoke or testAnalyze if removed)

- **`jobs/store.ts`** and **`jobs/pipeline.ts`** -- the entire reconciliation engine is exercised by `smoke.ts`
- **`services/export/htmlReport.ts`** -- smoke.ts writes HTML reports via `buildHtmlReport`
- **`services/reportBuilder.ts`** -- called by `pipeline.ts` -> smoke.ts
- **`services/reconcile.ts`** -- called by `pipeline.ts` -> smoke.ts
- **`services/applyMapping.ts`** -- called by `pipeline.ts` -> smoke.ts AND by `testAnalyze.ts` (shares `cellToString`)
- **`services/heuristics.ts`** -- called by `pipeline.ts` -> smoke.ts
- **`services/ai/client.ts`** -- used by testAnalyze route and pipeline
- **`services/ai/structureAssist.ts`** -- called by `pipeline.ts` -> smoke.ts
- **`services/ai/hypotheses.ts`** -- called by `pipeline.ts` and `reportBuilder.ts`
- **`services/ai/structuredParse.ts`** -- called by `pdfParser.ts` which is used by both test/analyze and pipeline
- **All parsers** (`excelParser.ts`, `pdfParser.ts`, `ocrPipeline.ts`, `tableGeometry.ts`) -- shared between test/analyze and pipeline/smoke
- **Shared helpers in `index.ts`**: `UploadedFile`, `validateFile()`, `readUploadFile()`, `EXT_RE` -- used by the `test/analyze` route
