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
In the ReconciliationAI project at /Users/sergej/VSProjects/ReconciliationAI, I need to understand how the reconciliation pipeline handles PDFs and how extraction works. Please:

1. Read `backend/src/services/heuristics.ts` — specifically the `plan()` function and how it maps columns for PDF files with duplicate headers like "Дата Документ | Дата Документ | Дебет | Кредит | Дебет | Кредит"
2. Read `backend/src/services/applyMapping.ts` — how it extracts docNumber, docDate from combined strings like "20.04.26 Оплата (513 от 17.04.2026)"
3. Read `backend/src/jobs/pipeline.ts` — the full pipeline flow from parsing to reconciliation
4. Read `backend/src/services/reconcile.ts` — how it matches rows between two sides
5. Read `backend/src/services/ai/structureAssist.ts` — how AI structure detection works for PDF files

Return the full content of these key functions so I can understand the complete data flow.

---

ASSISTANT:
Let me also check a few supporting files to complete the picture -- the shared normalization functions and the two-sided PDF detection:

---

ASSISTANT:
Here is a comprehensive walkthrough of the complete data flow for PDF reconciliation, covering all five files you asked about.

---

## 1. Pipeline Overview (`backend/src/jobs/pipeline.ts`)

The pipeline orchestrates the entire job through these stages with weighted progress tracking:

```
uploaded → parsing (20%) → structure (15%) → awaiting_confirmation? → extraction (25%) → reconciliation (25%) → analysis (10%) → done (5%)
```

**Stage weights** (line 39-48):
```
parsing: 20, structure: 15, awaiting_confirmation: 0, extraction: 25, reconciliation: 25, analysis: 10, done: 5
```

### `parseSideBuffer` (line 105-115) -- PDF parsing entry point

```
PDF file?
  ├─ parsePdf(buffer, fileName)  → gets text layer
  │   └─ if needsOcr → parsePdfWithOcr(buffer, fileName)  (scanned PDF fallback)
  └─ else: parseExcel(buffer, fileName)
```

### Two-sided PDF fast-path (line 246-307)

If "our" file is a text PDF (not OCR), the pipeline attempts `detectTwoSidedPdf()` which:
1. Re-parses the PDF to get the text grid
2. Checks `looksTwoSided(text)` (quick heuristic) or `twoSidedRequested` flag
3. If yes, calls `parseTwoSidedPdf(aiConfig, text, fileName)` which returns **pre-extracted** `oursParsed` and `partnerParsed` rows directly
4. **Skips** the entire structure/extraction phases -- jumps straight to reconciliation

### Normal path (line 310-323)

For non-two-sided files:
1. `ensureConfirmedStructure(job, 'ours')` -- resolves structure (AI + heuristic), may pause for human confirmation
2. `ensureConfirmedStructure(job, 'partner')` -- same for partner
3. `extractSide(job, 'ours')` / `extractSide(job, 'partner')` -- applies mapping, extracts rows

### Analysis phase (line 337-360)

If `OPENROUTER_API_KEY` is set, calls `aiHypotheses()` to generate AI explanations for mismatches. Then `buildReport()` produces the final report.

---

## 2. Heuristics (`backend/src/services/heuristics.ts`)

### Keyword dictionary (line 22-34)

The header detection uses a weighted keyword dictionary:

```typescript
const KEYWORDS: HeaderKeyword[] = [
  { re: /^(№|no\.?|n°|#)$/i, weight: 3, field: 'docNumber' },
  { re: /^номер/i, weight: 2, field: 'docNumber' },
  { re: /документ/i, weight: 2 },           // no field -- just contributes weight
  { re: /^дата\b|^дата$/i, weight: 3, field: 'docDate' },
  { re: /(?<![\p{L}])сумма(?![\p{L}])/iu, weight: 3, field: 'amount' },
  { re: /дебет/i, weight: 2, field: 'debit' },
  { re: /кредит/i, weight: 2, field: 'credit' },
  // ...
];
```

### `detectHeaderRow` (line 85-112)

Scans the first 20 rows, scores each by keyword matches. Bonus: `distinctFields.size - 2) * 2` rewards rows with multiple distinct field matches. Minimum threshold: score >= 4.

### `heuristicMapping` (line 146-214) -- The `plan()` function you asked about

This is the key column-mapping logic. It uses a `plan` array that processes fields **in priority order**:

```typescript
const plan: Array<{ field: MappingFieldKey; res: RegExp[] }> = [
  { field: 'docNumber', res: [/^(№|no\.?|n°|#)$/i, /^номер/i] },
  { field: 'docDate',   res: [/^дата/i] },
  { field: 'amount',    res: [/(?<![\p{L}])сумма(?![\p{L}])/iu] },
  { field: 'debit',     res: [/дебет/i] },
  { field: 'credit',    res: [/кредит/i] },
];
```

For each field, it calls `pickByHeader()` (line 130-140) which iterates columns **left to right** and picks the **first un-taken column** whose header matches the regex.

**For your duplicate-header case** `"Дата Документ | Дата Документ | Дебет | Кредит | Дебет | Кредит"`:

