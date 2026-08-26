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
I need to understand the frontend architecture for planning a new feature. Please read these files and return their complete contents:

1. `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/App.tsx`
2. `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/api.ts`
3. `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/UploadScreen.tsx`
4. `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ProgressPanel.tsx`
5. `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/components/` - list all files and read the main ones

Return the complete file contents so I can understand the component structure, state management, and API communication patterns.

---

ASSISTANT:
Now let me read all three component files, plus the two additional screens imported by App.tsx (ConfirmationScreen and ReportScreen):

---

ASSISTANT:
Let me also check the entry point and any remaining source files for completeness:

---

ASSISTANT:
Here is the complete picture of the frontend architecture.

---

## File Inventory

The frontend has exactly 13 source files (10 TSX/TS + 3 CSS):

```
frontend/src/
  main.tsx                          (entry point)
  App.tsx                           (root component + phase routing)
  api.ts                            (API client + helpers)
  screens/
    UploadScreen.tsx                (file upload with drag-and-drop)
    ProgressPanel.tsx               (live polling progress stepper)
    ConfirmationScreen.tsx          (column-mapping confirmation step)
    ReportScreen.tsx                (final reconciliation report + downloads)
  components/
    ErrorBanner.tsx                 (global error/warning banner)
    AiLogicTimeline.tsx             (AI reasoning step timeline)
    icons.tsx                       (SVG icon components)
  styles/
    tokens.css                      (CSS custom properties)
    base.css                        (reset, layout, typography)
    components.css                  (all component styles)
```

---

## Architecture Summary

### Entry Point (`main.tsx`)

Standard React 19 SPA bootstrap. Renders `<App />` inside `<StrictMode>`.

### State Management (`App.tsx`)

There is **no external state library** -- all state lives in the root `App` component via `useState` / `useRef`:

- **`phase`**: A discriminated union `Phase = { kind: 'upload' } | { kind: 'job'; jobId: string }` that determines which screen to render. This is the top-level router (no React Router).
- **`status`**: `JobStatus | null` -- polled from the backend every 700ms via `setInterval` after upload.
- **`error`**: `string | null` -- global error message passed to `<ErrorBanner>`.
- **`pollRef`**: Ref holding the interval ID for the polling loop.

**Lifecycle:**
1. `phase.kind === 'upload'` -- renders `<UploadScreen>`
2. After upload succeeds, `handleUploaded` switches to `phase.kind === 'job'` and starts polling `api.status(jobId)`.
3. Based on `status.stage`, one of four views is rendered:
   - `awaiting_confirmation` + `pendingConfirmation` exists --> `<ConfirmationScreen>`
   - `done` + `reportReady` --> `<ReportScreen>`
   - `done`/`failed`/`cancelled` (terminal without report) --> error card with restart button
   - Otherwise (active pipeline stages) --> `<ProgressPanel>`

### API Layer (`api.ts`)

A thin `fetch`-based client with 5 methods on the `api` object:

| Method | HTTP | Endpoint | Purpose |
|---|---|---|---|
| `upload(ours, partner)` | POST | `/api/upload` | Multipart FormData, returns `{ id }` |
| `status(jobId)` | GET | `/api/jobs/:id/status` | Returns `JobStatus` (polled every 700ms) |
| `confirm(jobId, payload)` | POST | `/api/jobs/:id/mapping` | Sends column-mapping confirmation |
| `report(jobId)` | GET | `/api/jobs/:id/report?format=json` | Returns `ReconciliationReport` |
| `cancel(jobId)` | POST | `/api/jobs/:id/cancel` | Cancels an in-progress job |

**Error handling:** The private `request<T>` helper parses JSON error responses and throws an `ApiError(message, status)` for non-2xx responses. No retry logic, no auth headers, no request interceptors.

**Note:** Downloads (HTML/XLSX/PDF) in `ReportScreen` bypass the API client and open the URL directly in a new tab via `window.open()`.

### Screen-by-Screen Breakdown

**`UploadScreen.tsx`** -- Two `Dropzone` sub-components (one for "your act", one for "partner's act") with drag-and-drop + click-to-pick. Validates file type (`.xlsx`, `.pdf`) and size (`MAX_FILE_SIZE_BYTES` from shared). Calls `api.upload()` on submit. Local state only (`ours`, `partner`, `busy`).

**`ProgressPanel.tsx`** -- Pure display component. Renders a 6-step stepper (parsing -> structure -> awaiting_confirmation -> extraction -> reconciliation -> analysis), a progress bar driven by `status.progress` (0..1), ETA display, a reasoning log (`status.reasoningLog`), and a cancel button that calls `api.cancel()` directly.

**`ConfirmationScreen.tsx`** -- Shown when the backend is unsure about table structure. Displays a radio-tile grid for column-to-field mapping. Uses shared constants `MAPPING_FIELD_LABELS`, `REQUIRED_FIELDS`. User edits `headerRowIndex`, `dataStartRowIndex`, and column assignments, then calls `api.confirm()`. Validates that all required fields are assigned before enabling the submit button.

**`ReportScreen.tsx`** -- Fetches the full `ReconciliationReport` on mount via `api.report()`. Renders:
- Summary KPI tiles (matched, only-ours, only-partner, amount mismatches, date mismatches, balance issues)
- Final balance block with directional coloring
- Download buttons (HTML/XLSX/PDF) via `window.open()`
- `BalanceSection` -- table of balance checks
- `OnlySection` (x2) -- items only on one side
- `AmountMismatchSection` -- matched documents with different amounts
- `DateMismatchSection` -- matched documents with different dates
- Hypotheses list with recommendations
- `<AiLogicTimeline>` -- AI reasoning steps

### Reusable Components (`components/`)

- **`ErrorBanner`** -- Simple conditional banner with `variant` (`error`/`warn`/`info`). Renders nothing when `message` is null.
- **`AiLogicTimeline`** -- Renders a list of `ReasoningStep` objects as a "journal" with stage labels, titles, details, and confidence percentages.
- **`icons.tsx`** -- 6 pure SVG components: `FileIcon`, `UploadCloudIcon`, `CheckIcon`, `AlertIcon`, `DownloadIcon`, `SwapIcon`, `XIcon`. All accept an optional `className` prop.

### Data Flow Pattern

```
User action (upload / confirm / download / cancel)
  --> api.*() call (fetch to /api/...)
  --> Backend processes asynchronously
  --> App polls api.status() every 700ms
  --> status.stage determines which screen renders
  --> Report fetched once on completion
```

### Key Observations for Feature Planning

1. **No routing library** -- phase switching is a simple state machine in `App.tsx`. Adding new screens means extending the `Phase` type and the render logic.
2. **No global state management** -- state is prop-drilled from `App`. For complex new features, you may want context or a lightweight store.
3. **Polling is coarse** -- fixed 700ms interval with no backoff, no SSE/WebSocket. Could become a concern with many concurrent users.
4. **All shared types come from `@recon/shared`** -- any new data structures (e.g., new report sections) should be typed there.
5. **No tests, no linting, no formatter** -- follow existing code conventions.
6. **Russian-language UI strings are hardcoded** in components (not extracted to a locale file).
</conversation_update>
