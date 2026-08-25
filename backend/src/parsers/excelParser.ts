/**
 * Парсер Excel (XLSX/XLS) на базе SheetJS.
 *
 * Особенности, которые обрабатываем (по ТЗ):
 *  - объединённые ячейки: значение мастер-ячейки протягивается на всю область;
 *  - шапка может стоять не в первой строке (титул акта сверки выше);
 *  - пустые строки/столбцы обрезаются по краям сетки.
 */

import * as XLSX from 'xlsx';

import type { CellValue, Grid, RawSource } from '@recon/shared';

interface XlsxCell {
  v?: unknown;
  w?: string;
}

/** Приведение значения ячейки к CellValue */
function coerceValue(raw: unknown): CellValue {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (Array.isArray(raw)) {
    // richText: [{text}, ...]
    const joined = raw.map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '')).join('');
    return joined || null;
  }
  if (typeof raw === 'object') return null;
  return String(raw);
}

function rawCell(sheet: XLSX.WorkSheet, r: number, c: number): XlsxCell | undefined {
  return sheet[XLSX.utils.encode_cell({ r, c })] as XlsxCell | undefined;
}

/** Лист → сетка с учётом объединённых ячеек */
export function sheetToGrid(sheet: XLSX.WorkSheet): { grid: Grid; filledCells: number } {
  const ref = sheet['!ref'];
  if (!ref) return { grid: [], filledCells: 0 };

  const range = XLSX.utils.decode_range(ref);

  // Карта «slave → master» для объединённых областей
  const masterValues = new Map<string, CellValue>();
  const merges = (sheet['!merges'] ?? []) as XLSX.Range[];
  for (const area of merges) {
    const masterVal = coerceValue(rawCell(sheet, area.s.r, area.s.c)?.v);
    for (let r = area.s.r; r <= area.e.r; r++) {
      for (let c = area.s.c; c <= area.e.c; c++) {
        if (r === area.s.r && c === area.s.c) continue;
        masterValues.set(`${r}:${c}`, masterVal);
      }
    }
  }

  const grid: Grid = [];
  let filledCells = 0;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const line: CellValue[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const own = coerceValue(rawCell(sheet, r, c)?.v);
      const value: CellValue = own ?? masterValues.get(`${r}:${c}`) ?? null;
      if (value !== null && value !== '') filledCells++;
      line.push(value);
    }
    grid.push(line);
  }
  return { grid, filledCells };
}

/** Обрезка полностью пустых строк и столбцов по краям сетки */
export function trimGrid(grid: Grid): Grid {
  let top = 0;
  let bottom = grid.length - 1;
  const rowEmpty = (r: number) => (grid[r] ?? []).every((v) => v === null || v === '');
  while (top <= bottom && rowEmpty(top)) top++;
  while (bottom >= top && rowEmpty(bottom)) bottom--;
  const rows = grid.slice(top, bottom + 1);
  if (rows.length === 0) return [];

  let right = (rows[0]?.length ?? 0) - 1;
  const colEmpty = (c: number) => rows.every((row) => (row[c] ?? null) === null || row[c] === '');
  while (right >= 0 && colEmpty(right)) right--;
  return rows.map((row) => row.slice(0, right + 1));
}

/**
 * Разбор буфера Excel. Выбирается лист с максимальным числом непустых ячеек —
 * в файлах бухгалтерии данные почти всегда на первом содержательном листе.
 */
export function parseExcel(buffer: Buffer, fileName: string): RawSource {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });

  let bestName: string | null = null;
  let bestGrid: Grid = [];
  let bestFilled = -1;

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const { grid: rawGrid, filledCells } = sheetToGrid(sheet);
    if (filledCells > bestFilled) {
      bestFilled = filledCells;
      bestName = name;
      bestGrid = rawGrid;
    }
  }

  return {
    grid: trimGrid(bestGrid),
    kind: 'excel',
    fileName,
    sheetName: bestName,
    pages: null,
  };
}
