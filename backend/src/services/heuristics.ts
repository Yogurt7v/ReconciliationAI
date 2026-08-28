/**
 * Эвристическое определение структуры таблицы (до/независимо от AI).
 *
 * Стратегия:
 *  1. Ищем строку шапки в первых 20 строках по словарю бухгалтерских
 *     заголовков («№», «Дата», «Сумма», «Дебет», «Кредит»…).
 *  2. По заголовкам определяем колонки полей.
 *  3. Считаем статистику колонок (доля чисел, дат, заполненность) — она нужна
 *     и для confidence, и для экрана подтверждения у пользователя.
 */

import { cellToString, columnLetter, parseDate, parseMoney } from '@recon/shared';
import type { CellValue, ColumnMapping, ColumnStats, Grid, MappingFieldKey, PreviewTable } from '@recon/shared';

interface HeaderKeyword {
  re: RegExp;
  weight: number;
  field?: MappingFieldKey;
}

// Словарь заголовков; поле привязывается к первому подходящему столбцу
const KEYWORDS: HeaderKeyword[] = [
  { re: /^(№|no\.?|n°|#)$/i, weight: 3, field: 'docNumber' },
  { re: /^номер/i, weight: 2, field: 'docNumber' },
  { re: /документ/i, weight: 2 },
  { re: /^дата\b|^дата$/i, weight: 3, field: 'docDate' },
  { re: /(?<![\p{L}])сумма(?![\p{L}])/iu, weight: 3, field: 'amount' },
  { re: /дебет/i, weight: 2, field: 'debit' },
  { re: /кредит/i, weight: 2, field: 'credit' },
  { re: /оборот/i, weight: 1 },
  { re: /сальдо/i, weight: 1 },
  { re: /наименование|операция|содержание|назначение|основание/i, weight: 1 },
  { re: /период/i, weight: 1 },
];

export interface GridAnalysis {
  headerRowIndex: number | null;
  headerScore: number;
  /** Индекс первой строки данных (после шапки), либо 0 */
  dataStartRowIndex: number;
  stats: ColumnStats[];
}

/** Считаем статистику колонок в области данных */
export function columnStats(grid: Grid, fromRow: number): ColumnStats[] {
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const stats: ColumnStats[] = [];
  for (let c = 0; c < width; c++) {
    let filled = 0;
    let numeric = 0;
    let dateLike = 0;
    const samples: string[] = [];
    let dataRows = 0;
    for (let r = fromRow; r < grid.length; r++) {
      const raw = grid[r]?.[c] ?? null;
      const s = cellToString(raw);
      if (!s && raw === null) continue;
      dataRows++;
      if (s) {
        filled++;
        if (typeof raw === 'number' || parseMoney(s) !== null) numeric++;
        if (parseDate(raw) !== null) dateLike++;
        if (samples.length < 3 && !samples.includes(s.slice(0, 24))) samples.push(s.slice(0, 24));
      }
    }
    stats.push({
      index: c,
      letter: columnLetter(c),
      header: null,
      fillRatio: dataRows ? filled / dataRows : 0,
      numericRatio: filled ? numeric / filled : 0,
      dateLikeRatio: filled ? dateLike / filled : 0,
      samples,
    });
  }
  return stats;
}

/** Поиск строки шапки по ключевым словам */
export function detectHeaderRow(grid: Grid): { index: number | null; score: number } {
  const limit = Math.min(grid.length, 20);
  let bestIndex: number | null = null;
  let bestScore = 0;
  for (let r = 0; r < limit; r++) {
    const line = grid[r] ?? [];
    let score = 0;
    let distinctFields = new Set<MappingFieldKey>();
    for (const value of line) {
      const s = cellToString(value);
      if (!s || s.length > 40) continue;
      for (const kw of KEYWORDS) {
        if (kw.re.test(s)) {
          score += kw.weight;
          if (kw.field) distinctFields.add(kw.field);
          break;
        }
      }
    }
    // Бонус за несколько разных полей в одной строке — признак настоящей шапки
    score += Math.max(0, distinctFields.size - 2) * 2;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = r;
    }
  }
  return bestScore >= 4 ? { index: bestIndex, score: bestScore } : { index: null, score: bestScore };
}

/** Полный анализ сетки */
export function analyzeGrid(grid: Grid): GridAnalysis {
  const { index, score } = detectHeaderRow(grid);
  const headerRowIndex = index ?? 0;
  const dataStartRowIndex = Math.min(headerRowIndex + 1, Math.max(0, grid.length - 1));
  const stats = columnStats(grid, dataStartRowIndex);

  // Подписываем заголовки в статистику
  if (index !== null) {
    const line = grid[index] ?? [];
    for (const st of stats) st.header = cellToString(line[st.index] ?? null) || null;
  }
  return { headerRowIndex: index, headerScore: score, dataStartRowIndex, stats };
}

/** Подбор колонки под заголовок-регэксп (первый свободный слева) */
function pickByHeader(
  headers: string[],
  re: RegExp,
  taken: Set<number>,
): number | null {
  for (let c = 0; c < headers.length; c++) {
    if (taken.has(c)) continue;
    if (re.test(headers[c] ?? '')) return c;
  }
  return null;
}

/**
 * Эвристический маппинг полей по шапке.
 * Возвращает готовый ColumnMapping с объяснениями на русском.
 */
export function heuristicMapping(analysis: GridAnalysis, headerLine?: CellValue[], grid?: Grid): ColumnMapping {
  const reasoning: string[] = [];
  const columns: Record<MappingFieldKey, number | null> = {
    docNumber: null,
    docDate: null,
    amount: null,
    debit: null,
    credit: null,
  };

  const hdrs =
    analysis.headerRowIndex !== null
      ? (headerLine ?? []).map((v) => cellToString(v))
      : [];
  const taken = new Set<number>();

  const plan: Array<{ field: MappingFieldKey; res: RegExp[] }> = [
    { field: 'docNumber', res: [/^(№|no\.?|n°|#)$/i, /^номер/i] },
    { field: 'docDate', res: [/^дата/i] },
    { field: 'amount', res: [/(?<![\p{L}])сумма(?![\p{L}])/iu] },
    { field: 'debit', res: [/дебет/i] },
    { field: 'credit', res: [/кредит/i] },
  ];

  let foundByHeader = 0;
  for (const { field, res } of plan) {
    for (const re of res) {
      const idx = pickByHeader(hdrs, re, taken);
      if (idx !== null) {
        columns[field] = idx;
        taken.add(idx);
        foundByHeader++;
        reasoning.push(
          `Колонка ${columnLetter(idx)} («${hdrs[idx]}») определена как «${fieldLabel(field)}» по заголовку.`,
        );
        break;
      }
    }
  }

  let confidence = 0.5 + foundByHeader * 0.12;
  if (analysis.headerScore >= 6) {
    confidence += 0.08;
    reasoning.push(
      `Строка ${analysis.headerRowIndex !== null ? analysis.headerRowIndex + 1 : 1} распознана как шапка таблицы: найдено несколько бухгалтерских заголовков.`,
    );
  }
  confidence = Math.min(confidence, 0.95);

  // Обязательные поля отсутствуют → проверяем комбинированные колонки
  // Если нет колонки docNumber, но есть docDate — проверяем, содержат ли данные
  // комбинированные строки вида "20.04.26 Оплата (513 от 17.04.2026)"
  if (grid && columns.docNumber === null && columns.docDate !== null) {
    const sampleRows = grid.slice(
      analysis.dataStartRowIndex,
      analysis.dataStartRowIndex + 10,
    );
    const combinedPattern = /\([^)]*\d[^)]*\)/;
    const combinedHits = sampleRows.filter((row: CellValue[]) => {
      const cell = cellToString(row[columns.docDate!] ?? null);
      return combinedPattern.test(cell);
    }).length;
    if (combinedHits >= 2) {
      columns.docNumber = columns.docDate;
      confidence = Math.max(confidence, 0.65);
      reasoning.push(
        `Номер документа извлечён из комбинированной строки «Дата Документ» (${combinedHits} из ${sampleRows.length} строк содержат номер в скобках).`,
      );
    }
  }

  // Пересчитываем обязательные поля после комбинированного маппинга
  const missingAfter = (['docNumber', 'docDate', 'amount'] as MappingFieldKey[]).filter(
    (f) => columns[f] === null,
  );
  if (missingAfter.length > 0) {
    confidence = Math.min(confidence, 0.45);
    reasoning.push(
      `Не найдены обязательные колонки: ${missingAfter.map(fieldLabel).join(', ')}. Требуется уточнение.`,
    );
  }

  return {
    headerRowIndex: analysis.headerRowIndex ?? 0,
    dataStartRowIndex: analysis.dataStartRowIndex,
    columns,
    confidence,
    source: 'heuristic',
    reasoning,
  };
}

function fieldLabel(f: MappingFieldKey): string {
  const labels: Record<MappingFieldKey, string> = {
    docNumber: 'Номер документа',
    docDate: 'Дата',
    amount: 'Сумма',
    debit: 'Дебет',
    credit: 'Кредит',
  };
  return labels[f];
}

// Заголовки последнего анализа удалены — передаются параметром

/** Удобная обёртка: анализ + маппинг одним вызовом */
export function analyzeAndMap(grid: Grid): { analysis: GridAnalysis; mapping: ColumnMapping } {
  const analysis = analyzeGrid(grid);
  const headerLine = grid[analysis.headerRowIndex ?? 0] ?? [];
  const mapping = heuristicMapping(analysis, headerLine, grid);
  return { analysis, mapping };
}

/** Превью таблицы для экрана подтверждения структуры */
export function buildPreview(grid: Grid, analysis: GridAnalysis, maxRows = 12): PreviewTable {
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const headerIdx = analysis.headerRowIndex ?? 0;
  const headers = Array.from({ length: width }, (_, i) => {
    const v = grid[headerIdx]?.[i];
    return v === undefined ? null : cellToString(v) || null;
  });
  const rows = grid
    .slice(headerIdx + 1, headerIdx + 1 + maxRows)
    .map((line) => Array.from({ length: width }, (_, i) => cellToString(line[i] ?? null)));
  return {
    headers,
    columnLetters: Array.from({ length: width }, (_, i) => columnLetter(i)),
    rows,
    stats: analysis.stats,
    totalRows: Math.max(0, grid.length - headerIdx - 1),
  };
}
