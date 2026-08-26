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
I need to understand how the reconciliation system detects and maps table column headers. The user reports that "Дата Документа" is being incorrectly recognized as "Сальдо начальное" (opening balance), and other headers are wrong.

Please thoroughly explore:
1. `backend/src/parsers/tableGeometry.ts` — how table structure/columns are detected
2. `backend/src/services/heuristics.ts` — heuristic-based header matching
3. `backend/src/services/ai/` — AI-based structure detection
4. `backend/src/jobs/pipeline.ts` — how the structure stage works
5. `backend/src/services/applyMapping.ts` — how confirmed mappings are applied
6. `shared/src/types.ts` — the type definitions for columns/structure
7. `shared/src/constants.ts` — any column name constants

For each file, provide:
- The full file content (or key sections if very long)
- How headers/columns are mapped to logical names (docNumber, docDate, amount, debit, credit, etc.)
- Any normalization or fuzzy matching of Russian header names
- The flow from raw cell text → recognized column type

Return the complete code of all relevant files so I can understand the full header recognition pipeline.

---

ASSISTANT:
I'll start by reading all the explicitly requested files in parallel, plus searching for any related files I might have missed.

---

ASSISTANT:
Now let me read the AI structure detection files and the remaining parsers:

---

ASSISTANT:
Let me also read the shared utilities that are used throughout the pipeline (parseMoney, parseDate, normalizeDocNumber, columnLetter):

---

ASSISTANT:
Let me also check for tests related to the heuristic structure detection and header matching to see edge cases:

---

ASSISTANT:
Let me also check the HTTP route handler for the structure/mapping endpoint:

---

ASSISTANT:
Now I have the complete picture. Here is a thorough analysis of the entire header recognition pipeline, including all file contents, the flow from raw cell text to recognized column type, and a diagnosis of the "Дата Документа" bug.

---

## Complete Header Recognition Pipeline

### 1. File Overview and Roles

| File | Absolute Path | Role |
|------|--------------|------|
| `types.ts` | `/Users/sergej/VSProjects/ReconciliationAI/shared/src/types.ts` | Defines `MappingFieldKey`, `ColumnMapping`, `Grid`, `PreviewTable`, `ColumnStats` |
| `constants.ts` | `/Users/sergej/VSProjects/ReconciliationAI/shared/src/constants.ts` | `CONFIDENCE_THRESHOLD` (0.72), `AI_STRUCTURE_SAMPLE_ROWS` (30) |
| `normalization.ts` | `/Users/sergej/VSProjects/ReconciliationAI/shared/src/normalization.ts` | `parseMoney`, `parseDate`, `normalizeDocNumber`, `columnLetter` |
| `heuristics.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/heuristics.ts` | Keyword-based header row detection + column-to-field mapping |
| `structureAssist.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/ai/structureAssist.ts` | AI (OpenRouter) + heuristic merge for structure detection |
| `client.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/ai/client.ts` | OpenRouter HTTP client with retry/timeout |
| `applyMapping.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/services/applyMapping.ts` | Extracts normalized rows from grid using confirmed mapping |
| `pipeline.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/jobs/pipeline.ts` | Orchestrates stages: parsing -> structure -> confirmation -> extraction |
| `store.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/jobs/store.ts` | In-memory job store, `confirmMapping()` |
| `tableGeometry.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/parsers/tableGeometry.ts` | Column detection from PDF/OCR coordinate data (segments -> grid) |
| `excelParser.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/parsers/excelParser.ts` | XLSX -> grid (handles merged cells) |
| `pdfParser.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/parsers/pdfParser.ts` | Text PDF -> segments -> grid |
| `ocrPipeline.ts` | `/Users/sergej/VSProjects/ReconciliationAI/backend/src/parsers/ocrPipeline.ts` | Scanned PDF -> Tesseract OCR -> segments -> grid |

---

### 2. The Full Flow: Raw File -> Recognized Column Type

#### Phase 1: File Parsing -> Raw Grid

**Excel** (`excelParser.ts` lines 91-116):
- SheetJS reads the workbook, picks the sheet with the most non-empty cells.
- Merged cells are resolved: the master cell's value is propagated to all slave cells.
- Result: `RawSource { grid: CellValue[][], kind: 'excel' }`

**Text PDF** (`pdfParser.ts` lines 182-253):
- pdf.js extracts text items with x/y coordinates.
- Items are clustered into visual lines by baseline Y (`clusterLines`).
- Adjacent items are glued into segments by horizontal gap (`lineToSegments`).
- `assignColumns` (from `tableGeometry.ts`) unifies columns across lines and pages by overlapping x-intervals.
- `segmentsToGrid` produces a string[][] grid.
- If <120 chars/page average, flags `needsOcr: true`.