1. `docNumber` regexes (`/^(№|no.?|n°|#)$/i`, `/^номер/i`) -- **none match**, so `docNumber = null`
2. `docDate` regex `/^дата/i` -- matches the **first** "Дата Документ" column (index 0). Column 0 is **taken**.
3. `amount` regex `/сумма/` -- **none match** (no "Сумма" header), so `amount = null`
4. `debit` regex `/дебет/i` -- matches the **first** "Дебет" column (index 2). Column 2 is **taken**.
5. `credit` regex `/кредит/i` -- matches the **first** "Кредит" column (index 3). Column 3 is **taken**.

Result: `docNumber=null, docDate=0, amount=null, debit=2, credit=3`. Columns 1 ("Дата Документ") and 4 ("Дебет"), 5 ("Кредит") are unused because `pickByHeader` skips already-taken columns.

**Critical implication**: With no `docNumber` column and no `amount` column, confidence drops. The missing-required check (line 196-204) fires, capping confidence at 0.45, which triggers the human-in-the-loop confirmation screen.

---

## 3. Apply Mapping (`backend/src/services/applyMapping.ts`)

### `applyMapping` (line 78-164)

This extracts normalized rows from a raw grid using a `ColumnMapping`.

**Fallback logic** (line 88-94): If no `amount` column but `debit` and/or `credit` exist, the system uses debit/credit as the amount fallback. This is logged as an assumption.

**Row extraction loop** (line 102-143):

For each row starting at `mapping.dataStartRowIndex`:

1. Extract `docNumberRaw` from `columns.docNumber` index, normalize via `normalizeDocNumber()`
2. **Skip rows without a document number** (line 109-115) -- these are totals/subtotals. BUT if the row has data in other columns, it counts as `skipped` for transparency.
3. Parse amounts: `amountFromCol` from `columns.amount`, `debit` from `columns.debit`, `credit` from `columns.credit`. Final `amount = amountFromCol ?? debit ?? credit`
4. Parse `docDate` from `columns.docDate`
5. **Skip rows with no date AND no amount** (line 127-130) -- service rows like "Сальдо на начало"
6. Push `ParsedRow` with `rowIndex, docNumber, docNumberNorm, docDate, amount, debit, credit`
7. Stop at `MAX_DATA_ROWS` (5000)

**`findBalances`** (line 33-66): Scans the entire grid for "сальдо" rows to extract opening/closing balances from monetary values to the right of the Cyrillic label.

**`sumColumn`** (line 18-27): Sums debit or credit columns using `decimal.js` for exact arithmetic.

### About your example string "20.04.26 Оплата (513 от 17.04.2026)"

This is **not** parsed as a combined string in `applyMapping`. The function reads columns independently:
- `docNumber` column: extracts the raw number (e.g., "513" or the whole cell)
- `docDate` column: extracts the date

The string you describe would be the **cell content** in a single column. The `parseDate()` function (from `@recon/shared`) would attempt to parse it. If the cell contains "20.04.26 Оплата (513 от 17.04.2026)", `parseDate` would extract "20.04.26" as the date. The document number would come from whatever is in the `docNumber` column.

However, `normalizeDocNumber` (line 229-243 of `normalization.ts`) does this:
```typescript
s = s.replace(DASHES, '-')
  .replace(/^[\s№nN°#]+/, '')  // strip leading №, #, n°
  .toLowerCase()
  .replace(/\s+/g, '')         // remove all whitespace
  .replace(/^[-/,]+|[-/,]+$/g, ''); // trim leading/trailing punctuation
```

So a number like "513" normalizes cleanly to `"513"`. A combined string like "513 от 17.04.2026" would normalize to `"513от17.04.2026"` -- all whitespace stripped, kept as-is. This would **not** match a clean "513" from the partner side. This is exactly why the `docNumber` column matters -- it must contain the isolated document number.

---

## 4. Reconciliation Engine (`backend/src/services/reconcile.ts`)

### `reconcileSides` (line 80-126)

A purely deterministic engine with **no AI** -- only exact `decimal.js` arithmetic.

**Algorithm**:

1. **Group by normalized document number** (`groupByNumber`, line 37-46): Builds a `Map<string, ParsedRow[]>` for each side. Rows with no `docNumberNorm` are excluded.

2. **For each key in "ours"**:
   - If the key does **not exist** in partner groups: all our rows go to `onlyOurs`
   - If it exists: sort both groups by `byDateThenRow` (date ascending, then row index)
   - Pair up `min(ourCount, partnerCount)` items by position
   - Excess rows from either side go to `onlyOurs` / `onlyPartner`

3. **For each key only in partner**: all partner rows go to `onlyPartner`

### `classifyPair` (line 128-165)

For each matched pair:
1. `amountsEqual(a.amount, b.amount)` -- strict `Decimal.equals()` comparison. Returns `null` if either side is null.
2. If amounts are **not equal**: creates `AmountMismatchItem` with `difference = ourAmount - partnerAmount` and direction (`they_owe` if positive, `we_owe` if negative).
3. If amounts **are equal** (or not comparable) but dates differ: creates `DateMismatchItem`.

### `normalizeDocNumber` (shared, line 229-243)

This is the matching key. It:
- Strips soft hyphens, non-breaking spaces
