/**
 * AI-парсинг двухсторонних актов сверки.
 *
 * Отправляет текст PDF модели, которая возвращает структурированный JSON
 * с данными обеих сторон. Затем конвертирует ответ в два ParsedSide-объекта,
 * совместимых с существующим пайплайном сверки.
 */

import Decimal from 'decimal.js';

import {
  normalizeDocNumber,
  parseDate,
  parseMoney,
} from '@recon/shared';
import type { AiStructuredResult, ParsedRow, ParsedSide } from '@recon/shared';

import { AiUnavailableError, type AiConfig, requestJson } from './client.js';

/* -------------------------------------------------------------------------- */
/*                                  Prompt                                    */
/* -------------------------------------------------------------------------- */

const SYSTEM_PROMPT = `Ты — эксперт по извлечению данных из финансовых документов.
Твоя задача — распарсить акт сверки взаимных расчётов и вернуть JSON.

Входной текст — содержимое PDF-файла с таблицей акта сверки.

Типичная структура акта сверки:
- Титул: номер акта, период, реквизиты сторон (название, ИНН).
- Таблица: столбцы разделены на две половины — данные первой стороны и данные второй стороны.
  Каждая сторона: Дата, Документ (номер/описание), Дебет, Кредит (или Сумма).
- Под таблицей: строки «Сальдо начальное», «Обороты за период», «Сальдо конечное».
  Это СТРОКИ-ИТОГИ, а не данные документов. Не включай их в массив rows.

Правила:
- «Сальдо начальное/конечное» и «Обороты за период» — это строки-итоги.
  Их значения идут в отдельные поля (opening_balance, turnovers, closing_balance),
  а НЕ в массив rows.
- Даты: формат ДД.ММ.ГГГГ или ДД.ММ.ГГ.
- Суммы: числа с точкой как разделителем (3066.67, не 3 066,67).
- Если значение отсутствует — используй null.
- Первая сторона (party_1) — та, чьи колонки идут левее в таблице.
- Вторая сторона (party_2) — та, чьи колонки идут правее.

Определи:
- act_number: номер акта (строка).
- period: { start, end } — даты в формате ДД.ММ.ГГГГ или null.
- party_1, party_2: { name, inn } — наименование и ИНН (null если не найдены).
- table.rows: массив операций. Каждая строка:
  { date, document, party_1_debit, party_1_credit, party_2_debit, party_2_credit }.
  Все суммовые поля — числа или null.
- table.opening_balance: { party_1, party_2 } — числа или null.
- table.turnovers: { party_1_debit, party_1_credit, party_2_debit, party_2_credit } — числа.
- table.closing_balance: { party_1, party_2 } — числа или null.
- text_summary: текстовое заключение о задолженности (строка или null).

Отвечай строго JSON без markdown.`;

/* -------------------------------------------------------------------------- */
/*                            AI response types                               */
/* -------------------------------------------------------------------------- */

interface AiTableSummary {
  party_1: number | null;
  party_2: number | null;
}

interface AiTurnovers {
  party_1_debit: number | null;
  party_1_credit: number | null;
  party_2_debit: number | null;
  party_2_credit: number | null;
}

interface AiRow {
  date: string | null;
  document: string | null;
  party_1_debit: number | null;
  party_1_credit: number | null;
  party_2_debit: number | null;
  party_2_credit: number | null;
}

interface AiParty {
  name: string | null;
  inn: string | null;
}

interface AiPeriod {
  start: string | null;
  end: string | null;
}

export interface AiStructuredResponse {
  act_number: string | null;
  period: AiPeriod | null;
  party_1: AiParty | null;
  party_2: AiParty | null;
  table: {
    rows: AiRow[];
    opening_balance: AiTableSummary | null;
    turnovers: AiTurnovers | null;
    closing_balance: AiTableSummary | null;
  } | null;
  text_summary: string | null;
}

/* -------------------------------------------------------------------------- */
/*                               Validation                                   */
/* -------------------------------------------------------------------------- */

interface ValidationResult {
  ok: boolean;
  warnings: string[];
}

function validateStructuredResponse(raw: AiStructuredResponse): ValidationResult {
  const warnings: string[] = [];

  if (!raw.table) {
    return { ok: false, warnings: ['AI не вернул таблицу (table = null).'] };
  }

  const rows = raw.table.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, warnings: ['Таблица пуста (нет строк).'] };
  }

  let validRows = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const hasDate = row.date !== null && row.date !== undefined && row.date !== '';
    const hasDoc = row.document !== null && row.document !== undefined && row.document !== '';
    const hasAmount =
      row.party_1_debit !== null ||
      row.party_1_credit !== null ||
      row.party_2_debit !== null ||
      row.party_2_credit !== null;

    if (hasDate || hasDoc || hasAmount) validRows++;
  }

  if (validRows === 0) {
    return { ok: false, warnings: ['Ни одна строка не содержит данных (нет дат, документов или сумм).'] };
  }

  if (validRows < rows.length * 0.3) {
    warnings.push(`Только ${validRows} из ${rows.length} строк содержат данные — возможны потери.`);
  }

  // Математическая проверка балансов
  const { opening_balance, turnovers, closing_balance } = raw.table;
  if (opening_balance && turnovers && closing_balance) {
    for (const side of ['party_1', 'party_2'] as const) {
      const ob = opening_balance[side];
      const cb = closing_balance[side];
      if (ob !== null && cb !== null && turnovers) {
        const turnover = side === 'party_1'
          ? new Decimal(turnovers.party_1_debit ?? 0).minus(turnovers.party_1_credit ?? 0)
          : new Decimal(turnovers.party_2_debit ?? 0).minus(turnovers.party_2_credit ?? 0);
        const expected = new Decimal(ob).plus(turnover);
        const actual = new Decimal(cb);
        if (!expected.equals(actual)) {
          warnings.push(
            `Баланс ${side}: сальдо начальное (${ob}) + оборот (${turnover.toFixed(2)}) ≠ сальдо конечное (${cb}).`,
          );
        }
      }
    }
  }

  return { ok: true, warnings };
}

