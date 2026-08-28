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
Explore the ReconciliationAI codebase thoroughly. I need to understand:

1. Overall project structure (monorepo, packages, key directories)
2. Frontend structure - what pages/routes exist, how routing works, what components exist
3. Backend structure - API endpoints, especially anything related to file upload and AI analysis
4. The reconciliation engine and AI prompt - where is the AI prompt defined? What does it currently do?
5. How files are currently processed (upload flow, parsing, analysis)
6. Current test infrastructure (what testing exists already)
7. The shared package - what types and utilities are available

Return a detailed summary of:
- Directory tree (top 2-3 levels)
- Key files for: routing, AI prompts, file processing, types
- How the current analyze/reconciliation flow works end-to-end
- What the AI prompt currently contains

---

ASSISTANT:
Now let me read the key backend and frontend files in parallel:

---

ASSISTANT:
Now let me read the remaining important files:

---

ASSISTANT:
Now let me read the frontend screens, components, and the remaining backend files:

---

ASSISTANT:
Now let me read the test files and scripts:

---

ASSISTANT:
Let me read the backend test files to understand the testing infrastructure:

---

ASSISTANT:
Let me read a couple more files to complete the picture:
</conversation_update>

</existing_memory>

<conversation_update>
ASSISTANT:
Now I have a thorough understanding of the entire codebase. Here is the detailed summary:

---

## 1. OVERALL PROJECT STRUCTURE

This is a **pnpm monorepo** with 3 packages, designed as an AI-assisted accounting reconciliation system. The UI is entirely in Russian.

### Directory Tree (top 3 levels)

```
ReconciliationAI/
├── package.json                  # Root workspace: dev, build, test, typecheck, samples, smoke
├── pnpm-workspace.yaml           # Packages: shared, backend, frontend
├── tsconfig.base.json            # Shared TS config (strict, verbatimModuleSyntax)
├── Plan.md                       # TODO/roadmap
├── AGENTS.md                     # AI agent instructions
├── .env / .env.example           # OPENROUTER_API_KEY, PORT
│
├── shared/                       # @recon/shared — types, constants, normalization
│   ├── package.json
│   ├── vitest.config.ts
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              # Re-exports everything
│   │   ├── types.ts              # All domain types (254 lines)
│   │   ├── constants.ts          # MAX_FILE_SIZE, CONFIDENCE_THRESHOLD, etc.
│   │   └── normalization.ts      # parseMoney, parseDate, normalizeDocNumber, formatMoney
│   └── tests/
│       └── normalization.test.ts # 169 lines of unit tests
│
├── backend/                      # @recon/backend — Fastify API, parsers, AI, reconciliation
│   ├── package.json
│   ├── vitest.config.ts          # 120s timeout
│   ├── tsconfig.json
│   ├── .env
│   ├── src/
│   │   ├── index.ts              # Fastify server, all HTTP routes (226 lines)
│   │   ├── jobs/
│   │   │   ├── store.ts          # In-memory job store (Map), CRUD + confirm + cancel
│   │   │   └── pipeline.ts       # Pipeline orchestrator (426 lines) — THE CORE
│   │   ├── parsers/
│   │   │   ├── excelParser.ts    # SheetJS-based XLSX/XLS parser
│   │   │   ├── pdfParser.ts      # pdf.js-based text PDF parser + two-sided detection
│   │   │   ├── ocrPipeline.ts    # Tesseract.js OCR pipeline for scanned PDFs
│   │   │   └── tableGeometry.ts  # Column unification algorithm (shared by PDF + OCR)
│   │   └── services/
│   │       ├── heuristics.ts     # Heuristic table structure detection
│   │       ├── applyMapping.ts   # Extract ParsedRow[] from grid using ColumnMapping
│   │       ├── reconcile.ts      # Deterministic reconciliation engine (Decimal math)
│   │       ├── reportBuilder.ts  # Assembles ReconciliationReport
│   │       ├── ai/
│   │       │   ├── client.ts     # OpenRouter API client (JSON mode, retry, timeout)
│   │       │   ├── structureAssist.ts  # AI + heuristic table structure detection
│   │       │   ├── structuredParse.ts  # AI parsing of two-sided reconciliation acts
│   │       │   └── hypotheses.ts       # Rule-based + AI hypothesis generation
│   │       └── export/
│   │           ├── htmlReport.ts  # Self-contained HTML report (inline CSS)
│   │           ├── xlsxReport.ts  # Multi-sheet XLSX via exceljs
│   │           └── pdfReport.ts   # PDF via pdfkit with Cyrillic font support
│   ├── tests/                    # 9 test files
│   │   ├── ai.test.ts
│   │   ├── reconcile.test.ts
│   │   ├── applyMapping.test.ts
│   │   ├── export.test.ts
│   │   ├── reportBuilder.test.ts
│   │   ├── pdfParser.test.ts
│   │   ├── ocrPipeline.test.ts
│   │   ├── pipeline.test.ts
│   │   └── structuredParse.test.ts
│   └── scripts/
│       ├── generate-samples.ts   # Generates demo XLSX/PDF pairs for testing
│       ├── smoke.ts              # E2E smoke test runner
│       └── prepare-ocr.ts        # Downloads Tesseract traineddata
│
├── frontend/                     # @recon/frontend — React 19 + Vite SPA
│   ├── package.json
│   ├── vite.config.ts            # Proxy /api → localhost:5057
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx              # React root mount
│       ├── App.tsx               # Single-page app state machine (no router)
│       ├── api.ts                # API client (upload, status, confirm, report, cancel)
│       ├── screens/
│       │   ├── UploadScreen.tsx  # File upload with dropzones
│       │   ├── ProgressPanel.tsx # Progress stepper + reasoning log
│       │   ├── ConfirmationScreen.tsx  # Human-in-the-loop column mapping
│       │   └── ReportScreen.tsx  # Full reconciliation report display
│       ├── components/
│       │   ├── AiLogicTimeline.tsx  # AI reasoning timeline display
│       │   ├── ErrorBanner.tsx      # Error display
│       │   └── icons.tsx            # SVG icon components
│       └── styles/
│           ├── base.css
│           ├── components.css
│           └── tokens.css
│
└── test/                         # Sample PDF files for manual testing
    ├── Рузский.pdf
    ├── Рузский 2 двусторонний.pdf
    ├── Ропнет Наш.pdf
    └── Ропнет не наш.pdf
```

