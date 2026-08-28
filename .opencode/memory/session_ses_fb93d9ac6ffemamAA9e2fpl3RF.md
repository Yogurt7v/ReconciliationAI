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
In the ReconciliationAI frontend, find which CSS classes in `frontend/src/styles/components.css` are NO LONGER used after deleting UploadScreen, ProgressPanel, ConfirmationScreen, ReportScreen, ErrorBanner, and AiLogicTimeline.

The only remaining screen is TestScreen.tsx. Search TestScreen.tsx for all CSS class names it uses (className="..." patterns).

Then compare with the CSS file to find classes that are defined but not used by any remaining TSX file.

Return:
1. List of CSS class names used by TestScreen.tsx
2. List of CSS class names defined in components.css but NOT used by any remaining TSX file (candidates for removal)

---

ASSISTANT:
Now let me read all the remaining TSX files to find every CSS class usage:

---

ASSISTANT:
Let me also check for other CSS files and any dynamic class name usage:

---

ASSISTANT:
Let me check for any dynamic class usage or template literals:

---

ASSISTANT:
Now let me verify that `.muted` is defined in the CSS (it's used in TestScreen.tsx but I need to check if it's in components.css or elsewhere):

---

ASSISTANT:
Now I have all the information needed. Let me compile the complete analysis.

---

## Results

### 1. CSS class names used by `TestScreen.tsx` (and `App.tsx`)

These are all unique CSS class names referenced in `className` attributes across the remaining TSX files (`App.tsx`, `TestScreen.tsx`, `main.tsx`, `icons.tsx`):

| # | Class | Source File |
|---|-------|-------------|
| 1 | `page` | App.tsx |
| 2 | `card` | TestScreen.tsx |
| 3 | `card-header` | TestScreen.tsx |
| 4 | `muted` | TestScreen.tsx *(defined in `base.css`, not `components.css`)* |
| 5 | `upload-grid` | TestScreen.tsx |
| 6 | `upload-actions` | TestScreen.tsx |
| 7 | `btn` | TestScreen.tsx |
| 8 | `btn-primary` | TestScreen.tsx |
| 9 | `btn-ghost` | TestScreen.tsx |
| 10 | `btn-sm` | TestScreen.tsx |
| 11 | `dropzone` | TestScreen.tsx |
| 12 | `over` | TestScreen.tsx *(state class on `.dropzone`)* |
| 13 | `filled` | TestScreen.tsx *(state class on `.dropzone`)* |
| 14 | `dropzone-icon` | TestScreen.tsx |
| 15 | `dropzone-label` | TestScreen.tsx |
| 16 | `dropzone-hint` | TestScreen.tsx |
| 17 | `dropzone-file` | TestScreen.tsx |
| 18 | `results-grid` | TestScreen.tsx |
| 19 | `result-column` | TestScreen.tsx |
| 20 | `spinner` | TestScreen.tsx |
| 21 | `banner` | TestScreen.tsx |
| 22 | `banner-error` | TestScreen.tsx |
| 23 | `badge` | TestScreen.tsx |
| 24 | `badge-info` | TestScreen.tsx |
| 25 | `empty-state` | TestScreen.tsx |
| 26 | `balance-row` | TestScreen.tsx |
| 27 | `balance-label` | TestScreen.tsx |
| 28 | `turnover-row` | TestScreen.tsx |
| 29 | `turnover-item` | TestScreen.tsx |
| 30 | `turnover-label` | TestScreen.tsx |
| 31 | `contract-block` | TestScreen.tsx |
| 32 | `contract-header` | TestScreen.tsx |
| 33 | `contract-body` | TestScreen.tsx |
| 34 | `contract-balance-line` | TestScreen.tsx |
| 35 | `contract-balance-label` | TestScreen.tsx |
| 36 | `contract-ops` | TestScreen.tsx |
| 37 | `contract-op-line` | TestScreen.tsx |
| 38 | `contract-op-amt` | TestScreen.tsx |
| 39 | `contract-remove` | TestScreen.tsx |
| 40 | `contract-op-remove` | TestScreen.tsx |
| 41 | `contract-turnovers-line` | TestScreen.tsx |
| 42 | `editable-value` | TestScreen.tsx |
| 43 | `editable-input` | TestScreen.tsx |
| 44 | `comparison-card` | TestScreen.tsx |
| 45 | `comparison-section` | TestScreen.tsx |
| 46 | `comparison-row` | TestScreen.tsx |
| 47 | `match` | TestScreen.tsx |
| 48 | `mismatch` | TestScreen.tsx |
| 49 | `comparison-pairs` | TestScreen.tsx |
| 50 | `comparison-pair` | TestScreen.tsx |
| 51 | `comparison-pair--match` | TestScreen.tsx |
| 52 | `comparison-pair--partial` | TestScreen.tsx |
| 53 | `comparison-pair--unmatched-a` | TestScreen.tsx |
| 54 | `comparison-pair--unmatched-b` | TestScreen.tsx |
| 55 | `comparison-pair-header` | TestScreen.tsx |
| 56 | `pair-number` | TestScreen.tsx |
| 57 | `pair-status` | TestScreen.tsx |
| 58 | `pair-status--match` | TestScreen.tsx |
| 59 | `pair-status--partial` | TestScreen.tsx |
| 60 | `pair-status--unmatched-a` | TestScreen.tsx |
| 61 | `pair-status--unmatched-b` | TestScreen.tsx |
| 62 | `pair-type` | TestScreen.tsx |
| 63 | `pair-amount` | TestScreen.tsx |
| 64 | `pair-diff` | TestScreen.tsx |
| 65 | `comparison-pair-body` | TestScreen.tsx |
| 66 | `pair-side` | TestScreen.tsx |
| 67 | `pair-side--unmatched` | TestScreen.tsx |
| 68 | `pair-side-label` | TestScreen.tsx |
| 69 | `pair-side-date` | TestScreen.tsx |
| 70 | `pair-side-doc` | TestScreen.tsx |
| 71 | `pair-side-amt` | TestScreen.tsx |

