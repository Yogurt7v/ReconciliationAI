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
In the ReconciliationAI project at /Users/sergej/VSProjects/ReconciliationAI, I need to understand the exact code paths that will break when processing these two PDF files. Please:

1. Read `shared/src/normalization.ts` — full file, especially `normalizeDocNumber`, `parseDate`, `parseMoney`
2. Read `backend/src/services/applyMapping.ts` — full file, especially the row extraction loop and `findBalances`
3. Read `backend/src/services/heuristics.ts` — full file, especially `analyzeAndMap`, `detectHeaderRow`, `heuristicMapping`
4. Read `backend/src/parsers/pdfParser.ts` — full file, especially `reconstructGrid`, `gridToText`, `mergeGrids`
5. Read `backend/src/jobs/pipeline.ts` — full file

For each file, return the COMPLETE content so I can see every line. I need exact line numbers and full function bodies to create a precise implementation plan.

---

ASSISTANT:
I'll read all five files in parallel right now.

---

ASSISTANT:
Here are all five files in full. Let me also grab `tableGeometry.ts`, which is imported by `pdfParser.ts` and contains the critical `assignColumns`, `segmentsToGrid`, and `trimGridEdges` functions that form the backbone of the grid construction:

---

ASSISTANT:
Here is the complete content of all requested files plus the critical dependency `tableGeometry.ts`. Below is a consolidated summary with exact line numbers for the code paths that matter for PDF processing.

---

## File 1: `/Users/sergej/VSProjects/ReconciliationAI/shared/src/normalization.ts` (254 lines)

**Full content already returned above.** Key function bodies:

- **`parseMoney`** (lines 32--99): Strips whitespace/currency symbols, detects sign, resolves decimal vs. thousand separators by "rightmost wins" rule, returns `"1234.56"` string or `null`. Guard at line 95 rejects values >= 1e15.
- **`parseDate`** (lines 161--210): Handles ISO, dd.mm.yyyy, word-months (Russian/English), Excel serials. Falls through to `null`.
- **`normalizeDocNumber`** (lines 229--243): Strips soft-hyphens, normalizes dashes, removes leading `№/#/n°`, lowercases, strips whitespace and trailing/leading punctuation.

---

## File 2: `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/applyMapping.ts` (164 lines)

**Full content already returned above.** Key code paths:

- **Row extraction loop** (lines 102--143): Iterates grid from `mapping.dataStartRowIndex`. Skips rows where both `docNumberRaw` and `docNumberNorm` are empty (line 109). Skips rows with no date AND no amount (line 127--129). Caps at `MAX_DATA_ROWS`.
- **`findBalances`** (lines 33--66): Scans every grid row for `сальдо`, finds rightmost Cyrillic label, grabs money values to its right. Opening balance = first value matching `начал`; closing = last value matching `конец`.

---

## File 3: `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/heuristics.ts` (255 lines)

**Full content already returned above.** Key functions:

- **`detectHeaderRow`** (lines 85--112): Scans first 20 rows, scores each against `KEYWORDS` regex list (lines 22--34). Threshold: score >= 4. Bonus for 3+ distinct `MappingFieldKey` hits.
- **`heuristicMapping`** (lines 146--214): Matches header cells to fields via `pickByHeader`. Confidence starts at 0.5 + 0.12 per matched field. Missing required fields (`docNumber`/`docDate`/`amount`) caps confidence at 0.45.
- **`analyzeAndMap`** (lines 230--235): Convenience wrapper: `analyzeGrid` + `heuristicMapping`.

---

## File 4: `/Users/sergej/VSProjects/ReconciliationAI/backend/src/parsers/pdfParser.ts` (289 lines)

**Full content already returned above.** Key code paths:

- **`clusterLines`** (lines 100--123): Groups `PositionedItem[]` by Y-baseline tolerance = `min(8, max(1.5, median(heights)*0.7))`. Uses sliding-average Y to handle slight skew.
- **`lineToSegments`** (lines 129--163): Merges nearby text items into segments. `joinSameWord` threshold: gap <= max(1.0, charWidth*1.1). `joinWithSpace`: gap <= max(4, charWidth*2.4).
- **`parsePdf`** (lines 184--256): Loads pdf.js, extracts text items with coordinates, clusters into lines, converts to segments, calls `assignColumns` + `segmentsToGrid` + `trimGridEdges`. Returns `needsOcr: true` if avg chars/page < `OCR_MIN_CHARS_PER_PAGE`.
- **`gridToText`** (lines 261--263): Tab-separated, newline-joined.
- **`detectTwoSidedPdf`** (lines 274--289): Calls `parsePdf`, then `looksTwoSided` heuristic, then AI parse if applicable.

---

## File 5: `/Users/sergej/VSProjects/ReconciliationAI/backend/src/jobs/pipeline.ts` (388 lines)

**Full content already returned above.** Key code paths:

- **`parseSideBuffer`** (lines 105--115): PDF path: `parsePdf` -> if `needsOcr` -> `parsePdfWithOcr`. Excel path: `parseExcel`.
- **`resolveStructure`** (lines 128--170): Calls `assistStructure(source.grid)`. If required fields missing or confidence < `CONFIDENCE_THRESHOLD`, sets `job.pendingConfirmation`.
- **`extractSide`** (lines 192--207): Calls `applyMapping(source, mapping, role)`.
- **Main pipeline** (lines 211--388): `parsing` -> two-sided AI attempt -> `structure` (both sides) -> `extraction` -> `reconciliation` -> `analysis` -> `done`.

