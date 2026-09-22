/**
 * Правила валидации извлеченных данных.
 * Используется для Confidence Scoring и Self-Consistency Check.
 */

export interface ValidationResult {
  isValid: boolean;
  confidence: number; // 0-1
  reason?: string;
}

/**
 * Проверяет, является ли строка датой.
 */
export function validateDate(value: string | undefined): ValidationResult {
  if (!value) {
    return { isValid: false, confidence: 0, reason: 'Пустое значение' };
  }
  
  const dateRegex = /^(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})$/;
  const match = value.match(dateRegex);
  
  if (!match) {
    return { isValid: false, confidence: 0, reason: 'Не соответствует формату даты' };
  }
  
  const [, day, month, year] = match;
  const d = parseInt(day!, 10);
  const m = parseInt(month!, 10);
  const y = parseInt(year!, 10);
  
  if (m < 1 || m > 12) {
    return { isValid: false, confidence: 0.3, reason: 'Недопустимый месяц' };
  }
  if (d < 1 || d > 31) {
    return { isValid: false, confidence: 0.3, reason: 'Недопустимый день' };
  }
  if (y < 1900 || y > 2100) {
    return { isValid: false, confidence: 0.5, reason: 'Подозрительный год' };
  }
  
  return { isValid: true, confidence: 1.0 };
}

/**
 * Проверяет, является ли строка суммой (числом).
 */
export function validateAmount(value: string | undefined): ValidationResult {
  if (!value) {
    return { isValid: false, confidence: 0, reason: 'Пустое значение' };
  }
  
  const amountRegex = /^-?\s*\d{1,3}(?:[ \u00A0]?\d{3})*(?:[.,]\d{1,4})?$/;
  
  if (!amountRegex.test(value)) {
    return { isValid: false, confidence: 0, reason: 'Не соответствует формату суммы' };
  }
  
  const normalized = value.replace(/[ \u00A0]/g, '').replace(',', '.');
  const num = parseFloat(normalized);
  
  if (isNaN(num)) {
    return { isValid: false, confidence: 0, reason: 'Не удалось преобразовать в число' };
  }
  
  if (Math.abs(num) > 1e12) {
    return { isValid: false, confidence: 0.3, reason: 'Аномально большая сумма' };
  }
  
  return { isValid: true, confidence: 1.0 };
}

/**
 * Проверяет, является ли строка номером документа.
 */
export function validateDocNumber(value: string | undefined): ValidationResult {
  if (!value) {
    return { isValid: false, confidence: 0, reason: 'Пустое значение' };
  }
  
  const docNumberRegex = /^[A-Za-zА-Яа-я0-9\-/\s]{2,50}$/;
  
  if (!docNumberRegex.test(value.trim())) {
    return { isValid: false, confidence: 0.3, reason: 'Подозрительный формат номера' };
  }
  
  if (value.trim().length < 3) {
    return { isValid: false, confidence: 0.5, reason: 'Слишком короткий номер' };
  }
  
  return { isValid: true, confidence: 0.9 };
}

/**
 * Self-Consistency Check: проверка согласованности данных.
 */
export function selfConsistencyCheck(data: {
  openingBalance: number;
  closingBalance: number;
  turnoverDebit: number | null;
  turnoverCredit: number | null;
  contracts: Array<{ openingBalance: number; closingBalance: number; turnoverDebit: number | null; turnoverCredit: number | null }>;
}): Array<{ check: string; passed: boolean; diff?: number }> {
  const results: Array<{ check: string; passed: boolean; diff?: number }> = [];
  
  if (data.turnoverDebit !== null && data.turnoverCredit !== null) {
    const expectedClosing = data.openingBalance + data.turnoverDebit - data.turnoverCredit;
    const diff = Math.abs(expectedClosing - data.closingBalance);
    results.push({
      check: 'Баланс: Closing = Opening + Debit - Credit',
      passed: diff < 0.02,
      diff,
    });
  }
  
  const totalOpening = data.contracts.reduce((sum, c) => sum + c.openingBalance, 0);
  const totalClosing = data.contracts.reduce((sum, c) => sum + c.closingBalance, 0);
  
  results.push({
    check: 'Сумма сальдо начального по договорам',
    passed: Math.abs(totalOpening - data.openingBalance) < 0.02,
    diff: Math.abs(totalOpening - data.openingBalance),
  });
  
  results.push({
    check: 'Сумма сальдо конечного по договорам',
    passed: Math.abs(totalClosing - data.closingBalance) < 0.02,
    diff: Math.abs(totalClosing - data.closingBalance),
  });
  
  const hasContractTurnovers = data.contracts.some(c => c.turnoverDebit !== null || c.turnoverCredit !== null);
  if (hasContractTurnovers) {
    const totalDebit = data.contracts.reduce((sum, c) => sum + (c.turnoverDebit ?? 0), 0);
    const totalCredit = data.contracts.reduce((sum, c) => sum + (c.turnoverCredit ?? 0), 0);
    
    if (data.turnoverDebit !== null) {
      results.push({
        check: 'Сумма оборота дебет по договорам',
        passed: Math.abs(totalDebit - data.turnoverDebit) < 0.02,
        diff: Math.abs(totalDebit - data.turnoverDebit),
      });
    }
    
    if (data.turnoverCredit !== null) {
      results.push({
        check: 'Сумма оборота кредит по договорам',
        passed: Math.abs(totalCredit - data.turnoverCredit) < 0.02,
        diff: Math.abs(totalCredit - data.turnoverCredit),
      });
    }
  }
  
  return results;
}
