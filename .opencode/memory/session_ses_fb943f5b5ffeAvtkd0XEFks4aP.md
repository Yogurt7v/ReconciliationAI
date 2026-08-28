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
Explore the ReconciliationAI backend to understand which API routes are used by the "Сверка" page vs the "Тест ИИ" page.

Look at:
1. backend/src/index.ts - all routes defined (GET/POST endpoints)
2. Which routes are used by the reconciliation/comparison flow (NOT the test flow)
3. Which routes are used by the test flow

The test page uses: POST /api/test/analyze, GET /api/test/status/:id, GET /api/test/result/:id, GET /api/test/report/:id, GET /api/test/pairs, GET /api/test/compare/:id

I need to know which routes would become unused if we remove the Сверка page entirely.

Return the list of all routes, grouped by which page uses them (test vs reconciliation vs shared).

---

ASSISTANT:
Now let me check the frontend to see which API calls are made from each page.

---

ASSISTANT:
Let me also check the remaining reconciliation flow screens to confirm their API usage:

---

ASSISTANT:
Now let me also verify if there are any other places in the backend that reference these routes (e.g., tests or e2e scripts):

---

ASSISTANT:
Let me check the e2e and backend test files for route usage:

---

ASSISTANT:
Now I have the complete picture. Here is the full analysis.

---

## All Backend Routes and Their Usage by Page

All routes are defined in a single file: `/Users/sergej/VSProjects/ReconciliationAI/backend/src/index.ts`

### All Routes Registered in the Backend (6 total)

| # | Method | Route | Line in index.ts |
|---|--------|-------|-------------------|
| 1 | `POST` | `/api/upload` | line 71 |
| 2 | `POST` | `/api/test/analyze` | line 124 |
| 3 | `GET` | `/api/jobs/:id/status` | line 197 |
| 4 | `POST` | `/api/jobs/:id/mapping` | line 205 |
| 5 | `GET` | `/api/jobs/:id/report` | line 232 |
| 6 | `POST` | `/api/jobs/:id/cancel` | line 285 |
| 7 | `GET` | `/api/health` | line 293 |

---

### Grouped by Page

#### "Сверка" (Reconciliation) Page -- 4 routes

These are the routes used by the main reconciliation flow. The frontend calls them through `frontend/src/api.ts` and they are consumed by `UploadScreen`, `ProgressPanel`, `ConfirmationScreen`, `ReportScreen`, and `App.tsx`:

| Route | Called by frontend function | Used in frontend screen |
|-------|---------------------------|------------------------|
| `POST /api/upload` | `api.upload()` (api.ts:133) | `UploadScreen` |
| `GET /api/jobs/:id/status` | `api.status()` (api.ts:141) | `App.tsx` (polling), `ProgressPanel` |
| `POST /api/jobs/:id/mapping` | `api.confirm()` (api.ts:145) | `ConfirmationScreen` |
| `GET /api/jobs/:id/report` | `api.report()` (api.ts:153) + direct `window.open()` (ReportScreen.tsx:36) | `ReportScreen` |
| `POST /api/jobs/:id/cancel` | `api.cancel()` (api.ts:157) | `App.tsx`, `ProgressPanel` |

**Note:** The smoke test (`backend/scripts/smoke.ts`) also exercises the reconciliation pipeline (via `createJob`/`runPipeline`/`confirmMapping`/`toStatus`), but it does so by calling the job store functions directly (no HTTP), so it does not depend on any HTTP routes.

#### "Тест ИИ" (Test AI) Page -- 1 route

The test screen (`TestScreen.tsx`) is entirely self-contained. It only calls a single backend route:

| Route | Called by frontend function | Used in frontend screen |
|-------|---------------------------|------------------------|
| `POST /api/test/analyze` | `api.testAnalyze()` (api.ts:127) | `TestScreen` |

All comparison/matching logic on the test page runs entirely in the browser (client-side in `TestScreen.tsx`, see the `compare()` function at line 232). No additional backend routes are called for the comparison step.

**Correction on your initial assumption:** The routes `GET /api/test/status/:id`, `GET /api/test/result/:id`, `GET /api/test/report/:id`, `GET /api/test/pairs`, and `GET /api/test/compare/:id` do **not exist** in the backend. There is only one test route: `POST /api/test/analyze`.

#### Shared / Utility -- 1 route

| Route | Purpose |
|-------|---------|
| `GET /api/health` | Health check. Not called by any frontend page. Likely used by hosting/monitoring. |

---

### What Becomes Unused If the "Сверка" Page Is Removed

If you remove the Сверка page entirely, these routes become unused **from the frontend perspective**:

| Route | Notes |
|-------|-------|
| `POST /api/upload` | Only called by `api.upload()` in `UploadScreen` |
| `GET /api/jobs/:id/status` | Only called by `api.status()` in `App.tsx` polling |
| `POST /api/jobs/:id/mapping` | Only called by `api.confirm()` in `ConfirmationScreen` |
| `GET /api/jobs/:id/report` | Only called by `api.report()` and `window.open()` in `ReportScreen` |
| `POST /api/jobs/:id/cancel` | Only called by `api.cancel()` in `App.tsx` / `ProgressPanel` |

That is **5 out of 7 routes** that would become unused by the frontend.

However, there is an important caveat: the backend's **entire pipeline subsystem** (`backend/src/jobs/store.ts`, `backend/src/jobs/pipeline.ts`) is exclusively used by these routes. The smoke test (`smoke.ts`) also exercises the pipeline, but directly (no HTTP layer). So you could also consider removing the entire `backend/src/jobs/` directory and the related service modules (`services/reconcile.ts`, `services/applyMapping.ts`, `services/heuristics.ts`, `services/reportBuilder.ts`, `services/ai/structureAssist.ts`, `services/ai/hypotheses.ts`, `services/export/`).

### Summary: What Survives

After removing the Сверка page, only these routes remain in use:

| Route | Used by |
|-------|---------|
| `POST /api/test/analyze` | "Тест ИИ" page |
| `GET /api/health` | Infrastructure (not page-specific) |
</conversation_update>