---

## 2. FRONTEND STRUCTURE

### Routing / Navigation

There is **no router**. The app is a single-screen SPA managed by a state machine in `App.tsx`:

```
App (state machine)
├── Phase: upload → UploadScreen
└── Phase: job (jobId) → polling status →
    ├── stage=awaiting_confirmation → ConfirmationScreen
    ├── stage=done + reportReady → ReportScreen
    ├── stage=done/failed/cancelled → terminal screen
    └── other stages → ProgressPanel
```

The `Phase` type is either `{ kind: 'upload' }` or `{ kind: 'job', jobId: string }`. Polling hits `GET /api/jobs/:id/status` every 700ms.

### Key Frontend Files

| File | Path | Purpose |
|------|------|---------|
| App state machine | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/App.tsx` | Phase routing, polling, cancel |
| API client | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/api.ts` | `api.upload()`, `api.status()`, `api.confirm()`, `api.report()`, `api.cancel()` |
| Upload screen | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/UploadScreen.tsx` | Two dropzones (ours + partner), two-sided checkbox, form submit |
| Progress panel | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ProgressPanel.tsx` | Stepper, progress bar, reasoning log, cancel button |
| Confirmation screen | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ConfirmationScreen.tsx` | Radio-button column mapping, preview table, confidence display |
| Report screen | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ReportScreen.tsx` | KPI tiles, balance, tables (onlyOurs, onlyPartner, amount/date mismatches), hypotheses, AI logic timeline, download buttons |
| AI Logic Timeline | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/components/AiLogicTimeline.tsx` | Displays `ReasoningStep[]` with stage labels and confidence |

### Components

- **UploadScreen**: Two-file upload with drag-and-drop. Has a "two-sided act" checkbox that disables the partner file slot (partner data extracted from one PDF by AI).
- **ConfirmationScreen**: Human-in-the-loop. Shows a table of columns with radio buttons to map fields (docNumber, docDate, amount, debit, credit). User confirms mapping when confidence is low or required fields are missing.
- **ReportScreen**: Full report with summary KPIs, balance checks table, amount/date mismatch tables, only-ours/only-partner tables, hypotheses with recommendations, AI logic timeline, and HTML/XLSX/PDF download buttons.

---

## 3. BACKEND STRUCTURE

### API Endpoints

All routes are defined in `/Users/sergej/VSProjects/ReconciliationAI/backend/src/index.ts`:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/upload` | Upload ours + partner files (.xlsx/.xls/.pdf). Returns `{ id }` |
| `GET` | `/api/jobs/:id/status` | Returns `JobStatus` (stage, progress, ETA, reasoning, pendingConfirmation) |
| `POST` | `/api/jobs/:id/mapping` | Confirm/correct column mapping (Human-in-the-Loop) |
| `GET` | `/api/jobs/:id/report` | Get report: `?format=json` (default), `html`, `xlsx`, `pdf` |
| `POST` | `/api/jobs/:id/cancel` | Request cancellation |
| `GET` | `/api/health` | Health check |

### File Upload Flow

1. Frontend sends `POST /api/upload` with `multipart/form-data` containing fields `ours` (required), `partner` (optional if twoSided=true), and `twoSided` (boolean string).