---

### 2. CSS classes defined in `components.css` but NOT used by any remaining TSX file (68 candidates for removal)

| # | Class Name | CSS Line |
|---|-----------|----------|
| 1 | `appbar` | 21 |
| 2 | `appbar-brand` | 30 |
| 3 | `appbar-subtitle` | 37 |
| 4 | `btn-danger` | 125 |
| 5 | `ledger-spread` | 221 |
| 6 | `ledger-side` | 238 |
| 7 | `ledger-eyebrow` | 244 |
| 8 | `ledger-spine` | 255 |
| 9 | `data-table` | 304 |
| 10 | `badge-ok` | 357 |
| 11 | `badge-warn` | 362 |
| 12 | `badge-bad` | 367 |
| 13 | `status-dot` | 378 |
| 14 | `status-dot-ok` | 385 |
| 15 | `status-dot-warn` | 386 |
| 16 | `status-dot-bad` | 387 |
| 17 | `stat-grid` | 391 |
| 18 | `stat-tile` | 410 |
| 19 | `stat-tile-label` | 417 |
| 20 | `stat-tile-value` | 426 |
| 21 | `balance-block` | 437 |
| 22 | `balance-figure` | 448 |
| 23 | `balance-figure--ok` | 458 |
| 24 | `balance-figure--bad` | 463 |
| 25 | `download-row` | 470 |
| 26 | `stepper` | 479 |
| 27 | `stepper-item` | 486 |
| 28 | `stepper-dot` | 500 |
| 29 | `stepper-text` | 547 |
| 30 | `progress-bar` | 566 |
| 31 | `progress-bar-fill` | 574 |
| 32 | `progress-meta` | 581 |
| 33 | `journal` | 588 |
| 34 | `journal-item` | 595 |
| 35 | `journal-eyebrow` | 620 |
| 36 | `journal-title` | 630 |
| 37 | `journal-detail` | 637 |
| 38 | `journal-confidence` | 642 |
| 39 | `banner-warn` | 668 |
| 40 | `banner-info` | 674 |
| 41 | `input` | 682 |
| 42 | `radio-tile` | 707 |
| 43 | `confirm-controls` | 748 |
| 44 | `mapping-table` | 769 |
| 45 | `col-letter` | 803 |
| 46 | `col-header` | 810 |
| 47 | `col-samples` | 814 |
| 48 | `section-bad` | 825 |
| 49 | `section-warn` | 829 |
| 50 | `section-ok` | 833 |
| 51 | `paired` | 839 |
| 52 | `hypotheses` | 862 |
| 53 | `hypotheses-recommendation` | 877 |
| 54 | `balance-value` | 917 |
| 55 | `turnover-value` | 945 |
| 56 | `contract-name` | 967 |
| 57 | `contract-balance-value` | 988 |
| 58 | `contract-op-date` | 1010 |
| 59 | `contract-op-doc` | 1016 |
| 60 | `contract-op-debit` | 1027 |
| 61 | `contract-op-credit` | 1031 |
| 62 | `comparison-table` | 1163 |
| 63 | `comparison-side` | 1200 |
| 64 | `comparison-doctype` | 1205 |
| 65 | `row-match` | 1213 |
| 66 | `row-partial` | 1221 |
| 67 | `row-unmatched` | 1229 |
| 68 | `mismatch-warn` | 1247 |

