export interface ValidationRuleResult {
  isValid: boolean;
  confidence: number; // 0.0 - 1.0
  reason?: string;
}

export interface SelfConsistencyReport {
  isConsistent: boolean;
  issues: string[];
  overallConfidence: number;
}

/**
 * Валидация даты
 */
export function validateDate(value: string | undefined): ValidationRuleResult {
  if (!value) return { isValid: false, confidence: 0, reason: "Пустое значение" };

  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return { isValid: false, confidence: 0, reason: "Некорректный формат даты" };
  }

  // Проверка на разумный диапазон (1990 - 2030)
  const year = date.getFullYear();
  if (year < 1990 || year > 2030) {
    return { isValid: false, confidence: 0.3, reason: `Подозрительный год: ${year}` };
  }

  return { isValid: true, confidence: 1.0 };
}

/**
 * Валидация суммы
 */
export function validateAmount(value: string | number | undefined): ValidationRuleResult {
  if (value === undefined || value === null || value === '') {
    return { isValid: false, confidence: 0, reason: "Пустое значение" };
  }

  const num = typeof value === 'string' ? parseFloat(value.replace(/\s/g, '').replace(',', '.')) : value;

  if (isNaN(num)) {
    return { isValid: false, confidence: 0, reason: "Не число" };
  }

  if (num < 0) {
    return { isValid: false, confidence: 0.2, reason: "Отрицательная сумма" };
  }

  if (num > 1e12) {
    return { isValid: false, confidence: 0.3, reason: "Подозрительно большая сумма" };
  }

  return { isValid: true, confidence: 1.0 };
}

/**
 * Валидация номера документа
 */
export function validateDocNumber(value: string | undefined): ValidationRuleResult {
  if (!value) return { isValid: false, confidence: 0, reason: "Пустое значение" };

  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return { isValid: false, confidence: 0.2, reason: "Слишком короткий номер" };
  }

  if (trimmed.length > 50) {
    return { isValid: false, confidence: 0.3, reason: "Слишком длинный номер" };
  }

  // Проверка на наличие букв и цифр (эвристика)
  const hasDigits = /\d/.test(trimmed);
  if (!hasDigits) {
    return { isValid: false, confidence: 0.4, reason: "Нет цифр в номере" };
  }

  return { isValid: true, confidence: 0.9 };
}

/**
 * Self-Consistency Check: проверка логической согласованности данных
 */
export function selfConsistencyCheck(rows: any[]): SelfConsistencyReport {
  const issues: string[] = [];
  let confidencePenalty = 0;

  if (rows.length === 0) {
    return { isConsistent: true, issues: [], overallConfidence: 1.0 };
  }

  // 1. Проверка баланса (если есть Дебет/Кредит)
  let totalDebit = 0;
  let totalCredit = 0;
  let hasFinancials = false;

  rows.forEach((row, idx) => {
    const debit = row.debit ? parseFloat(String(row.debit).replace(/,/g, '.').replace(/\s/g, '')) : 0;
    const credit = row.credit ? parseFloat(String(row.credit).replace(/,/g, '.').replace(/\s/g, '')) : 0;

    if (!isNaN(debit) && debit !== 0) { totalDebit += debit; hasFinancials = true; }
    if (!isNaN(credit) && credit !== 0) { totalCredit += credit; hasFinancials = true; }
  });

  if (hasFinancials) {
    const diff = Math.abs(totalDebit - totalCredit);
    const maxVal = Math.max(totalDebit, totalCredit);
    const relativeDiff = maxVal > 0 ? diff / maxVal : 0;

    if (relativeDiff > 0.01) { // Допуск 1%
      issues.push(`Дисбаланс Дебет/Кредит: разница ${relativeDiff.toFixed(2)}%`);
      confidencePenalty += 0.3;
    }
  }

  // 2. Проверка дубликатов номеров документов
  const docNumbers = rows.map(r => r.docNumber).filter(Boolean);
  const uniqueNumbers = new Set(docNumbers);
  if (docNumbers.length !== uniqueNumbers.size) {
    issues.push("Обнаружены дубликаты номеров документов");
    confidencePenalty += 0.1;
  }

  return {
    isConsistent: issues.length === 0,
    issues,
    overallConfidence: Math.max(0, 1.0 - confidencePenalty)
  };
}
