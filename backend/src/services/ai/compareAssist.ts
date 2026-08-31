/**
 * AI-сравнение двух актов сверки.
 *
 * Принимает агрегированные данные из двух файлов (DocumentData),
 * отправляет в OpenRouter для анализа расхождений.
 * Возвращает структурированный результат (сальдо, обороты).
 */

import type { AiCompareResult } from '@recon/shared';

import { type AiConfig, type AiDebugInfo, AiUnavailableError, requestJson } from './client.js';
import type { DocumentData } from './testAnalyze.js';

/* ----------------------------- Промпт ---------------------------------- */

const SYSTEM_PROMPT = `Ты — эксперт по бухгалтерской сверке актов.

Тебе передают агрегированные данные двух актов сверки (наш файл и файл контрагента).
Определи:
1. Совпадают ли сальдо начальные и конечные (считай разницу).
2. Совпадают ли обороты дебет и кредит.

Верни строго JSON без markdown:
{
  "balanceCheck": {
    "openingA": число,
    "openingB": число,
    "closingA": число,
    "closingB": число,
    "match": true/false,
    "diff": число (closingA - closingB)
  },
  "turnoverCheck": {
    "debitA": число,
    "creditA": число,
    "debitB": число,
    "creditB": число,
    "debitMatch": true/false,
    "creditMatch": true/false
  }
}`;

/* ----------------------------- Валидация --------------------------------- */

function validateAiResult(raw: Record<string, unknown>): AiCompareResult | null {
  const bc = raw.balanceCheck as Record<string, unknown> | undefined;
  const tc = raw.turnoverCheck as Record<string, unknown> | undefined;

  if (!bc || !tc) return null;

  const toNum = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;

  return {
    balanceCheck: {
      openingA: toNum(bc.openingA),
      openingB: toNum(bc.openingB),
      closingA: toNum(bc.closingA),
      closingB: toNum(bc.closingB),
      match: typeof bc.match === 'boolean' ? bc.match : false,
      diff: toNum(bc.diff),
    },
    turnoverCheck: {
      debitA: toNum(tc.debitA),
      creditA: toNum(tc.creditA),
      debitB: toNum(tc.debitB),
      creditB: toNum(tc.creditB),
      debitMatch: typeof tc.debitMatch === 'boolean' ? tc.debitMatch : false,
      creditMatch: typeof tc.creditMatch === 'boolean' ? tc.creditMatch : false,
    },
    aiAnalysis: '',
  };
}

/* -------------------------------- API ------------------------------------ */

/**
 * Главная функция: AI-сравнение двух актов сверки.
 */
export async function aiCompare(
  ourData: DocumentData,
  partnerData: DocumentData,
  config: AiConfig,
): Promise<{ result: AiCompareResult; debug: AiDebugInfo }> {
  if (!config.apiKey) {
    throw new AiUnavailableError('OPENROUTER_API_KEY не задан — AI-сравнение недоступно.');
  }

  const payload = {
    ours: {
      openingBalance: ourData.openingBalance,
      closingBalance: ourData.closingBalance,
      turnoverDebit: ourData.turnoverDebit,
      turnoverCredit: ourData.turnoverCredit,
      totalRows: ourData.totalRows,
      contractsCount: ourData.contracts.length,
    },
    partner: {
      openingBalance: partnerData.openingBalance,
      closingBalance: partnerData.closingBalance,
      turnoverDebit: partnerData.turnoverDebit,
      turnoverCredit: partnerData.turnoverCredit,
      totalRows: partnerData.totalRows,
      contractsCount: partnerData.contracts.length,
    },
  };

  const { data: raw, debug } = await requestJson<Record<string, unknown>>(
    config,
    SYSTEM_PROMPT,
    payload,
  );

  const result = validateAiResult(raw);
  if (!result) {
    throw new AiUnavailableError('AI вернул некорректный формат ответа');
  }

  return { result, debug };
}

/**
 * Fallback: клиентское сравнение без AI (если ключ не задан или AI недоступен).
 */
export function fallbackCompare(ourData: DocumentData, partnerData: DocumentData): AiCompareResult {
  const openingDiff = ourData.openingBalance - partnerData.openingBalance;
  const closingDiff = ourData.closingBalance - partnerData.closingBalance;
  const debitA = ourData.turnoverDebit ?? 0;
  const creditA = ourData.turnoverCredit ?? 0;
  const debitB = partnerData.turnoverDebit ?? 0;
  const creditB = partnerData.turnoverCredit ?? 0;

  return {
    balanceCheck: {
      openingA: ourData.openingBalance,
      openingB: partnerData.openingBalance,
      closingA: ourData.closingBalance,
      closingB: partnerData.closingBalance,
      match: Math.abs(closingDiff) < 0.02,
      diff: closingDiff,
    },
    turnoverCheck: {
      debitA,
      creditA,
      debitB,
      creditB,
      debitMatch: Math.abs(debitA - debitB) < 0.02,
      creditMatch: Math.abs(creditA - creditB) < 0.02,
    },
    aiAnalysis: '',
  };
}
