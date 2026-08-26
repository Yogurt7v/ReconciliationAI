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
Read the following test files and return their complete contents. I need to understand the test patterns, fixtures, and what's being tested:

1. `/Users/sergej/VSProjects/ReconciliationAI/backend/tests/pipeline.test.ts`
2. `/Users/sergej/VSProjects/ReconciliationAI/backend/tests/ai.test.ts`
3. `/Users/sergej/VSProjects/ReconciliationAI/backend/tests/reconcile.test.ts`
4. `/Users/sergej/VSProjects/ReconciliationAI/backend/tests/pdfParser.test.ts`

Return the complete file contents.

---

ASSISTANT:
Here are the complete contents of all four test files:

---

## 1. `/Users/sergej/VSProjects/ReconciliationAI/backend/tests/pipeline.test.ts` (113 lines)

**What it tests:** Integration tests for the full pipeline orchestrator in degraded mode (no AI key).

**Fixtures/helpers:**
- `xlsxBuffer(rows)` -- creates an XLSX buffer from a 2D array using the `xlsx` library.
- `goodRows()` -- returns a well-formed accounting reconciliation table with a recognizable header row.

**Test cases (3):**
1. **Full run of an ideal file pair** -- creates a job with two identical well-formed XLSX buffers, runs the pipeline, and asserts it reaches `done` stage with `reportReady: true`, correct matched count (2), zero amount mismatches, and an `even` final balance. Also checks that the AI logic stages include `parsing`, `structure`, `reconciliation`, and end with `analysis`.
2. **Unclear header requiring user confirmation** -- uses columns `A, B, C` (no accounting headers), runs the pipeline, and polls for `pendingConfirmation` status. It auto-confirms with a specified mapping (`headerRowIndex: 0, dataStartRowIndex: 1`, columns mapping) until the pipeline finishes. Asserts at least 1 confirmation occurred, 2 matched rows, and that the mapping source is `user`.
3. **Cancellation before pipeline runs** -- calls `requestCancel` before `runPipeline`, asserts the job reaches `cancelled` stage with no error, and that a second cancel request returns `false` (terminal state).

**Pattern:** Each test has a 30-second timeout. `afterEach` cleans up `OPENROUTER_API_KEY`. The tests exercise the job store (`createJob`, `getJob`, `confirmMapping`, `requestCancel`, `toStatus`) and the pipeline orchestrator directly.

---

## 2. `/Users/sergej/VSProjects/ReconciliationAI/backend/tests/ai.test.ts` (258 lines)

**What it tests:** The AI service layer -- the OpenRouter HTTP client, structure detection assistant, and hypothesis generation.

**Fixtures/helpers:**
- `SAMPLE_GRID` -- a 4x4 `Grid` with a Russian header row and data rows.
- `ctxWith(partial)` -- builds a full `HypothesisContext` with sensible defaults, allowing partial overrides.

**Test groups:**

### `requestJson` (5 tests):
1. Throws `AiUnavailableError` when no API key is provided.
2. Parses valid JSON from a mocked OpenRouter response (200 status).
3. Retries on HTTP 503 and succeeds on the second attempt (verifies 2 fetch calls).
4. Does NOT retry on HTTP 400 (client error), throws `AiUnavailableError` immediately.
5. Throws on invalid JSON content in the model's response (even with 200 status).

### `assistStructure` (3 tests):
1. **Without API key** -- degrades to heuristic mapping, sets `aiUsed: false`, `source: 'heuristic'`, and reasoning mentions the missing key. Asserts correct column detection.
2. **With API key and valid response** -- fetch mock returns a well-formed structure mapping. Asserts `aiUsed: true`, `source: 'ai+heuristic'`, confidence >= 0.9, reasoning contains AI prefix, and correct `dataStartRowIndex`.
3. **With API key but invalid model response** -- model returns `docNumber: -5`. Falls back to heuristic with `source: 'heuristic'` and a degradation note in reasoning.

### `ruleBasedHypotheses` (3 tests):
1. Round amount difference (15000 vs 10000) produces a document-scope hypothesis about partial payment for doc "104".
2. Multiple date mismatches (4) produces a hypothesis mentioning date discrepancies.
3. Many "only ours" documents (6) produces a recommendation to share with the counterparty.