---

## File 6: `/Users/sergej/VSProjects/ReconciliationAI/backend/src/parsers/tableGeometry.ts` (166 lines)

**Full content already returned above.** Key functions:

- **`assignColumns`** (lines 34--130): Two-phase column assignment. Phase 1: lines with 2+ segments define columns by x-interval overlap (COL_TOLERANCE = 4pt). Phase 2: single-segment lines attach to nearest column; completely unmatched get their own column. Final `renumber` sorts columns left-to-right.
- **`segmentsToGrid`** (lines 133--150): Maps segments into a rectangular `string[][]` using the column assignment. Joins multiple segments in the same column with a space.
- **`trimGridEdges`** (lines 153--166): Strips all-empty rows from top/bottom and all-empty columns from right.

---

## Critical PDF Processing Code Paths (End-to-End)

Here is the exact call chain for a PDF file, with line numbers:

```
pipeline.ts:105  parseSideBuffer()
  -> pipeline.ts:108  parsePdf()                    [pdfParser.ts:184]
       -> pdfParser.ts:189  pdfjs.getDocument()
       -> pdfParser.ts:202-222  loop pages:
            -> pdfParser.ts:220  clusterLines()     [pdfParser.ts:100]
            -> pdfParser.ts:220  lineToSegments()    [pdfParser.ts:129]
       -> pdfParser.ts:224-228  avgChars calc + needsOcr check
       -> pdfParser.ts:242  assignColumns()          [tableGeometry.ts:34]
       -> pdfParser.ts:244  segmentsToGrid()         [tableGeometry.ts:133]
       -> pdfParser.ts:246  trimGridEdges()          [tableGeometry.ts:153]

  (if needsOcr) -> pipeline.ts:110  parsePdfWithOcr()

  -> pipeline.ts:249  detectTwoSidedPdf()            [pdfParser.ts:274]
       -> pdfParser.ts:280  parsePdf() (again!)
       -> pdfParser.ts:284  gridToText()             [pdfParser.ts:261]
       -> pdfParser.ts:286  looksTwoSided()
       -> pdfParser.ts:288  parseTwoSidedPdf() (AI)

  -> pipeline.ts:315-317  ensureConfirmedStructure()
       -> pipeline.ts:132  assistStructure()
            -> heuristics.ts:231  analyzeGrid()      [heuristics.ts:115]
                 -> heuristics.ts:85  detectHeaderRow()
                 -> heuristics.ts:50  columnStats()
            -> heuristics.ts:233  heuristicMapping() [heuristics.ts:146]

  -> pipeline.ts:322-323  extractSide()
       -> applyMapping.ts:78  applyMapping()
            -> applyMapping.ts:102-143  row loop
            -> applyMapping.ts:145  findBalances()
```

---

## Likely Break Points for Problematic PDFs

| # | Location | Risk | What goes wrong |
|---|---|---|---|
| 1 | `pdfParser.ts:100-123` `clusterLines` | **Y tolerance too tight/loose** | If median character height is unusual (tiny font or huge scanned text), `tol = min(8, max(1.5, median*0.7))` may merge distinct lines or split one line. Result: garbled row structure. |
| 2 | `pdfParser.ts:129-163` `lineToSegments` | **Gap thresholds misjudge columns** | `joinWithSpace` at max(4, charWidth*2.4) may merge two distinct column cells if the inter-column gap is small, or split one cell if kerning is wide. Numbers in different columns land in one segment. |
| 3 | `tableGeometry.ts:69` | **Single-segment lines excluded from column building** | Lines with only 1 segment (e.g. a standalone total row or a title line) are skipped in Phase 1. If the entire "data" portion of a page has 1-segment lines (ragged layout), NO columns are built, and Phase 2 assigns everything to column 0. |
| 4 | `tableGeometry.ts:23` `COL_TOLERANCE = 4` | **Hard-coded tolerance** | 4pt may be too tight for high-DPI PDFs or too loose for dense tables, causing column overlap/merging. |
| 5 | `tableGeometry.ts:133-150` `segmentsToGrid` | **Multi-segment join produces merged cells** | If two different logical columns get assigned the same column index (due to overlap), their text is space-concatenated into one cell (`joined[col] = ... ${seg.text}`). Downstream heuristics see `"12345678"` instead of `"1234 5678"`. |
| 6 | `heuristics.ts:85-112` `detectHeaderRow` | **Header not found or wrong row** | If header text is in a non-standard language, uses unusual labels, or is split across two visual rows, score stays below 4. Falls back to `headerRowIndex = 0` (line 117), which may be a title/blank row, causing all column assignments to be wrong. |
| 7 | `heuristics.ts:146-214` `heuristicMapping` | **Required fields null** | If `docNumber`, `docDate`, or `amount` columns are not matched, confidence is capped at 0.45 (line 200). This triggers `awaiting_confirmation` in the pipeline (line 150 of `pipeline.ts`), halting automated processing. |
