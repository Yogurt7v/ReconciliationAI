/**
 * Тестовый AI-сервис: извлечение данных из бухгалтерской таблицы.
 *
 * Задача: найти сальдо, обороты, договоры и проверить баланс.
 * Поддерживает два формата:
 *   1. Простой (ответный акт): сальдо → операции → обороты → сальдо
 *   2. Сложный (двухсторонний): договоры с заголовками, каждый со своими сальдо
 */

import type { Grid } from '@recon/shared';
import { cellToString, TEST_ANALYZE_SAMPLE_ROWS } from '@recon/shared';

import { type AiConfig, type AiDebugInfo, AiUnavailableError, requestJson } from './client.js';

/* -------------------------------- Типы ----------------------------------- */

export interface Transaction {
  date: string;
  document: string;
  debit: number | null;
  credit: number | null;
}

export interface Contract {
  name: string;
  openingBalance: number;
  closingBalance: number;
  turnoverDebit: number | null;
  turnoverCredit: number | null;
  transactions: Transaction[];
}

export interface DocumentData {
  totalRows: number;
  openingBalance: number;
  closingBalance: number;
  turnoverDebit: number | null;
  turnoverCredit: number | null;
  contracts: Contract[];
}

export interface TestAnalyzeResult {
  result: DocumentData;
  debug: AiDebugInfo;
}

/* ----------------------------- AI Types ---------------------------------- */

interface AiTransaction {
  date?: string;
  document?: string;
  debit?: number | null;
  credit?: number | null;
}

interface AiContract {
  name?: string;
  openingBalance?: number | null;
  closingBalance?: number | null;
  turnoverDebit?: number | null;
  turnoverCredit?: number | null;
  transactions?: AiTransaction[];
}

interface AiDocumentResponse {
  openingBalance?: number | null;
  closingBalance?: number | null;
  turnoverDebit?: number | null;
  turnoverCredit?: number | null;
  contracts?: AiContract[];
  transactions?: AiTransaction[];
}

/* ------------------------------- Промпт ---------------------------------- */

const SYSTEM_PROMPT = `Ты — эксперт по извлечению данных из бухгалтерских актов сверки.

Тебе дают содержимое таблицы как двумерный массив строк. Каждая строка — массив значений ячеек.

## Два формата документа:

### Формат 1: Простой (ответный акт)
3-4 колонки: Дата, Документ, Дебет, Кредит.
Нет заголовков договоров. Структура:
- "Сальдо начальное"
- Операции (строки с датой)
- "Обороты за период"
- "Сальдо конечное"

### Формат 2: Сложный (двухсторонний)
8 колонок: левая сторона (колонки 0-3) и правая (колонки 4-7).
Анализируй ТОЛЬКО ЛЕВУЮ СТОРОНУ (колонки 0-3).
Структура:
- "Сальдо начальное" (верхний уровень)
- Строки "Договор №..." — заголовки договоров
- После каждого заголовка: сальдо, операции, обороты по договору, сальдо конечное
- В конце: "Обороты за период" и "Сальдо конечное"

## Правила извлечения:

1. Определи формат по содержимому (есть ли заголовки "Договор №...")
2. Извлеки сальдо начальное и конечное (верхний уровень)
3. Извлеки обороты за период (дебет и кредит)
4. Если формат сложный — извлеки договоры с их сальдо и операциями
5. Если формат простой — верни ОДИН договор с именем "Основной" и всеми операциями

## Важно:
- Суммы с пробелами: "59 802,47" → 59802.47
- Пустая сумма или прочерк → 0
- Даты в формате как в файле
- Строка "Обороты за период" содержит дебет и кредит — смотри по заголовкам колонок таблицы

## Ответ (строго JSON без markdown):

Для сложного формата:
{
  "openingBalance": 1199813494.25,
  "closingBalance": 1121091988.21,
  "turnoverDebit": 21250933.10,
  "turnoverCredit": 99972439.14,
  "contracts": [
    {
      "name": "Договор №24П-069 от 13.05.2024",
      "openingBalance": 515329527.32,
      "closingBalance": 501301564.67,
      "turnoverDebit": 16124095,
      "turnoverCredit": 2096132.35,
      "transactions": [
        { "date": "10.02.26", "document": "Продажа (3 от 10.02.2026)", "debit": 1177600, "credit": null }
      ]
    }
  ]
}

Для простого формата:
{
  "openingBalance": 59802.47,
  "closingBalance": 249746.74,
  "turnoverDebit": 181334.58,
  "turnoverCredit": 371278.85,
  "contracts": [
    {
      "name": "Основной",
      "openingBalance": 59802.47,
      "closingBalance": 249746.74,
      "turnoverDebit": 181334.58,
      "turnoverCredit": 371278.85,
      "transactions": [
        { "date": "31.01.26", "document": "Приход (Ф-01-007458 от 31.01.2026)", "debit": null, "credit": 63669.07 },
        { "date": "28.02.26", "document": "Приход (Ф-02-007236 от 28.02.2026)", "debit": null, "credit": 52614.66 },
        { "date": "31.03.26", "document": "Приход (Ф-03-007763 от 31.03.2026)", "debit": null, "credit": 65050.85 },
        { "date": "06.04.26", "document": "Оплата (479 от 06.04.2026)", "debit": 116283.73, "credit": null },
        { "date": "20.04.26", "document": "Оплата (512 от 17.04.2026)", "debit": 65050.85, "credit": null },
        { "date": "30.04.26", "document": "Приход (Ф-04-008028 от 30.04.2026)", "debit": null, "credit": 60799.18 },
        { "date": "31.05.26", "document": "Приход (Ф-05-008340 от 31.05.2026)", "debit": null, "credit": 64731.98 },
        { "date": "30.06.26", "document": "Приход (Ф-06-008491 от 30.06.2026)", "debit": null, "credit": 64413.11 }
      ]
    }
  ]
}`;

