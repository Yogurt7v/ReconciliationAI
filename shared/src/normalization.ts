/**
 * Нормализация значений, извлечённых из файлов.
 *
 * Требование ТЗ: сравнение сумм строгое, до копейки — поэтому все суммы
 * приводятся к десятичным строкам и дальше работают только через Decimal
 * (см. движок сверки), никогда через Number.
 */

import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/* --------------------------------- Деньги --------------------------------- */

/** Символы-разделители тысяч/десятичных, которые встречаются в документах */
const SPACE_CHARS = /[\u00A0\u202F\u2009\u2007\u2008\u200A ]/g;
const MINUS_LIKE = /[\u2212\u2010-\u2015]/g;

/**
 * Разбор денежного значения в десятичную строку "1234.56" (или null).
 *
 * Поддерживаются:
 *  - "1 234,56", "1 234 567,89" (русский формат)
 *  - "1,234.56" (английский формат)
 *  - "(500,00)" и "500-" — отрицательные суммы в бухгалтерской записи
 *  - "15 000,00 руб.", "1 500 ₽", "$1,000.00" — с валютными обозначениями
 *  - числа (например, значения ячеек Excel)
 *
 * Правило разделителей: если встречаются и "." и "," — последний из них
 * десятичный; если одинаковых несколько — это разделители тысяч.
 */
export function parseMoney(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return new Decimal(input).toDecimalPlaces(2).toFixed(2);
  }
  if (typeof input === 'boolean') return null;

  let s = String(input).trim();
  if (!s) return null;

  // Убираем все виды пробелов: "1 234,56" -> "1234,56"
  s = s.replace(SPACE_CHARS, '');

  // Определяем знак: минус в начале, минус в конце или скобки
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^[-\u2212]/.test(s)) negative = true;
  if (/[-\u2212]$/.test(s)) negative = true;
  s = s.replace(/^[-\u2212]+/, '').replace(/[-\u2212]+$/, '');

  // Убираем всё, кроме цифр и точек/запятых (буквы, ₽, $, № и пр.)
  s = s.replace(MINUS_LIKE, '');
  s = s.replace(/[^0-9.,]/g, '');
  // Крайние точки/запятые — пунктуация предложения ("...руб.", "Итого:")
  s = s.replace(/^[.,]+|[.,]+$/g, '');
  if (!/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    // Есть оба разделителя: тот, что правее — десятичный
    if (lastDot > lastComma) {
      s = s.replace(/,/g, ''); // "1,234.56" -> "1234.56"
    } else {
      s = s.replace(/\./g, ''); // "1.234,56" -> "1234,56"
    }
  } else if (lastComma >= 0) {
    const commaCount = (s.match(/,/g) ?? []).length;
    if (commaCount > 1) {
      s = s.replace(/,/g, ''); // несколько запятых = тысячи
    } else {
      s = s.replace(',', '.'); // одиночная запятая = десятичный разделитель
    }
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }

  if (!/^\d*(\.\d*)?$/.test(s) || !/\d/.test(s)) return null;

  let dec: Decimal;
  try {
    dec = new Decimal(s === '.' ? '0' : s);
  } catch {
    return null;
  }

  // Защита от аномальных значений (больше квадриллиона — почти наверняка мусор)
  if (dec.abs().gte('1e15')) return null;

  const fixed = dec.toDecimalPlaces(2).toFixed(2);
  return negative ? `-${fixed}` : fixed;
}

/**
 * Форматирование десятичной строки в русском денежном формате:
 * "-12345.6" -> "-12 345,60"
 */
export function formatMoney(value: string | null | undefined): string {
  if (!value) return '—';
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    return String(value);
  }
  const neg = d.isNegative();
  const abs = d.abs();
  const [intRaw = '0', fracRaw = '00'] = abs.toFixed(2).split('.');
  const intPart = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  return `${neg ? '\u2212' : ''}${intPart},${fracRaw}`;
}

/* ---------------------------------- Даты ---------------------------------- */

const RU_MONTHS: Record<string, number> = {
  'январ': 0, 'феврал': 1, 'март': 2, 'апрел': 3,
  'ма': 4, 'июн': 5, 'июл': 6, 'август': 7,
  'сентябр': 8, 'октябр': 9, 'ноябр': 10, 'декабр': 11,
};

const EN_MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m, d));
  if (date.getUTCMonth() !== m || date.getUTCDate() !== d) return null;
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function monthFromWord(word: string): number | null {
  const w = word.toLowerCase();
  for (const [key, idx] of Object.entries(RU_MONTHS)) {
    if (w.startsWith(key)) return idx;
  }
  for (const len of [4, 3] as const) {
    const en = w.slice(0, len);
    if (en in EN_MONTHS) return EN_MONTHS[en]!;
  }
  return null;
}

/**
 * Разбор даты в ISO "YYYY-MM-DD".
 * Поддержка: Date, число (серийная дата Excel), "05.03.2026",
 * "2026-03-05", "05/03/26", "5 марта 2026", "Mar 5, 2026" и т.п.
 */
export function parseDate(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;

  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return iso(input.getFullYear(), input.getMonth(), input.getDate());
  }

  if (typeof input === 'number' && Number.isFinite(input)) {
    return excelSerialToIso(input);
  }

  const raw = String(input).trim();
  if (!raw) return null;

  // ISO: 2026-03-05 (возможен хвост времени)
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return iso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // Числовые форматы: dd.mm.yyyy | dd/mm/yyyy | dd-mm-yyyy | короткий год
  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/.exec(raw);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return iso(year, month - 1, day);
  }

  // Словесные месяцы: "5 марта 2026", "05 Марта 2026 г.", "Mar 5, 2026"
  const cleaned = raw.replace(/\u00A0/g, ' ').replace(/\s*г\.?$/i, '').replace(/,/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  for (const t of tokens) {
    if (/^\d{1,2}$/.test(t) && day === null) {
      day = Number(t);
    } else if (/^\d{4}$/.test(t)) {
      year = Number(t);
    } else {
      const mm = monthFromWord(t);
      if (mm !== null && month === null) month = mm;
    }
  }
  if (day !== null && month !== null && year !== null) {
    return iso(year, month, day);
  }

  return null;
}

/** Серийная дата Excel → ISO. База: serial 25569 = 1970-01-01 (учёт бага 1900 года). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 10000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  return iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/* --------------------------- Номера документов ---------------------------- */

const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;

/**
 * Нормализация номера документа для сопоставления:
 * нижний регистр, унификация тире, удаление пробелов и знака №.
 * Исходный номер сохраняется отдельно для отображения пользователю.
 */
export function normalizeDocNumber(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input)
    .replace(/\u00AD/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
  if (!s) return null;
  s = s
    .replace(DASHES, '-')
    .replace(/^[\s№nN°#]+/, '') // ведущие №, #, n°
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^[-/,]+|[-/,]+$/g, ''); // крайняя пунктуация не участвует в ключе
  return s || null;
}

/** Буква колонки Excel по индексу: 0->A, 25->Z, 26->AA */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