**OCR PDF** (`ocrPipeline.ts` lines 247-286):
- Page rendered to PNG, preprocessed (grayscale + contrast), fed to Tesseract (rus+eng).
- Words with bounding boxes -> `buildPagesOfLinesFromWords` (clustering by vertical center).
- Same `assignColumns` + `segmentsToGrid` as text PDF.

#### Phase 2: Table Geometry (for PDF/OCR) -- `tableGeometry.ts`

**`assignColumns(pagesOfLines: Segment[][][]): Map<Segment, number>`** (lines 34-130):

This is a purely spatial algorithm. It does NOT look at text content at all:

1. **Phase 1**: Only lines with 2+ segments participate. Each segment is a horizontal interval `[x0, x1]`. For each segment, it tries to assign it to an existing column box (overlapping interval). If overlap > 0, best overlap wins. If no overlap but within `COL_TOLERANCE` (4px), it uses the nearest box. Otherwise a new column box is created.

2. **Phase 2**: Single-segment lines (titles, footers) are assigned to nearest overlapping column.

3. **Renumbering**: Columns are sorted left-to-right and given sequential indices.

4. **Leftover singles** that don't match any column get their own column box.

**`segmentsToGrid`** (lines 133-150): Creates a rectangular grid where each cell is the joined text of segments assigned to that column index.

**Key insight**: Column detection is purely geometric. The grid at this stage contains raw text strings -- no semantic interpretation has happened yet. The grid column indices do NOT correspond to logical fields (docNumber, docDate, etc.).

#### Phase 3: Structure Detection -- The Critical Stage

This happens in `pipeline.ts` line 132 via `assistStructure(source.grid)`:

```typescript
// pipeline.ts line 132
const { mapping, aiUsed } = await assistStructure(source.grid);
```

**`assistStructure`** (`structureAssist.ts` lines 111-187) does this:

1. **Always runs heuristic first**: `analyzeAndMap(grid)` which returns `{ analysis, mapping }`.
2. **Tries AI** if API key is available.
3. **Merges**: AI columns take priority; gaps filled from heuristic.
4. **Falls back to heuristic** on any AI error.

#### Phase 3a: Heuristic Detection -- `heuristics.ts`

This is where the bug lives. Two sub-steps:

**Step A: Find the header row** -- `detectHeaderRow(grid)` (lines 85-112):

Scans the first 20 rows. For each row, tests each cell against a keyword dictionary:

```typescript
const KEYWORDS: HeaderKeyword[] = [
  { re: /^(№|no\.?|n°|#)$/i, weight: 3, field: 'docNumber' },
  { re: /^номер/i, weight: 2, field: 'docNumber' },
  { re: /документ/i, weight: 2 },                          // <-- NO field assignment!
  { re: /^дата\b|^дата$/i, weight: 3, field: 'docDate' }, // <-- THE BUG
  { re: /(?<![\p{L}])сумма(?![\p{L}])/iu, weight: 3, field: 'amount' },
  { re: /дебет/i, weight: 2, field: 'debit' },
  { re: /кредит/i, weight: 2, field: 'credit' },
  { re: /оборот/i, weight: 1 },
  { re: /сальдо/i, weight: 1 },
  { re: /наименование|операция|содержание|назначение|основание/i, weight: 1 },
  { re: /период/i, weight: 1 },
];
```

Each cell is tested against each keyword regex (first match wins). The row's score is the sum of weights. Bonus: `Math.max(0, distinctFields.size - 2) * 2` for rows with multiple distinct field keywords. Threshold: score >= 4 to be considered a header row.

**Step B: Map header cells to fields** -- `heuristicMapping(analysis, headerLine)` (lines 146-214):

Takes the header row's cell values and matches them against a **separate, ordered plan**:

```typescript
const plan: Array<{ field: MappingFieldKey; res: RegExp[] }> = [
  { field: 'docNumber', res: [/^(№|no\.?|n°|#)$/i, /^номер/i] },
  { field: 'docDate', res: [/^дата/i] },
  { field: 'amount', res: [/(?<![\p{L}])сумма(?![\p{L}])/iu] },
  { field: 'debit', res: [/дебет/i] },
  { field: 'credit', res: [/кредит/i] },
];
```

For each field, `pickByHeader` scans columns left-to-right, skipping already-taken columns, and assigns the first column whose header matches the regex.

**`pickByHeader`** (lines 130-140): Simple left-to-right scan with a `taken` set to prevent double-assignment.

**Confidence calculation** (lines 186-204):
- Base: 0.5
- +0.12 per field found by header
- +0.08 if header score >= 6
- Capped at 0.95
- If any required field (`docNumber`, `docDate`, `amount`) is missing, capped at 0.45

#### Phase 3b: AI Detection -- `structureAssist.ts`

Sends the first 30 rows as a JSON array to OpenRouter with a system prompt:
