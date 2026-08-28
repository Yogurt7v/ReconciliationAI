import type { ComparisonPair, ComparisonRow, DocType, PairStatus, Transaction } from './api';

export function fmt(val: number | null): string {
  if (val === null) return '---';
  return val.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function detectDocType(doc: string): DocType {
  const lower = doc.toLowerCase();
  if (/продаж|реализ|выпис/.test(lower)) return 'продажа';
  if (/приход|поступл/.test(lower)) return 'приход';
  if (/оплат|перечислен|взнос/.test(lower)) return 'оплата';
  if (/остат|сальдо/.test(lower)) return 'остаток';
  return 'прочее';
}

const DOC_TYPE_MATCH: Record<DocType, DocType> = {
  'продажа': 'приход',
  'приход': 'продажа',
  'оплата': 'оплата',
  'остаток': 'остаток',
  'прочее': 'прочее',
};

export function canMatchTypes(a: DocType, b: DocType): boolean {
  return DOC_TYPE_MATCH[a] === b || a === b;
}

export function buildPairs(rows: ComparisonRow[]): ComparisonPair[] {
  const aRows = rows.filter((r) => r.side === 'A');
  const bRows = rows.filter((r) => r.side === 'B');
  const usedB = new Set<ComparisonRow>();
  const pairs: ComparisonPair[] = [];
  let idx = 0;

  for (const rowA of aRows) {
    const pairB = rowA.matchedWith ? bRows.find((r) => r.tx === rowA.matchedWith) : null;
    if (pairB && rowA.status === 'match') {
      usedB.add(pairB);
      pairs.push({
        index: ++idx,
        pairStatus: 'match',
        typeA: rowA.docType,
        typeB: pairB.docType,
        a: rowA,
        b: pairB,
      });
    } else if (pairB && rowA.status === 'partial') {
      usedB.add(pairB);
      pairs.push({
        index: ++idx,
        pairStatus: 'partial',
        typeA: rowA.docType,
        typeB: pairB.docType,
        a: rowA,
        b: pairB,
        diff: rowA.diff,
      });
    } else {
      pairs.push({
        index: ++idx,
        pairStatus: 'unmatched-a',
        typeA: rowA.docType,
        typeB: 'прочее',
        a: rowA,
        b: null,
      });
    }
  }

  for (const rowB of bRows) {
    if (usedB.has(rowB)) continue;
    pairs.push({
      index: ++idx,
      pairStatus: 'unmatched-b',
      typeA: 'прочее',
      typeB: rowB.docType,
      a: null,
      b: rowB,
    });
  }

  return pairs;
}

export function pairStatusLabel(ps: PairStatus): string {
  switch (ps) {
    case 'match': return 'Совпало';
    case 'partial': return 'Расхождение';
    case 'unmatched-a': return 'Не найдено в контрагенте';
    case 'unmatched-b': return 'Не найдено в нашей стороне';
  }
}

export function pairTypeLabel(a: DocType, b: DocType, ps: PairStatus): string {
  if (ps === 'unmatched-a') return a;
  if (ps === 'unmatched-b') return b;
  if (a === b) return a;
  return `${a} / ${b}`;
}
