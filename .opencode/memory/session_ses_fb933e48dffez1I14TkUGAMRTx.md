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
Explore the ReconciliationAI project thoroughly. I need to understand:
1. The overall directory structure (all 3 packages)
2. Key entry points and configuration files
3. The main source files in each package

List:
- All directories at the root level
- All files in backend/src/ (recursively)
- All files in frontend/src/ (recursively)
- All files in shared/src/ (recursively)
- Configuration files: package.json, tsconfig.json, pnpm-workspace.yaml, .env.example

Return the full directory listing for each location.

---

ASSISTANT:
I'll explore the ReconciliationAI project thoroughly by examining the directory structure, source files, and configuration. Let me start with a comprehensive scan.

---

ASSISTANT:
Now let me read all the configuration files and key entry points in parallel:

---

ASSISTANT:
Let me also check for additional configuration files and directories:

---

ASSISTANT:
Let me read the remaining key source files:

---

ASSISTANT:
Let me read the remaining important source files:

---

ASSISTANT:
Now I have a complete picture of the project. Here is the comprehensive directory listing and analysis:

---

## ReconciliationAI -- Full Project Directory Listing

### 1. Root Level

```
/Users/sergej/VSProjects/ReconciliationAI/
├── .env                          # Active environment (gitignored)
├── .env.example                  # Template environment config
├── .git/                         # Git repository
├── .gitignore                    # Git ignore rules
├── .opencode/                    # OpenCode config directory
├── AGENTS.md                     # Agent instructions (gitignored)
├── Plan.md                       # Project plan
├── README.md                     # Readme
├── package.json                  # Root workspace package.json
├── pnpm-lock.yaml                # Lockfile (committed)
├── pnpm-workspace.yaml           # pnpm workspace definition
├── tsconfig.base.json            # Shared TypeScript base config
├── backend/                      # Backend package (@recon/backend)
├── frontend/                     # Frontend package (@recon/frontend)
├── shared/                       # Shared types/utils package (@recon/shared)
├── test/                         # Manual test PDF files (gitignored contents)
├── node_modules/                 # Dependencies (gitignored)
└── .tessdata/                    # OCR trained data cache (gitignored)
```

### 2. Configuration Files

**`/Users/sergej/VSProjects/ReconciliationAI/package.json`** -- Root monorepo orchestrator:
- Scripts: `dev` (parallel backend:5057 + frontend:3000), `build`, `test`, `typecheck`, `samples`, `smoke`
- Single devDependency: `typescript ^5.7.3`

**`/Users/sergej/VSProjects/ReconciliationAI/pnpm-workspace.yaml`** -- Workspace definition:
- 3 packages: `shared`, `backend`, `frontend`
- Native build permissions: `esbuild`, `sharp`, `tesseract.js`

**`/Users/sergej/VSProjects/ReconciliationAI/tsconfig.base.json`** -- Shared TypeScript config:
- Target ES2022, module ESNext, bundler resolution
- Strict mode, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
- `noEmit: true` (type-checking only)

**`/Users/sergej/VSProjects/ReconciliationAI/.env.example`** -- Environment template:
- `OPENROUTER_API_KEY` -- AI model access
- `OPENROUTER_MODEL` -- default `nvidia/nemotron-3-ultra:free`
- `PORT=5057` -- backend port (5000 used by AirPlay on macOS)
- `MAX_FILE_MB=50`, `LOG_LEVEL=info`

---

### 3. Shared Package (`@recon/shared`)

```
/Users/sergej/VSProjects/ReconciliationAI/shared/
├── package.json                  # Entry: ./src/index.ts, dependency: decimal.js
├── tsconfig.json                 # Extends ../tsconfig.base.json
├── src/
│   ├── index.ts                  # Public API: re-exports types, constants, normalization
│   ├── types.ts                  # All domain types (254 lines)
│   ├── constants.ts              # System constants (25 lines)
│   └── normalization.ts          # Money/date/doc-number normalization (277 lines)
└── tests/
    └── normalization.test.ts     # Vitest tests for normalization
```

**Key exports from `shared/src/types.ts`:**
- `SideRole` ('ours' | 'partner'), `SourceKind`, `CellValue`, `Grid`
- `RawSource`, `ColumnMapping`, `ColumnStats`, `PreviewTable`
- `ParsedRow`, `ParsedSide`, `SideMeta`
- `ReconciliationReport`, `SummaryCounts`, `BalanceCheck`, `FinalBalance`
- `Hypothesis`, `ReasoningStep`, `JobStage`, `JobStatus`, `PendingConfirmation`
- `AiStructuredResult`, `ConfirmPayload`

**Key exports from `shared/src/constants.ts`:**
- `MAX_FILE_SIZE_BYTES` (50 MB), `ALLOWED_EXTENSIONS` (.xlsx, .xls, .pdf)
- `CONFIDENCE_THRESHOLD` (0.72), `MAX_DATA_ROWS` (5000)
- `OCR_MIN_CHARS_PER_PAGE` (120), `AI_STRUCTURE_SAMPLE_ROWS` (30)

