import { describe, expect, it } from 'vitest';

import {
  columnLetter,
  excelSerialToIso,
  formatMoney,
  normalizeDocNumber,
  parseDate,
  parseMoney,
} from '../src/normalization.js';

describe('parseMoney', () => {
  it('русский формат с пробелами и запятой', () => {
    expect(parseMoney('1 234,56')).toBe('1234.56');
    expect(parseMoney('1 234 567,89')).toBe('1234567.89');
    expect(parseMoney('1\u00A0234,56')).toBe('1234.56');
  });

  it('английский формат', () => {
    expect(parseMoney('1,234.56')).toBe('1234.56');
    expect(parseMoney('1,234,567.89')).toBe('1234567.89');
  });

  it('отрицательные суммы: скобки и минус', () => {
    expect(parseMoney('(500,00)')).toBe('-500.00');
    expect(parseMoney('(1 200,50)')).toBe('-1200.50');
    expect(parseMoney('-500,00')).toBe('-500.00');
    expect(parseMoney('500,00-')).toBe('-500.00');
  });

  it('валюта и мусор вокруг числа', () => {
    expect(parseMoney('итого 15 000,00 руб.')).toBe('15000.00');
    expect(parseMoney('1 500 ₽')).toBe('1500.00');
    expect(parseMoney('$1,000.00')).toBe('1000.00');
  });

  it('числа из ячеек Excel', () => {
    expect(parseMoney(1234.56)).toBe('1234.56');
    expect(parseMoney(-0.5)).toBe('-0.50');
    expect(parseMoney(0)).toBe('0.00');
  });

  it('мусор и пустота дают null', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
    expect(parseMoney('—')).toBeNull();
    expect(parseMoney('б/н')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });

  it('одиночная точка трактуется как десятичный разделитель', () => {
    expect(parseMoney('12.5')).toBe('12.50');
    expect(parseMoney('0,00')).toBe('0.00');
  });
});

describe('formatMoney', () => {
  it('русский формат с тонкими пробелами', () => {
    expect(formatMoney('12345.60')).toContain('12\u2009345,60');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('-1000')).toContain('\u22121\u2009000,00');
  });
});

describe('parseDate', () => {
  it('числовые форматы dd.mm.yyyy', () => {
    expect(parseDate('05.03.2026')).toBe('2026-03-05');
    expect(parseDate('5.3.26')).toBe('2026-03-05');
    expect(parseDate('31.12.1999')).toBe('1999-12-31');
  });

  it('слэши и дефисы', () => {
    expect(parseDate('05/03/2026')).toBe('2026-03-05');
    expect(parseDate('05-03-2026')).toBe('2026-03-05');
    expect(parseDate('2026-03-05')).toBe('2026-03-05');
  });

  it('словесные месяцы (рус)', () => {
    expect(parseDate('5 марта 2026')).toBe('2026-03-05');
    expect(parseDate('01 января 2025 г.')).toBe('2025-01-01');
    expect(parseDate('15 Ноября 2024')).toBe('2024-11-15');
  });

  it('словесные месяцы (англ, сокращения)', () => {
    expect(parseDate('Mar 5, 2026')).toBe('2026-03-05');
    expect(parseDate('Sept 1 2025')).toBe('2025-09-01');
  });

  it('серийные даты Excel', () => {
    // 25569 = 1970-01-01 (эталон конвертации)
    expect(excelSerialToIso(25569)).toBe('1970-01-01');
    // 44562 = 2022-01-01
    expect(parseDate(44562)).toBe('2022-01-01');
  });

  it('объект Date', () => {
    expect(parseDate(new Date(2026, 2, 5))).toBe('2026-03-05');
  });

  it('мусор даёт null', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('б/д')).toBeNull();
    expect(parseDate('32.13.2026')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe('normalizeDocNumber', () => {
  it('регистр, пробелы, № не влияют на ключ', () => {
    expect(normalizeDocNumber(' № 123/А-б ')).toBe(normalizeDocNumber('123/а-б'));
    expect(normalizeDocNumber('AB 12')).toBe('ab12');
    expect(normalizeDocNumber('ab-12')).toBe(normalizeDocNumber('AB\u201112'));
  });

  it('разные номера остаются разными', () => {
    expect(normalizeDocNumber('123')).not.toBe(normalizeDocNumber('124'));
  });

  it('пустые значения', () => {
    expect(normalizeDocNumber('')).toBeNull();
    expect(normalizeDocNumber('   ')).toBeNull();
    expect(normalizeDocNumber(null)).toBeNull();
  });

  it('извлечение из скобок: (513 от 17.04.2026)', () => {
    expect(normalizeDocNumber('Оплата (513 от 17.04.2026)')).toBe('513');
    expect(normalizeDocNumber('Продажа (Ф-01-007458 от 31.01.2026)')).toBe('ф-01-007458');
    expect(normalizeDocNumber('20.04.26 Оплата (512 от 17.04.2026)')).toBe('512');
  });

  it('извлечение по №/N/#', () => {
    expect(normalizeDocNumber('Договор №РРО-2023-9218249 от 13.12.2023')).toBe('рро-2023-9218249');
    expect(normalizeDocNumber('№ 513')).toBe('513');
    expect(normalizeDocNumber('# 12345')).toBe('12345');
  });

  it('простые номера без скобок', () => {
    expect(normalizeDocNumber('101')).toBe('101');
    expect(normalizeDocNumber('123/А')).toBe('123/а');
  });
});

describe('parseDate (ведущая дата в строке)', () => {
  it('дата из начала строки с текстом', () => {
    expect(parseDate('20.04.26 Оплата (513 от 17.04.2026)')).toBe('2026-04-20');
    expect(parseDate('31.01.26 Продажа (Ф-01-007458 от 31.01.2026)')).toBe('2026-01-31');
    expect(parseDate('06.04.26 Оплата (479 от 06.04.2026)')).toBe('2026-04-06');
  });

  it('точное совпадение по-прежнему работает', () => {
    expect(parseDate('05.03.2026')).toBe('2026-03-05');
    expect(parseDate('5.3.26')).toBe('2026-03-05');
  });

  it('числа без даты дают null', () => {
    expect(parseDate('15 066,67')).toBeNull();
    expect(parseDate('7 999,99Сальдо')).toBeNull();
  });
});

describe('columnLetter', () => {
  it('индексы в буквы Excel', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(28)).toBe('AC');
  });
});
