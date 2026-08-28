/**
 * Извлечение нормализованных строк документа из сырой сетки по маппингу
 * структуры. Все суммы проходят parseMoney (десятичная строка, 2 знака),
 * даты — parseDate (ISO), номера — normalizeDocNumber (ключ сверки).
 */

import Decimal from 'decimal.js';

import { cellToString, MAX_DATA_ROWS, normalizeDocNumber, parseDate, parseMoney } from '@recon/shared';
import type { CellValue, ColumnMapping, Grid, ParsedRow, ParsedSide, RawSource, SideRole } from '@recon/shared';

export { cellToString } from '@recon/shared';

/** Строки-лейблы (сальдо, обороты, итоги) — не являются данными документов */
const LABEL_RE = /^\s*(сальдо\s+(начальн|конеч|на\s+начало|на\s+конец)|оборот[ыа]?\s+(за\s+)?период|оборот[ыа]?\s+по\s+договору|итого)/i;

/** Сумма колонки по извлечённым строкам (для оборотов), либо null */
export function sumColumn(rows: ParsedRow[], key: 'debit' | 'credit'): string | null {
  let any = false;
  const total = rows.reduce((acc, row) => {
    const v = row[key];
    if (v === null || v === undefined) return acc;
    any = true;
    return acc.plus(v);
  }, new Decimal(0));
  return any ? total.toFixed(2) : null;
}

/**
 * Поиск «Сальдо на начало/конец» и оборотов под таблицей данных:
 * строка-метка слева, ближайшее денежное значение правее в той же строке.
 */
export function findBalances(grid: Grid): {
  openingBalance: string | null;
  closingBalance: string | null;
} {
  const out = { openingBalance: null as string | null, closingBalance: null as string | null };

  for (const line of grid) {
    const text = line.map(cellToString).join(' ').toLowerCase();
    if (!/сальдо/.test(text)) continue;

    // Последняя кириллическая ячейка метки — значение ищем правее неё
    let labelEnd = 0;
    for (let c = 0; c < line.length; c++) {
      if (/[а-яё]/i.test(cellToString(line[c] ?? null))) labelEnd = c + 1;
    }

    const grabAllAfter = (): string[] => {
      const found: string[] = [];
      for (let c = labelEnd; c < Math.min(labelEnd + 10, line.length); c++) {
        const money = parseMoney(line[c] ?? null);
        if (money !== null) found.push(money);
      }
      return found;
    };

    const values = grabAllAfter();
    // Fallback: pdf.js может склеить число с текстом ("7 999,99Сальдо конечное")
    if (values.length === 0) {
      for (let c = labelEnd - 1; c >= 0 && c >= labelEnd - 3; c--) {
        const money = parseMoney(line[c] ?? null);
        if (money !== null) { values.push(money); break; }
      }
    }
    if (/начал/.test(text) && out.openingBalance === null) {
      out.openingBalance = values[0] ?? null;
    } else if (/конец|конеч/.test(text) && out.closingBalance === null) {
      out.closingBalance = values[values.length - 1] ?? null;
    }
  }
  return out;
}

/**
 * Главная функция извлечения стороны сверки из сетки.
 *
 * Правила:
 *  - строки без распознаваемого номера пропускаются как итоговые/мусор,
 *    но учитываются в rowsSkipped для прозрачности отчёта;
 *  - если отдельной колонки «Сумма» нет — берём Дебет, иначе Кредит,
 *    допущение фиксируется в assumptions и попадает в логику AI;
 *  - лимит MAX_DATA_ROWS защищает от аномальных файлов.
 */
export function applyMapping(
  source: RawSource,
  mapping: ColumnMapping,
  role: SideRole,
): ParsedSide {
  const assumptions: string[] = [];
  const { columns } = mapping;
  const rows: ParsedRow[] = [];
  let skipped = 0;

  const useDebitCreditFallback =
    columns.amount === null && (columns.debit !== null || columns.credit !== null);
  if (useDebitCreditFallback) {
    assumptions.push(
      'Отдельная колонка «Сумма» в файле не найдена: сумма строки взята из колонок «Дебет»/«Кредит».',
    );
  }

  const get = (line: CellValue[], idx: number | null): CellValue =>
    idx === null ? null : (line[idx] ?? null);

  const start = Math.max(0, mapping.dataStartRowIndex);
  const grid = source.grid;

  for (let r = start; r < grid.length; r++) {
    const line = grid[r] ?? [];

    const docNumberRaw = cellToString(get(line, columns.docNumber));
    const docNumberNorm = normalizeDocNumber(docNumberRaw);

    // Строки-лейблы (сальдо, обороты) — пропускаем даже если есть дата/сумма
    if (LABEL_RE.test(docNumberRaw)) {
      skipped++;
      continue;
    }

    // Строки без номера документа — итоги («Итого», сальдо) или пустые
    if (!docNumberRaw && !docNumberNorm) {
      const hasAnyData = ['docDate', 'amount', 'debit', 'credit'].some(
        (f) => cellToString(get(line, columns[f as keyof typeof columns])) !== '',
      );
      if (hasAnyData) skipped++;
      continue;
    }

    const amountFromCol =
      columns.amount !== null ? parseMoney(get(line, columns.amount)) : null;
    const debit = columns.debit !== null ? parseMoney(get(line, columns.debit)) : null;
    const credit = columns.credit !== null ? parseMoney(get(line, columns.credit)) : null;
    const amount = amountFromCol ?? debit ?? credit;
    const docDate = parseDate(get(line, columns.docDate));

    // Итоговые/служебные строки («Сальдо на начало», «Обороты за период») часто
    // имеют текст в колонке номера. Настоящая строка документа всегда несёт
    // хотя бы дату или сумму — иначе это подпись, а не позиция сверки.
    if (docDate === null && amount === null) {
      skipped++;
      continue;
    }

    rows.push({
      rowIndex: r,
      docNumber: docNumberRaw || null,
      docNumberNorm,
      docDate,
      amount,
      debit,
      credit,
    });

    if (rows.length >= MAX_DATA_ROWS) break;
  }

  const balances = findBalances(grid.slice(start));

  return {
    role,
    meta: {
      fileName: source.fileName,
      kind: source.kind,
      sheetName: source.sheetName ?? null,
      pages: source.pages ?? null,
      rowsExtracted: rows.length,
      rowsSkipped: skipped,
    },
    rows,
    openingBalance: balances.openingBalance,
    closingBalance: balances.closingBalance,
    turnoverDebit: sumColumn(rows, 'debit'),
    turnoverCredit: sumColumn(rows, 'credit'),
    assumptions,
  };
}
