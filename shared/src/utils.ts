import type { CellValue } from './types.js';

/** Приведение значения ячейки к строке с нормализацией неразрывных пробелов */
export function cellToString(v: CellValue): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\u00A0/g, ' ').trim();
}

/** Медиана числового массива (0 для пустого) */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
