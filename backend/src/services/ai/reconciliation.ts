/**
 * Модуль сравнения двух актов сверки.
 *
 * Выполняет точное сравнение (до копейки) на двух уровнях:
 * 1. Агрегированные показатели (сальдо, обороты)
 * 2. Построчное сравнение транзакций (по номеру документа)
 *
 * AI используется только для генерации комментариев и гипотез.
 */

import type { CompareResult, MatchedPair, Transaction, TransactionDiff } from '@recon/shared';

import { type AiConfig, type AiDebugInfo, AiUnavailableError, requestJson } from './client.js';
import type { DocumentData } from './testAnalyze.js';

/* ----------------------------- Вспомогательные функции ------------------- */

const toCents = (value: number | null | undefined): number => {
  if (value === null || value === undefined || !isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
};

const isEqualCents = (a: number | null | undefined, b: number | null | undefined): boolean => {
  return toCents(a) === toCents(b);
};

const isDateEqual = (a: string | null | undefined, b: string | null | undefined): boolean => {
  return (a ?? '').trim() === (b ?? '').trim();
};

const extractDocNumber = (doc: string | null | undefined): string => {
  const match = (doc ?? '').match(/(\d+)/);
  return match?.[1] ?? (doc ?? '').trim().toLowerCase();
};

/* ----------------------------- Основная логика сравнения ----------------- */

/**
 * Сравнивает два акта сверки.
 * Возвращает детальный результат без использования AI.
 */
export function compareDocuments(
  yourData: DocumentData,
  partnerData: DocumentData,
): CompareResult {
  const yourTransactions = yourData.contracts.flatMap((c) => c.transactions);
  const partnerTransactions = partnerData.contracts.flatMap((c) => c.transactions);

  const yourMap = new Map<string, Transaction>();
  const partnerMap = new Map<string, Transaction>();

  for (const t of yourTransactions) {
    const key = extractDocNumber(t.document);
    const existing = yourMap.get(key);
    if (!existing) {
      yourMap.set(key, t);
    } else {
      yourMap.set(key, {
        ...existing,
        debit: (existing.debit ?? 0) + (t.debit ?? 0),
        credit: (existing.credit ?? 0) + (t.credit ?? 0),
      });
    }
  }

  for (const t of partnerTransactions) {
    const key = extractDocNumber(t.document);
    const existing = partnerMap.get(key);
    if (!existing) {
      partnerMap.set(key, t);
    } else {
      partnerMap.set(key, {
        ...existing,
        debit: (existing.debit ?? 0) + (t.debit ?? 0),
        credit: (existing.credit ?? 0) + (t.credit ?? 0),
      });
    }
  }

  const yourKeys = new Set(yourMap.keys());
  const partnerKeys = new Set(partnerMap.keys());

  const onlyInYour: Transaction[] = [];
  for (const key of yourKeys) {
    if (!partnerKeys.has(key)) {
      const tx = yourMap.get(key);
      if (tx) onlyInYour.push(tx);
    }
  }

  const onlyInPartner: Transaction[] = [];
  for (const key of partnerKeys) {
    if (!yourKeys.has(key)) {
      const tx = partnerMap.get(key);
      if (tx) onlyInPartner.push(tx);
    }
  }

  const commonKeys = new Set([...yourKeys].filter((k) => partnerKeys.has(k)));
  const matched: MatchedPair[] = [];
  const diffs: TransactionDiff[] = [];

  for (const key of commonKeys) {
    const yours = yourMap.get(key)!;
    const partner = partnerMap.get(key)!;

    const yourDebit = toCents(yours.debit);
    const yourCredit = toCents(yours.credit);
    const partnerDebit = toCents(partner.debit);
    const partnerCredit = toCents(partner.credit);

    const isDebitSame = isEqualCents(yourDebit, partnerDebit);
    const isCreditSame = isEqualCents(yourCredit, partnerCredit);
    const isDateSame = isDateEqual(yours.date, partner.date);

    if (isDebitSame && isCreditSame && isDateSame) {
      matched.push({ your: yours, partner });
      continue;
    }

    // Зеркальная запись: дебет одной стороны = кредит другой (Оплата/Приход)
    const yourTotal = yourDebit + yourCredit;
    const partnerTotal = partnerDebit + partnerCredit;
    if (isEqualCents(yourTotal, partnerTotal)) {
      matched.push({ your: yours, partner });
      continue;
    }

    const diff = (partnerDebit - yourDebit) + (yourCredit - partnerCredit);
    let reason: TransactionDiff['reason'] = 'amount_mismatch';
    let description = '';

    if (!isDebitSame && !isCreditSame) {
      reason = 'amount_mismatch';
      description = `Не совпадают суммы: у вас дебет=${yourDebit}, кредит=${yourCredit}; у контрагента дебет=${partnerDebit}, кредит=${partnerCredit}`;
    } else if (!isDebitSame) {
      reason = 'amount_mismatch';
      description = `Не совпадает дебет: у вас ${yourDebit}, у контрагента ${partnerDebit}`;
    } else if (!isCreditSame) {
      reason = 'amount_mismatch';
      description = `Не совпадает кредит: у вас ${yourCredit}, у контрагента ${partnerCredit}`;
    } else if (!isDateSame) {
      reason = 'date_mismatch';
      description = `Не совпадают даты: у вас ${yours.date}, у контрагента ${partner.date}`;
    }

    const totalYour = yourDebit + yourCredit;
    const totalPartner = partnerDebit + partnerCredit;
    if (
      totalYour !== 0 && totalPartner !== 0 &&
      (yourDebit === 0 || yourCredit === 0) &&
      (partnerDebit === 0 || partnerCredit === 0)
    ) {
      reason = 'direction_mismatch';
      description = `Возможно, перепутаны дебет и кредит: у вас дебет=${yourDebit}, кредит=${yourCredit}; у контрагента дебет=${partnerDebit}, кредит=${partnerCredit}`;
    }

    diffs.push({
      document: yours.document,
      yourDate: yours.date,
      partnerDate: partner.date,
      yourDebit,
      partnerDebit,
      yourCredit,
      partnerCredit,
      diff,
      reason,
      description,
    });
  }

  const openingA = toCents(yourData.openingBalance);
  const openingB = toCents(partnerData.openingBalance);
  const closingA = toCents(yourData.closingBalance);
  const closingB = toCents(partnerData.closingBalance);
  const debitA = toCents(yourData.turnoverDebit);
  const debitB = toCents(partnerData.turnoverDebit);
  const creditA = toCents(yourData.turnoverCredit);
  const creditB = toCents(partnerData.turnoverCredit);

  const summary: CompareResult['summary'] = {
    yourTotalRows: yourData.totalRows,
    partnerTotalRows: partnerData.totalRows,
    yourOpeningBalance: openingA,
    partnerOpeningBalance: openingB,
    yourClosingBalance: closingA,
    partnerClosingBalance: closingB,
    yourTurnoverDebit: debitA,
    partnerTurnoverDebit: debitB,
    yourTurnoverCredit: creditA,
    partnerTurnoverCredit: creditB,
    openingMatch: isEqualCents(openingA, openingB),
    closingMatch: isEqualCents(closingA, closingB),
    debitMatch: isEqualCents(debitA, debitB),
    creditMatch: isEqualCents(creditA, creditB),
    openingDiff: toCents(openingB - openingA),
    closingDiff: toCents(closingB - closingA),
    debitDiff: toCents(debitB - debitA),
    creditDiff: toCents(creditB - creditA),
  };

  let yourDebt = 0;
  let partnerDebt = 0;

  for (const d of diffs) {
    if (d.diff > 0) {
      yourDebt += d.diff;
    } else {
      partnerDebt += Math.abs(d.diff);
    }
  }

  for (const t of onlyInYour) {
    partnerDebt += toCents(t.debit) + toCents(t.credit);
  }
  for (const t of onlyInPartner) {
    yourDebt += toCents(t.debit) + toCents(t.credit);
  }

  return {
    summary,
    matched,
    onlyInYour,
    onlyInPartner,
    diffs,
    finalBalance: { yourDebt: toCents(yourDebt), partnerDebt: toCents(partnerDebt) },
    aiAnalysis: '',
  };
}

/* ----------------------------- AI-анализ ---------------------------------- */

interface AiAnalysisResponse {
  summary: string;
  hypotheses: Array<{ document: string; hypothesis: string }>;
  recommendations: string[];
}

const ANALYSIS_PROMPT = `Ты — эксперт по бухгалтерской сверке.

Ты получишь детальные результаты сравнения двух актов: агрегированные показатели, список документов только у каждой стороны, список расхождений по общим документам.

Твоя задача:
1. Написать краткое резюме (3-5 предложений) на русском языке, где будет указано: сходятся ли сальдо и обороты, сколько найдено расхождений.
2. Для каждого расхождения предложить возможную причину.
3. Дать рекомендации по устранению расхождений.

Верни строго JSON без markdown:
{
  "summary": "краткое резюме",
  "hypotheses": [
    { "document": "номер документа", "hypothesis": "гипотеза о причине" }
  ],
  "recommendations": ["рекомендация 1", "рекомендация 2"]
}

Если расхождений нет, верни: { "summary": "Все данные совпадают.", "hypotheses": [], "recommendations": ["Можно подписать акт сверки"] }`;

export async function generateAiAnalysis(
  compareResult: CompareResult,
  config: AiConfig,
): Promise<{ text: string; debug: AiDebugInfo }> {
  if (!config.apiKey) {
    throw new AiUnavailableError('OPENROUTER_API_KEY не задан — AI-анализ недоступен.');
  }

  const payload = {
    summary: compareResult.summary,
    onlyInYour: compareResult.onlyInYour.map((t) => ({
      document: t.document,
      date: t.date,
      debit: t.debit,
      credit: t.credit,
    })),
    onlyInPartner: compareResult.onlyInPartner.map((t) => ({
      document: t.document,
      date: t.date,
      debit: t.debit,
      credit: t.credit,
    })),
    diffs: compareResult.diffs,
    finalBalance: compareResult.finalBalance,
  };

  const { data, debug } = await requestJson<AiAnalysisResponse>(
    config,
    ANALYSIS_PROMPT,
    payload,
  );

  let text = data.summary || 'Анализ недоступен.';

  if (data.hypotheses && data.hypotheses.length > 0) {
    text += '\n\nВозможные причины расхождений:\n';
    for (const h of data.hypotheses) {
      text += `- Документ "${h.document}": ${h.hypothesis}\n`;
    }
  }

  if (data.recommendations && data.recommendations.length > 0) {
    text += '\nРекомендации:\n';
    for (const r of data.recommendations) {
      text += `- ${r}\n`;
    }
  }

  return { text, debug };
}

/* ----------------------------- Полный цикл ------------------------------- */

export async function fullReconciliation(
  yourData: DocumentData,
  partnerData: DocumentData,
  config?: AiConfig,
): Promise<{ result: CompareResult; debug?: AiDebugInfo }> {
  const result = compareDocuments(yourData, partnerData);

  if (config?.apiKey) {
    try {
      const { text, debug } = await generateAiAnalysis(result, config);
      result.aiAnalysis = text;
      return { result, debug };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const detail = err instanceof Error && 'detail' in err ? (err as { detail?: unknown }).detail : undefined;
      console.error('[reconciliation] AI analysis failed:', msg, detail ?? '');
      result.aiAnalysis = 'AI-анализ недоступен.';
      return { result };
    }
  }

  result.aiAnalysis = 'AI-анализ отключен.';
  return { result };
}
