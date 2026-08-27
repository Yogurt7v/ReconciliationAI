/**
 * Тестовый AI-сервис: извлечение данных из бухгалтерской таблицы.
 *
 * Задача: найти сальдо, обороты, договоры и проверить баланс.
 * Поддерживает двухсторонние акты сверки — анализирует только левую часть.
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
}

/* ------------------------------- Промпт ---------------------------------- */

const SYSTEM_PROMPT = `Ты — эксперт по извлечению данных из бухгалтерских актов сверки.

Тебе дают содержимое таблицы как двумерный массив строк. Каждая строка — массив значений ячеек.

Формат: двухсторонний акт сверки. Таблица имеет 8 колонок:
- Левая сторона (наши данные): Дата, Документ, Дебет, Кредит (колонки 0-3)
- Правая сторона (данные партнёра): Дата, Документ, Дебет, Кредит (колонки 4-7)

Анализируй ТОЛЬКО ЛЕВУЮ СТОРОНУ (колонки 0-3).

Структура документа:
1. Строка "Сальдо начальное" — верхний уровень (первое число в кредитовой колонке)
2. Строки "Договор №..." — заголовки договоров
3. После заголовка договора: "Сальдо начальное" по договору
4. Строки с датой и документом — операции по договору
5. Строка "Обороты по договору" — итоги по договору
6. Строка "Сальдо конечное" — конечный баланс по договору
7. В конце: "Обороты за период" — общие итоги
8. Последняя строка: "Сальдо конечное" — общий конечный баланс

Извлеки:
1. Верхнее сальдо начальное и конечное
2. Общие обороты за период (дебет и кредит)
3. Список договоров с их сальдо и оборотами
4. Операции по каждому договору (только строки с датой и документом)

Важно:
- Суммы с пробелами: "59 802,47" → 59802.47
- Пустая сумма или прочерк → 0
- Договор без операций — верни пустой массив transactions
- Даты в формате как в файле

Ответь строго JSON без markdown:
{
  "openingBalance": 1199813494.25,
  "closingBalance": 1121091988.21,
  "turnoverDebit": 99972439.14,
  "turnoverCredit": 21250933.10,
  "contracts": [
    {
      "name": "Договор №23КС-226 (адм. штраф) от 27.11.2023",
      "openingBalance": 135000,
      "closingBalance": 135000,
      "turnoverDebit": null,
      "turnoverCredit": null,
      "transactions": []
    },
    {
      "name": "Договор №24П-069 от 13.05.2024",
      "openingBalance": 515329527.32,
      "closingBalance": 501301564.67,
      "turnoverDebit": 16124095,
      "turnoverCredit": 2096132.35,
      "transactions": [
        { "date": "10.02.26", "document": "Продажа (3 от 10.02.2026)", "debit": 1177600, "credit": null },
        { "date": "27.02.26", "document": "Оплата (603 от 26.02.2026)", "debit": null, "credit": 2096132.35 }
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

/* ----------------------------- Валидация --------------------------------- */

function validateAndBuild(raw: AiDocumentResponse): DocumentData {
  const openingBalance = parseNumber(raw.openingBalance);
  const closingBalance = parseNumber(raw.closingBalance);
  const turnoverDebit = parseNumberOrNull(raw.turnoverDebit);
  const turnoverCredit = parseNumberOrNull(raw.turnoverCredit);

  const contracts: Contract[] = Array.isArray(raw.contracts)
    ? raw.contracts
        .filter((c): c is AiContract => typeof c === 'object' && c !== null)
        .slice(0, 100)
        .map((c) => ({
          name: typeof c.name === 'string' ? c.name : 'Без названия',
          openingBalance: parseNumber(c.openingBalance),
          closingBalance: parseNumber(c.closingBalance),
          turnoverDebit: parseNumberOrNull(c.turnoverDebit),
          turnoverCredit: parseNumberOrNull(c.turnoverCredit),
          transactions: Array.isArray(c.transactions)
            ? c.transactions
                .filter((t): t is AiTransaction => typeof t === 'object' && t !== null)
                .slice(0, 2000)
                .map((t) => ({
                  date: typeof t.date === 'string' ? t.date : '',
                  document: typeof t.document === 'string' ? t.document : '',
                  debit: parseNumberOrNull(t.debit),
                  credit: parseNumberOrNull(t.credit),
                }))
            : [],
        }))
    : [];

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