---

### Summary

- **71 unique CSS class names** are actively used by the remaining TSX files (from `components.css`).
- **68 CSS class names** defined in `components.css` have **zero references** in any remaining TSX file and are candidates for removal.

The unused classes fall into these logical groups that map to the deleted screens:

| Group | Classes |
|-------|---------|
| **App Bar** | `appbar`, `appbar-brand`, `appbar-subtitle` |
| **Danger button** | `btn-danger` |
| **Ledger Spread (Upload)** | `ledger-spread`, `ledger-side`, `ledger-eyebrow`, `ledger-spine` |
| **Data Table** | `data-table` (and all its descendant selectors) |
| **Badge variants** | `badge-ok`, `badge-warn`, `badge-bad` |
| **Status Dot** | `status-dot`, `status-dot-ok`, `status-dot-warn`, `status-dot-bad` |
| **Stat Tiles** | `stat-grid`, `stat-tile`, `stat-tile-label`, `stat-tile-value` |
| **Balance Block** | `balance-block`, `balance-figure`, `balance-figure--ok`, `balance-figure--bad` |
| **Download Row** | `download-row` |
| **Stepper (ProgressPanel)** | `stepper`, `stepper-item`, `stepper-dot`, `stepper-text` |
| **Progress Bar (ProgressPanel)** | `progress-bar`, `progress-bar-fill`, `progress-meta` |
| **Journal/Timeline** | `journal`, `journal-item`, `journal-eyebrow`, `journal-title`, `journal-detail`, `journal-confidence` |
| **Banner variants** | `banner-warn`, `banner-info` |
| **Form Inputs** | `input`, `radio-tile`, `confirm-controls` |
| **Mapping Table (ConfirmationScreen)** | `mapping-table`, `col-letter`, `col-header`, `col-samples` |
| **Section Borders** | `section-bad`, `section-warn`, `section-ok` |
| **Paired Layout (ReportScreen)** | `paired` |
| **Empty State** | `empty-state` *(note: this IS used in TestScreen.tsx line 718 -- please see correction)* |
| **Hypotheses (ReportScreen)** | `hypotheses`, `hypotheses-recommendation` |
| **Balance/Turnover variants** | `balance-value`, `turnover-value` |
| **Contract sub-classes** | `contract-name`, `contract-balance-value`, `contract-op-date`, `contract-op-doc`, `contract-op-debit`, `contract-op-credit` |
| **Comparison Table (ReportScreen)** | `comparison-table`, `comparison-side`, `comparison-doctype`, `row-match`, `row-partial`, `row-unmatched` |
| **Mismatch variant** | `mismatch-warn` |

**Correction:** `empty-state` (line 853) is actually used in `TestScreen.tsx` line 718 (`<div className="empty-state">`), so it should be removed from the unused list. That leaves **67 unused classes**.

**Note:** `btn-xs` is referenced in `TestScreen.tsx` (lines 819, 857, 868) but has **no corresponding definition** in `components.css` -- it is a missing CSS rule, not an unused one.
</conversation_update>