### `aiHypotheses` (3 tests):
1. Validates and normalizes model output -- filters out garbage entries (empty text, null recommendation, invalid scope) and keeps the valid one.
2. Returns `null` on network error (graceful degradation).
3. Returns `null` when no API key is provided.

**Pattern:** All network calls are mocked via `vi.stubGlobal('fetch', ...)`. `afterEach` restores globals and cleans the env var.

---

## 3. `/Users/sergej/VSProjects/ReconciliationAI/backend/tests/reconcile.test.ts` (178 lines)

**What it tests:** The core reconciliation engine (`reconcileSides`) -- matching, mismatch detection, direction calculation, normalization, duplicates, and performance.

**Fixtures/helpers:**
- `row(partial)` -- builds a `ParsedRow` with auto-incrementing `rowIndex`, normalizes `docNumber` via `normalizeDocNumber`, and parses `amount` via `parseMoney` (from `@recon/shared`).
- `side(rows)` -- wraps rows into a `ParsedSide` with metadata.

**Test cases (10):**
1. **Perfect match** -- same documents on both sides in different order. Asserts 2 matched pairs, 0 mismatches, 0 orphaned.
2. **Orphans on each side** -- doc "2" only ours, doc "9" only partner.
3. **Amount mismatch with direction** -- 1000.00 vs 999.99, difference is `0.01`, direction `they_owe`.
4. **Reverse direction** -- 500.00 vs 700.00, direction `we_owe`, difference `-200.00`.
5. **Strict equality after normalization** -- `0,10` (comma decimal) vs `0.10000001` -- both normalize to the same 2-decimal value, so no mismatch.
6. **Date mismatch** -- same amount but different dates produces a date mismatch with correct `ourDate`.
7. **Duplicates** -- two identical rows on our side vs one on partner. One matched pair, one orphaned.
8. **Duplicates with different dates** -- paired by date order, produces 2 matched pairs and 1 amount mismatch.
9. **Document number normalization** -- "No 123/A" and "123/a" (lowercase, no prefix) match as the same document.
10. **Null doc number** -- a row with no doc number cannot be matched, ends up in neither matched nor orphaned lists.

**Performance test (1):**
- Generates 1000 rows on each side with a 5-document offset. Asserts reconciliation completes in under 3 seconds, with 995 matched + 5 only-ours + 5 only-partner = 1005 total positions.

**Pattern:** Pure unit tests, no mocking, no network calls. Uses shared normalization functions from `@recon/shared`.

---

## 4. `/Users/sergej/VSProjects/ReconciliationAI/backend/tests/pdfParser.test.ts` (119 lines)

**What it tests:** The PDF parser -- table grid recovery, multi-page stitching, scan detection, and fragmented text reassembly.

**Fixtures/helpers:**
- `makePdf(draw)` -- generates a real PDF in memory using `pdfkit`. Accepts a callback to draw content. Returns a `Buffer`.
- `drawTable(doc, rows, top)` -- draws a table at fixed X coordinates (columns at 40, 150, 260, 380) with 20px row spacing.
- `sampleRows(count, from)` -- generates a header row + `count` data rows with formulaic values.

**Test cases (4):**
1. **Single-page table recovery** -- draws 8 rows, parses the PDF, asserts `kind: 'pdf-text'`, 1 page, no OCR needed, and the grid matches the input rows exactly (same values, same order).
2. **Multi-page stitching** -- two pages with separate tables, parsed into a single grid. Verifies the grid has the combined row count, header is present on both pages, and page 2 data starts at the correct offset with correct values.
3. **Scan detection** -- a PDF with only "OK" as text (below the `OCR_MIN_CHARS_PER_PAGE` threshold of 120 chars). Asserts `needsOcr: true` and empty grid.
4. **Fragmented text reassembly** -- a cell value "12 345,67" is drawn as three separate `doc.text()` calls at nearby X positions. Asserts the parser merges them back into a single cell containing "12345,67". Includes filler rows to prevent scan detection.

**Pattern:** Uses real PDF generation (pdfkit) rather than mocks. Tests the `parsePdf` function from `../src/parsers/pdfParser.js`. The comment notes that the OCR threshold of 120 chars/page means test tables must be sufficiently dense to not be flagged as scans.
</conversation_update>