/* ----------------------------- Утилиты ----------------------------------- */

function parseNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val !== 'string') return 0;

  const cleaned = val
    .replace(/\s/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.\-]/g, '');

  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseNumberOrNull(val: unknown): number | null {
  const n = parseNumber(val);
  return n || null;
}

function parseTransactions(raw: AiTransaction[] | undefined): Transaction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is AiTransaction => typeof t === 'object' && t !== null)
    .slice(0, 2000)
    .map((t) => ({
      date: typeof t.date === 'string' ? t.date : '',
      document: typeof t.document === 'string' ? t.document : '',
      debit: parseNumberOrNull(t.debit),
      credit: parseNumberOrNull(t.credit),
    }));
}

/* ----------------------------- Валидация --------------------------------- */

function validateAndBuild(raw: AiDocumentResponse): DocumentData {
  const openingBalance = parseNumber(raw.openingBalance);
  const closingBalance = parseNumber(raw.closingBalance);
  const turnoverDebit = parseNumberOrNull(raw.turnoverDebit);
  const turnoverCredit = parseNumberOrNull(raw.turnoverCredit);

  let contracts: Contract[] = Array.isArray(raw.contracts)
    ? raw.contracts
        .filter((c): c is AiContract => typeof c === 'object' && c !== null)
        .slice(0, 100)
        .map((c) => ({
          name: typeof c.name === 'string' ? c.name : 'Без названия',
          openingBalance: parseNumber(c.openingBalance),
          closingBalance: parseNumber(c.closingBalance),
          turnoverDebit: parseNumberOrNull(c.turnoverDebit),
          turnoverCredit: parseNumberOrNull(c.turnoverCredit),
          transactions: parseTransactions(c.transactions),
        }))
    : [];

  // Если contracts пустой, но есть transactions на верхнем уровне — простой формат
  if (contracts.length === 0 && Array.isArray(raw.transactions) && raw.transactions.length > 0) {
    contracts = [
      {
        name: 'Основной',
        openingBalance,
        closingBalance,
        turnoverDebit,
        turnoverCredit,
        transactions: parseTransactions(raw.transactions),
      },
    ];
  }

  let totalRows = 0;
  for (const c of contracts) {
    totalRows += c.transactions.length;
  }

  return {
    totalRows,
    openingBalance,
    closingBalance,
    turnoverDebit,
    turnoverCredit,
    contracts,
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

  const sampleRows = grid.slice(0, TEST_ANALYZE_SAMPLE_ROWS).map((row) => row.map(cellToString));
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
