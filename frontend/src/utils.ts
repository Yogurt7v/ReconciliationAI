export function fmt(val: number | null): string {
  if (val === null) return '---';
  return val.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
