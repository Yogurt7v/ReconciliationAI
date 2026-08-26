/**
 * Тестовый AI-сервис: извлечение данных из бухгалтерской таблицы.
 *
 * Задача: найти сальдо, обороты, все операции и проверить баланс.
 */

import type { Grid } from '@recon/shared';

import { cellToString } from '../applyMapping.js';
import { type AiConfig, type AiDebugInfo, AiUnavailableError, requestJson } from './client.js';

/* -------------------------------- Типы ----------------------------------- */

export interface Transaction {
  date: string;
  document: string;
  debit: number | null;
  credit: number | null;
}

export interface BalanceCheck {
  expected: number | null;
  actual: number | null;
  match: boolean;
}

export interface DocumentData {
  totalRows: number;
  openingBalance: number | null;
  closingBalance: number | null;
  turnoverDebit: number | null;
  turnoverCredit: number | null;
  balanceCheck: BalanceCheck;
  transactions: Transaction[];
}

export interface TestAnalyzeResult {
  result: DocumentData;
  debug: AiDebugInfo;
}

interface AiTransaction {
  date?: string;
  document?: string;
  debit?: number | null;
  credit?: number | null;
}

interface AiDocumentResponse {
  openingBalance?: number | null;
  closingBalance?: number | null;
  turnoverDebit?: number | null;
  turnoverCredit?: number | null;
  transactions?: AiTransaction[];
}

/* ------------------------------- Промпт ---------------------------------- */

const SYSTEM_PROMPT = `Ты — эксперт по извлечению данных из бухгалтерских таблиц (акты сверки, реестры).

Тебе дают содержимое таблицы как двумерный массив строк (индексация с 0). Каждая строка — массив значений ячеек.

Типичная структура:
- 4 колонки: Дата, Документ, Дебет, Кредит
- Строка "Сальдо начальное" — начальный баланс (сумма в колонке Кредит)
- Строки данных: дата, название документа, сумма дебета ИЛИ кредита
- Строка "Обороты за период" — итоги по дебету и кредиту
- Строка "Сальдо конечное" — конечный баланс (сумма в колонке Кредит)

Извлеки:
1. Сумму "Сальдо начальное" (начальный баланс)
2. Сумму "Сальдо конечное" (конечный баланс)
3. Обороты за период: дебет и кредит
4. Все строки данных (только строки с датой и документом, без итоговых строк)

Важно:
- Суммы могут быть с пробелами как разделитель тысяч: "59 802,47" → 59802.47
- Если сумма пустая, прочерк или отсутствует — верни null
- Даты в формате как в файле (ДД.ММ.ГГ или ДД.ММ.ГГГГ)

Ответь строго JSON без markdown:
{
  "openingBalance": 59802.47,
  "closingBalance": 249746.74,
  "turnoverDebit": 181334.58,
  "turnoverCredit": 371278.85,
  "transactions": [
    { "date": "31.01.26", "document": "Приход (Ф-01-007458 от 31.01.2026)", "debit": null, "credit": 63669.07 },
    { "date": "06.04.26", "document": "Оплата (479 от 06.04.2026)", "debit": 116283.73, "credit": null }
  ]
}`;

/* ----------------------------- Утилиты ----------------------------------- */

function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val !== 'string') return null;

  const cleaned = val
    .replace(/\s/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.\-]/g, '');

  if (!cleaned || cleaned === '-' || cleaned === '.') return null;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/* ----------------------------- Валидация --------------------------------- */

function validateAndBuild(raw: AiDocumentResponse): DocumentData {
  const openingBalance = parseNumber(raw.openingBalance) ?? 0;
  const closingBalance = parseNumber(raw.closingBalance) ?? 0;
  const turnoverDebit = parseNumber(raw.turnoverDebit);
  const turnoverCredit = parseNumber(raw.turnoverCredit);

  const transactions: Transaction[] = Array.isArray(raw.transactions)
    ? raw.transactions
        .filter(
          (t): t is AiTransaction =>
            typeof t === 'object' && t !== null,
        )
        .slice(0, 2000)
        .map((t) => ({
          date: typeof t.date === 'string' ? t.date : '',
          document: typeof t.document === 'string' ? t.document : '',
          debit: parseNumber(t.debit),
          credit: parseNumber(t.credit),
        }))
    : [];

  // Проверка баланса: opening + credit - debit = closing
  let expected: number | null = null;
  let actual: number | null = closingBalance;
  let match = false;

  if (openingBalance !== null && turnoverCredit !== null && turnoverDebit !== null) {
    expected = openingBalance + turnoverCredit - turnoverDebit;
    if (actual !== null) {
      match = Math.abs(expected - actual) < 0.02; // допуск на округление
    }
  }

  return {
    totalRows: transactions.length,
    openingBalance,
    closingBalance,
    turnoverDebit,
    turnoverCredit,
    balanceCheck: { expected, actual, match },
    transactions,
  };
}

/* -------------------------------- API ------------------------------------ */

/**
 * Главная функция: отправляет сетку в AI и извлекает данные документа.
 */
export async function testAnalyze(grid: Grid, config: AiConfig): Promise<TestAnalyzeResult> {
  if (!config.apiKey) {
    throw new AiUnavailableError('OPENROUTER_API_KEY не задан — тестовый анализ недоступен.');
  }

  if (grid.length === 0) {
    throw new AiUnavailableError('Таблица пуста — нечего анализировать.');
  }

  const sampleRows = grid.map((row) => row.map(cellToString));
  const colCount = grid.reduce((m, r) => Math.max(m, r.length), 0);

  const { data: raw, debug } = await requestJson<AiDocumentResponse>(
    config,
    SYSTEM_PROMPT,
    {
      totalRows: grid.length,
      totalColumns: colCount,
      rows: sampleRows,
    },
    90_000,
  );

  const result = validateAndBuild(raw);
  return { result, debug };
}
