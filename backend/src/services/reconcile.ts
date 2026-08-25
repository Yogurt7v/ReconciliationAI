/**
 * Детерминированный движок сверки. Никакого AI — только точная арифметика
 * (decimal.js) и строгое сравнение до копейки.
 *
 * Алгоритм (ТЗ):
 *  1. Документы сопоставляются по нормализованному номеру.
 *  2. Каждый экземпляр документа — отдельная позиция: дубли допустимы и
 *     образуют мультимножество. Внутри группы пары соединяются по порядку
 *     (сортировка по дате, затем по исходной строке).
 *  3. Непарные остатки → «только у нас» / «только у контрагента».
 *  4. Пары: суммы ≠ → расхождение сумм; суммы = , даты ≠ → расхождение дат.
 */

import Decimal from 'decimal.js';

import type {
  AmountMismatchItem,
  DateMismatchItem,
  OnlyItem,
  ParsedRow,
  ParsedSide,
} from '@recon/shared';

export interface MatchedPair {
  ours: ParsedRow;
  partner: ParsedRow;
}

export interface ReconcileCoreResult {
  matchedPairs: MatchedPair[];
  onlyOurs: OnlyItem[];
  onlyPartner: OnlyItem[];
  amountMismatches: AmountMismatchItem[];
  dateMismatches: DateMismatchItem[];
}

function groupByNumber(rows: ParsedRow[]): Map<string, ParsedRow[]> {
  const map = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    if (!row.docNumberNorm) continue;
    const bucket = map.get(row.docNumberNorm);
    if (bucket) bucket.push(row);
    else map.set(row.docNumberNorm, [row]);
  }
  return map;
}

/** Сортировка внутри группы дублей: по дате, затем по исходной строке файла */
function byDateThenRow(a: ParsedRow, b: ParsedRow): number {
  const da = a.docDate ?? '9999-12-31';
  const dbb = b.docDate ?? '9999-12-31';
  if (da !== dbb) return da < dbb ? -1 : 1;
  return a.rowIndex - b.rowIndex;
}

function toOnlyItem(row: ParsedRow): OnlyItem {
  return {
    docNumber: row.docNumber,
    docDate: row.docDate,
    amount: row.amount,
    sourceRowIndex: row.rowIndex,
  };
}

/** Строгое сравнение до копейки; null с любой стороны — сравнить нельзя */
function amountsEqual(a: string | null, b: string | null): boolean | null {
  if (a === null || b === null) return null;
  return new Decimal(a).equals(new Decimal(b));
}

function datesDiffer(a: string | null, b: string | null): boolean {
  // Отсутствие даты с одной стороны тоже считаем расхождением поля «Дата»
  return a !== b;
}

/**
 * Основная функция сверки двух разобранных сторон.
 * Чистая: не мутирует входные данные, результат детерминирован.
 */
export function reconcileSides(ours: ParsedSide, partner: ParsedSide): ReconcileCoreResult {
  const result: ReconcileCoreResult = {
    matchedPairs: [],
    onlyOurs: [],
    onlyPartner: [],
    amountMismatches: [],
    dateMismatches: [],
  };

  const ourGroups = groupByNumber(ours.rows);
  const partnerGroups = groupByNumber(partner.rows);

  for (const [key, ourRowsRaw] of ourGroups) {
    const partnerRows = partnerGroups.get(key);

    if (!partnerRows) {
      // Документ есть только у нас (все экземпляры)
      for (const r of [...ourRowsRaw].sort(byDateThenRow)) result.onlyOurs.push(toOnlyItem(r));
      continue;
    }

    const ourRows = [...ourRowsRaw].sort(byDateThenRow);
    const theirRows = [...partnerRows].sort(byDateThenRow);

    const pairCount = Math.min(ourRows.length, theirRows.length);
    for (let i = 0; i < pairCount; i++) {
      const a = ourRows[i]!;
      const b = theirRows[i]!;
      result.matchedPairs.push({ ours: a, partner: b });
      classifyPair(result, key, a, b);
    }

    // Непарные экземпляры из-за разного количества дублей
    for (let i = pairCount; i < ourRows.length; i++) result.onlyOurs.push(toOnlyItem(ourRows[i]!));
    for (let i = pairCount; i < theirRows.length; i++) {
      result.onlyPartner.push(toOnlyItem(theirRows[i]!));
    }
  }

  // Ключи, которых нет у нас вообще
  for (const [key, rows] of partnerGroups) {
    if (ourGroups.has(key)) continue;
    for (const r of [...rows].sort(byDateThenRow)) result.onlyPartner.push(toOnlyItem(r));
  }

  return result;
}

function classifyPair(
  result: ReconcileCoreResult,
  _key: string,
  a: ParsedRow,
  b: ParsedRow,
): void {
  const eq = amountsEqual(a.amount, b.amount);
  const dDiff = datesDiffer(a.docDate, b.docDate);

  if (eq === false) {
    const difference =
      a.amount !== null && b.amount !== null
        ? new Decimal(a.amount).minus(b.amount).toFixed(2)
        : null;
    result.amountMismatches.push({
      docNumber: a.docNumber ?? b.docNumber,
      docDateOurs: a.docDate,
      docDatePartner: b.docDate,
      ourAmount: a.amount,
      partnerAmount: b.amount,
      difference,
      direction:
        difference === null
          ? 'unknown'
          : new Decimal(difference).greaterThan(0)
            ? 'they_owe'
            : 'we_owe',
      dateMismatch: dDiff,
    });
  } else if (dDiff) {
    // Суммы совпали (или не сравнимы), но дата различается
    result.dateMismatches.push({
      docNumber: a.docNumber ?? b.docNumber,
      ourDate: a.docDate,
      partnerDate: b.docDate,
      amount: a.amount ?? b.amount,
    });
  }
}
