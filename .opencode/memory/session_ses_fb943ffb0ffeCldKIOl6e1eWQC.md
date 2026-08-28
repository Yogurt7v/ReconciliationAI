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
Explore the ReconciliationAI monorepo to understand the "Сверка" (Comparison) page structure. I need to know:

1. Where is the "Сверка" page defined? Look in frontend/src/screens/ for any screen that shows reconciliation/comparison results (NOT the test page).
2. What is the Phase type and how does routing work? Look in frontend/src/App.tsx or similar.
3. What components are ONLY used by the Сверка page (not used by the Test page)?
4. What is the current default phase/screen?

Search in:
- frontend/src/App.tsx
- frontend/src/screens/ - all files
- frontend/src/components/ - all files

Return the full file paths, key types (Phase, Props), and which components/screens are associated with each phase.

---

ASSISTANT:
Now let me read all the screens and components in parallel:

---

ASSISTANT:
Now let me also check the API types to fully understand the imports:

---

ASSISTANT:
Here is a comprehensive breakdown of the "Сверка" (Comparison) page structure in the ReconciliationAI frontend.

---

## 1. Where is the "Сверка" page defined?

The "Сверка" page is **not a single screen file**. It is the **entire `phase.kind === 'main'` flow** managed in `App.tsx`, which renders different screens depending on the `status.stage` of the active job. The "Сверка" tab button in the `AppBar` sets `phase.kind` to `'upload'`.

**File:** `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/App.tsx`

The "Сверка" flow composes these screens in sequence:

| Job Stage | Screen Component | File |
|---|---|---|
| (no job / upload phase) | `UploadScreen` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/UploadScreen.tsx` |
| `uploaded`, `parsing`, `structure`, `extraction`, `reconciliation`, `analysis` (in-progress) | `ProgressPanel` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ProgressPanel.tsx` |
| `awaiting_confirmation` | `ConfirmationScreen` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ConfirmationScreen.tsx` |
| `done` (report ready) | `ReportScreen` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ReportScreen.tsx` |
| `done` (report NOT ready), `failed`, `cancelled` | Inline error/cancel message in App.tsx (lines 128-137) | N/A |

---

## 2. The `Phase` type and routing

**File:** `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/App.tsx` (lines 13-16)

```typescript
type Phase =
  | { kind: 'upload' }
  | { kind: 'job'; jobId: string }
  | { kind: 'test' };
```

There are three phases, which act as a simple state-machine-based router (no react-router):

| Phase | Meaning | Default phase? |
|---|---|---|
| `{ kind: 'upload' }` | The main Сверка upload screen (or any non-job state for the "main" tab) | **YES** -- initial state is `{ kind: 'upload' }` (line 19) |
| `{ kind: 'job'; jobId: string }` | A running/completed job in the Сверка flow. Once `status` is loaded, the specific sub-screen (ProgressPanel, ConfirmationScreen, ReportScreen, or error) is selected based on `status.stage`. | No |
| `{ kind: 'test' }` | The "Тест ИИ" (AI Test) page | No |

**Routing logic (simplified):**

1. `phase.kind === 'test'` -> renders `TestScreen` (line 73)
2. `phase.kind === 'upload'` OR `status` is null -> renders `UploadScreen` (line 92)
3. Otherwise (job is active), `status.stage` determines which sub-component to show (lines 119-140):
   - `awaiting_confirmation` -> `ConfirmationScreen`
   - `done` + `reportReady` -> `ReportScreen`
   - terminal (cancelled/failed/done without report) -> inline error card
   - all other stages -> `ProgressPanel`

---

## 3. Components ONLY used by the Сверка page (not used by Test page)

### Screens exclusively used by Сверка:

| Screen | File | Used by Сверка? | Used by Test? |
|---|---|---|---|
| `UploadScreen` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/UploadScreen.tsx` | YES | No |
| `ProgressPanel` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ProgressPanel.tsx` | YES | No |
| `ConfirmationScreen` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ConfirmationScreen.tsx` | YES | No |
| `ReportScreen` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/ReportScreen.tsx` | YES | No |
| `TestScreen` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/screens/TestScreen.tsx` | No | YES |

### Components exclusively used by Сверка:

| Component | File | Used by Сверка screens? | Used by TestScreen? |
|---|---|---|---|
| `AiLogicTimeline` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/components/AiLogicTimeline.tsx` | YES (`ReportScreen` imports it) | No |
| `ErrorBanner` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/components/ErrorBanner.tsx` | YES (`App.tsx` imports it, rendered in Сверка branches only) | No |
| `DownloadIcon` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/components/icons.tsx` | YES (`ReportScreen` imports it) | No |

### Components shared by BOTH pages:

| Component | File | Used by Сверка? | Used by Test? |
|---|---|---|---|
| `UploadCloudIcon` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/components/icons.tsx` | YES (`UploadScreen`) | YES (`TestScreen`) |
| `FileIcon` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/components/icons.tsx` | YES (`UploadScreen`) | YES (`TestScreen`) |
| `AlertIcon` | `/Users/sergej/VSProjects/ReconciliationAI/frontend/src/components/icons.tsx` | YES (via `ErrorBanner`) | No (but exported for potential use) |

### Internal components defined INSIDE ReportScreen (Сверка-only):

These are private (non-exported) components within `ReportScreen.tsx`:
- `BalanceSection` -- balance checks table
- `OnlySection` -- "only ours" / "only partner" documents
- `AmountMismatchSection` -- amount discrepancies
- `DateMismatchSection` -- date discrepancies
- `directionLabel()` -- helper for labeling "we owe" / "they owe"

### Internal components defined INSIDE ConfirmationScreen (Сверка-only):

- `previewRows()` -- builds column preview data
- `truncate()` -- string truncation helper

### Internal components defined INSIDE TestScreen (Test-only):

These are defined inside `TestScreen.tsx` but are NOT used by Сверка:
- `DropZone` (different from `Dropzone` in UploadScreen)
- `ResultColumn`
- `EditableValue`
- `EditableText`
- `DebugCard`
- `ResultCard`
- `ContractBlock`
- `ComparisonCard`
- Various helper functions (`detectDocType`, `canMatchTypes`, `buildPairs`, `pairStatusLabel`, `pairTypeLabel`, `fmt`)

---

## 4. Current default phase/screen

**The default phase is `{ kind: 'upload' }`**, set on line 19 of `App.tsx`:

```typescript
const [phase, setPhase] = useState<Phase>({ kind: 'upload' });
```

This means when the app first loads, the user sees:
1. The `AppBar` with "Сверка" tab highlighted (`activeTab="main"`)
2. An `ErrorBanner` (renders nothing if `error` is null)
3. The `UploadScreen` -- with two dropzones for "Ваш акт" and "Акт контрагента" files, plus the "Сверить документы" button

The user can navigate to the "Тест ИИ" tab at any time via the `AppBar`, which sets `phase` to `{ kind: 'test' }`.
</conversation_update>
