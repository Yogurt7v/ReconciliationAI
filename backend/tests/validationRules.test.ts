/**
 * Тесты правил валидации: даты, суммы, номера документов и self-consistency
 * сальдо/оборотов (используются в testAnalyze для предупреждений).
 */

import { describe, expect, it } from 'vitest';

import {
  selfConsistencyCheck,
  validateAmount,
  validateDate,
  validateDocNumber,
} from '../src/services/validationRules.js';

describe('validateDate', () => {
  it('принимает корректные даты в разных разделителях', () => {
    expect(validateDate('05.03.2026').isValid).toBe(true);
    expect(validateDate('5/3/2026').isValid).toBe(true);
    expect(validateDate('05-03-2026').isValid).toBe(true);
  });

  it('отклоняет мусор и некорректные компоненты', () => {
    expect(validateDate('foo').isValid).toBe(false);
    expect(validateDate('05.13.2026').isValid).toBe(false); // месяца 13 нет
    expect(validateDate('32.01.2026').isValid).toBe(false); // дня 32 нет
    expect(validateDate('05.03.1899').isValid).toBe(false); // слишком старый год
    expect(validateDate('').isValid).toBe(false);
  });
});

describe('validateAmount', () => {
  it('принимает суммы с пробелами и запятой', () => {
    expect(validateAmount('15000,00').isValid).toBe(true);
    expect(validateAmount('59 802,47').isValid).toBe(true);
    expect(validateAmount('1 000 000').isValid).toBe(true);
    expect(validateAmount('-500').isValid).toBe(true);
    expect(validateAmount('1234.56').isValid).toBe(true);
  });

  it('отклоняет не-числа и научную нотацию', () => {
    expect(validateAmount('abc').isValid).toBe(false);
    expect(validateAmount('1e5').isValid).toBe(false);
    expect(validateAmount('--5').isValid).toBe(false);
    expect(validateAmount('').isValid).toBe(false);
  });
});

describe('validateDocNumber', () => {
  it('принимает нормальные номера документов', () => {
    expect(validateDocNumber('101').isValid).toBe(true);
    expect(validateDocNumber('A-123/2026').isValid).toBe(true);
    expect(validateDocNumber('ФАКТУРА-45').isValid).toBe(true);
  });

  it('отклоняет слишком короткие и подозрительные номера', () => {
    expect(validateDocNumber('1').isValid).toBe(false);
    expect(validateDocNumber('').isValid).toBe(false);
  });
});

describe('selfConsistencyCheck', () => {
  const base = {
    openingBalance: 100,
    closingBalance: 150,
    turnoverDebit: 100,
    turnoverCredit: 50,
    contracts: [
      { openingBalance: 100, closingBalance: 150, turnoverDebit: 100, turnoverCredit: 50 },
    ],
  };

  it('согласованные данные проходят все проверки', () => {
    const checks = selfConsistencyCheck(base);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it('расхождение конечного сальдо помечается как провал', () => {
    const checks = selfConsistencyCheck({
      ...base,
      closingBalance: 999,
      contracts: [{ ...base.contracts[0]!, closingBalance: 999 }],
    });
    expect(checks.some((c) => !c.passed)).toBe(true);
  });
});