**Key exports from `shared/src/normalization.ts`:**
- `parseMoney(input)` -- Parses monetary values to decimal strings (handles Russian/English formats, accounting negatives)
- `formatMoney(value)` -- Formats decimal string to Russian display format
- `parseDate(input)` -- Parses dates to ISO (handles Date, Excel serial, dd.mm.yyyy, word months)
- `normalizeDocNumber(input)` -- Normalizes document numbers for matching (extracts from parentheses, # signs)
- `columnLetter(index)` -- Converts 0-based index to Excel column letter

---

### 4. Backend Package (`@recon/backend`)

```
/Users/sergej/VSProjects/ReconciliationAI/backend/
├── package.json                  # Fastify 5, parsers, AI integrations
├── tsconfig.json                 # Extends ../tsconfig.base.json
├── .env                          # Local env (gitignored)
├── scripts/
│   ├── generate-samples.ts       # Generate demo XLSX/PDF pairs
│   ├── prepare-ocr.ts            # Download tesseract trained data
│   └── smoke.ts                  # E2E smoke test
├── src/
│   ├── index.ts                  # Fastify HTTP server entry point (147 lines)
│   ├── jobs/
│   │   ├── store.ts              # In-memory job store (142 lines)
│   │   └── pipeline.ts           # Pipeline orchestrator (426 lines)
│   ├── parsers/
│   │   ├── excelParser.ts        # Excel XLSX/XLS parser via SheetJS (116 lines)
│   │   ├── pdfParser.ts          # Text PDF parser via pdfjs-dist (289 lines)
│   │   ├── ocrPipeline.ts        # OCR pipeline: pdf.js + sharp + tesseract.js (286 lines)
│   │   └── tableGeometry.ts      # Column geometry / grid reconstruction (166 lines)
│   └── services/
│       ├── ai/
│       │   ├── client.ts         # OpenRouter API client with retry (201 lines)
│       │   ├── structureAssist.ts # AI + heuristic structure detection (187 lines)
│       │   ├── structuredParse.ts # AI parsing of two-sided reconciliation acts (341 lines)
│       │   ├── hypotheses.ts     # Rule-based + AI hypothesis generation (182 lines)
│       │   └── testAnalyze.ts    # Test AI analysis endpoint (279 lines)
│       ├── applyMapping.ts       # Row extraction from grid via column mapping (180 lines)
│       ├── heuristics.ts         # Heuristic table structure detection (277 lines)
│       ├── reconcile.ts          # Deterministic reconciliation engine (166 lines)
│       ├── reportBuilder.ts      # Final report assembly (199 lines)
│       └── export/
│           └── htmlReport.ts     # Self-contained HTML report generator (246 lines)
└── tests/
    ├── ai.test.ts
    ├── applyMapping.test.ts
    ├── ocrPipeline.test.ts
    ├── pdfParser.test.ts
    ├── pipeline.test.ts
    ├── reconcile.test.ts
    ├── reportBuilder.test.ts
    └── structuredParse.test.ts
```

**Backend entry point (`backend/src/index.ts`):**
- Fastify 5 server with CORS and multipart
- Routes: `POST /api/test/analyze` (upload file -> parse -> AI analysis), `GET /api/health`
- Loads env from `../../.env` relative to source
- Listens on `PORT` env var (default 5057)

**Backend pipeline stages (`backend/src/jobs/pipeline.ts`):**
- `uploaded -> parsing -> structure -> awaiting_confirmation -> extraction -> reconciliation -> analysis -> done`
- Progress tracked by stage weights, ETA estimated from file sizes
- Human-in-the-loop: pauses at `awaiting_confirmation` when structure confidence is low
- Supports two-sided PDF parsing via AI (`detectTwoSidedPdf`)

**Key dependencies:** `fastify`, `exceljs`/`xlsx`, `pdfjs-dist`, `pdfkit`, `sharp`, `tesseract.js`, `@napi-rs/canvas`, `decimal.js`

---

### 5. Frontend Package (`@recon/frontend`)

```
/Users/sergej/VSProjects/ReconciliationAI/frontend/
├── package.json                  # React 19, Vite 6
├── tsconfig.json                 # Extends ../tsconfig.base.json, adds DOM libs, react-jsx
├── vite.config.ts                # Vite config: port 3000, proxy /api -> backend:5057
├── index.html                    # HTML shell (lang="ru", Google Fonts, CSS imports)
├── src/
│   ├── main.tsx                  # React root: StrictMode + createRoot (10 lines)
│   ├── App.tsx                   # App shell: renders MainScreen (9 lines)
│   ├── api.ts                    # API client + TypeScript interfaces (130 lines)
│   ├── screens/
│   │   └── MainScreen.tsx        # Main UI screen (1098 lines)
│   ├── components/
│   │   └── icons.tsx             # SVG icon components
│   └── styles/
│       ├── tokens.css            # CSS custom properties (design tokens)
│       ├── base.css              # Base/reset styles
│       └── components.css        # Component-specific styles
```

**Frontend architecture:**
- Single-screen SPA (no router), React 19 with StrictMode
- `MainScreen.tsx` is the primary component (1098 lines): file upload zones (A/B), AI analysis, editable results, comparison engine, comparison card display
- `api.ts`: API client with `ApiError` class, types for `DocumentData`, `Contract`, `Transaction`, `ComparisonResult`, etc.