/* -------------------------------------------------------------------------- */
/*                          Conversion to ParsedSide                          */
/* -------------------------------------------------------------------------- */

function numOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return new Decimal(v).toDecimalPlaces(2).toFixed(2);
  }
  return parseMoney(String(v));
}

function partyToParsedSide(
  party: AiParty | null,
  rows: AiRow[],
  side: 'party_1' | 'party_2',
  fileName: string,
  openingBalance: AiTableSummary | null,
  closingBalance: AiTableSummary | null,
  turnovers: AiTurnovers | null,
): ParsedSide {
  const debitKey = side === 'party_1' ? 'party_1_debit' : 'party_2_debit';
  const creditKey = side === 'party_1' ? 'party_1_credit' : 'party_2_credit';

  const parsedRows: ParsedRow[] = [];
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const docNumberRaw = row.document ?? null;
    const docNumberNorm = normalizeDocNumber(docNumberRaw);
    const docDate = parseDate(row.date);
    const amount = numOrNull(row[debitKey]) ?? numOrNull(row[creditKey]);
    const debit = numOrNull(row[debitKey]);
    const credit = numOrNull(row[creditKey]);

    if (!docNumberRaw && !docNumberNorm) {
      skipped++;
      continue;
    }

    if (docDate === null && amount === null) {
      skipped++;
      continue;
    }

    parsedRows.push({
      rowIndex: i,
      docNumber: docNumberRaw || null,
      docNumberNorm,
      docDate,
      amount,
      debit,
      credit,
    });
  }

  const turnoverDebit = turnovers
    ? numOrNull(turnovers[debitKey])
    : null;
  const turnoverCredit = turnovers
    ? numOrNull(turnovers[creditKey])
    : null;

  const assumptions: string[] = [];
  if (party?.name) {
    assumptions.push(`Сторона: ${party.name}${party.inn ? ` (ИНН ${party.inn})` : ''}.`);
  }

  return {
    role: side === 'party_1' ? 'ours' : 'partner',
    meta: {
      fileName,
      kind: 'ai-structured',
      sheetName: null,
      pages: null,
      rowsExtracted: parsedRows.length,
      rowsSkipped: skipped,
    },
    rows: parsedRows,
    openingBalance: openingBalance?.[side] !== null ? numOrNull(openingBalance?.[side]) : null,
    closingBalance: closingBalance?.[side] !== null ? numOrNull(closingBalance?.[side]) : null,
    turnoverDebit,
    turnoverCredit,
    assumptions,
  };
}

/* -------------------------------------------------------------------------- */
/*                              Main function                                 */
/* -------------------------------------------------------------------------- */

/**
 * Парсит двухсторонний акт сверки через AI.
 *
 * @param config — конфиг AI (API key + модель)
 * @param pdfText — текст PDF-файла
 * @param fileName — имя файла для метаданных
 * @returns AiStructuredResult или null при ошибке
 */
export async function parseTwoSidedPdf(
  config: AiConfig,
  pdfText: string,
  fileName: string,
): Promise<AiStructuredResult | null> {
  if (!config.apiKey) return null;
  if (!pdfText.trim()) return null;

  try {
    const { data: raw } = await requestJson<AiStructuredResponse>(
      config,
      SYSTEM_PROMPT,
      { text: pdfText },
      60_000, // двухсторонний акт может быть длинным
    );

    const validation = validateStructuredResponse(raw);
    if (!validation.ok) {
      return null;
    }

    const rows = raw.table?.rows ?? [];
    const openingBalance = raw.table?.opening_balance ?? null;
    const closingBalance = raw.table?.closing_balance ?? null;
    const turnovers = raw.table?.turnovers ?? null;

    const ours = partyToParsedSide(
      raw.party_1, rows, 'party_1', fileName,
      openingBalance, closingBalance, turnovers,
    );
    const partner = partyToParsedSide(
      raw.party_2, rows, 'party_2', fileName,
      openingBalance, closingBalance, turnovers,
    );

    return { ours, partner, raw };
  } catch (err) {
    if (err instanceof AiUnavailableError) return null;
    return null;
  }
}

/**
 * Эвристика определения двухстороннего формата по тексту PDF.
 *
 * Ищет признаки двойной таблицы: две колонки с дебетом/кредитом,
 * фразы «По данным», «Для обеих сторон» и т.п.
 */
export function looksTwoSided(pdfText: string): boolean {
  const lower = pdfText.toLowerCase();

  // Два набора дебет/кредит в шапке — явный признак
  const debitCount = (lower.match(/дебет/g) ?? []).length;
  const creditCount = (lower.match(/кредит/g) ?? []).length;
  if (debitCount >= 2 && creditCount >= 2) return true;

  // «По данным» встречается дважды — две стороны описаны
  const poDannym = (lower.match(/по данны[мх]/g) ?? []).length;
  if (poDannym >= 2) return true;

  // Комбинация «сальдо» + двойные дебет/кредит
  if (lower.includes('сальдо') && debitCount >= 2) return true;

  return false;
}
