/**
 * Гипотезы о причинах расхождений.
 *
 * Два источника:
 *  1. Детерминированные правила (всегда доступны, работают офлайн);
 *  2. Модель OpenRouter: по краткому контексту расхождений предлагает
 *     дополнительные гипотезы на русском. При ошибке/отсутствии ключа
 *     возвращается null — отчёт спокойно обходится правилами.
 */

import type {
  AmountMismatchItem,
  BalanceCheck,
  Hypothesis,
  OnlyItem,
  SummaryCounts,
} from '@recon/shared';

import { requestJson } from './client.js';

/** Контекст, на котором строятся гипотезы (шаблонные и AI) */
export interface HypothesisContext {
  summary: SummaryCounts;
  balanceIssues: BalanceCheck[];
  assumptions: string[];
  samples: {
    amountMismatches: AmountMismatchItem[];
    onlyOurs: OnlyItem[];
    onlyPartner: OnlyItem[];
  };
}

const SAMPLE_LIMIT = 8;

function takeSamples<T>(items: T[], limit = SAMPLE_LIMIT): T[] {
  return items.slice(0, limit);
}

/* ------------------------------ Правила ----------------------------------- */

/**
 * Шаблонные гипотезы. Каждое правило — наблюдаемая закономерность в данных,
 * формулировка и рекомендация — на русском для пользователя.
 */
export function ruleBasedHypotheses(ctx: HypothesisContext): Hypothesis[] {
  const out: Hypothesis[] = [];
  const { summary } = ctx;

  // 1. Разница сумм «круглая» или равна копейкам — частичная оплата / округление
  for (const item of takeSamples(ctx.samples.amountMismatches)) {
    if (item.difference === null) continue;
    const diff = Number(item.difference);
    if (!Number.isFinite(diff) || diff === 0) continue;

    if (Math.abs(diff % 100) === 0 && Math.abs(diff) >= 100) {
      out.push({
        scope: 'doc',
        docNumber: item.docNumber,
        text: `По документу ${item.docNumber ?? '—'} разница сумм кратна 100 (${diff.toFixed(2)}): похоже на частичную оплату или зачёт аванса.`,
        recommendation:
          'Проверьте платежи по этому документу: возможно, контрагент отразил оплату не полностью.',
      });
    } else if (Math.abs(Math.abs(diff) - Math.round(Math.abs(diff))) < 0.005 && Math.abs(diff) < 100) {
      out.push({
        scope: 'doc',
        docNumber: item.docNumber,
        text: `По документу ${item.docNumber ?? '—'} разница мала (${diff.toFixed(2)}): возможно округление цены или курса.`,
        recommendation: 'Сверьте цену/курс пересчёта в первичных документах.',
      });
    }
  }

  // 2. Расхождение только дат при равных суммах — момент отражения операции
  if (summary.dateMismatches > 0 && summary.amountMismatches === 0) {
    out.push({
      scope: 'general',
      text: 'Все суммы совпадают, расходятся только даты документов: стороны отражают операции разными датами (отгрузка vs оплата, дата акта vs дате счёта).',
      recommendation:
        'Договоритесь о едином документе-основании для даты отражения; на баланс это обычно не влияет.',
    });
  }

  // 3. Документы есть только у одной стороны — не переданы/не зарегистрированы
  if (summary.onlyOurs > 0 && summary.onlyOurs >= summary.onlyPartner * 3 && summary.onlyOurs >= 3) {
    out.push({
      scope: 'general',
      text: `Значительная часть документов есть только у нас (${summary.onlyOurs} шт.): вероятно, они не переданы или не зарегистрированы контрагентом.`,
      recommendation: 'Передайте копии документов контрагенту и запросите подтверждение регистрации.',
    });
  }
  if (
    summary.onlyPartner > 0 &&
    summary.onlyPartner >= summary.onlyOurs * 3 &&
    summary.onlyPartner >= 3
  ) {
    out.push({
      scope: 'general',
      text: `${summary.onlyPartner} документов значатся только у контрагента: возможны неотражённые у нас поставки или ошибочная регистрация.`,
      recommendation: 'Запросите у контрагента первичные документы по позициям «только у контрагента».',
    });
  }

  // 4. Проблемы сальдо/оборотов
  const opening = ctx.balanceIssues.find((b) => b.key === 'openingBalance');
  if (opening && opening.status === 'mismatch') {
    out.push({
      scope: 'general',
      text: 'Входящее сальдо сторон не совпадает: сверка начата с разных точек (разный период или незакрытые предыдущие расхождения).',
      recommendation: 'Проверьте сальдо на начало периода из предыдущего акта сверки.',
    });
  }

  // 5. Допущения извлечения могут искажать картину
  for (const a of ctx.assumptions.slice(0, 2)) {
    out.push({
      scope: 'general',
      text: `Допущение при разборе файла: ${a}`,
      recommendation: 'Если структура файла определена неверно, уточните колонки и повторите сверку.',
    });
  }

  return out;
}

/* --------------------------------- AI ------------------------------------- */

interface AiHypothesesResponse {
  hypotheses?: Array<{
    scope?: string;
    docNumber?: string | null;
    text?: string;
    recommendation?: string | null;
  }>;
}

const SYSTEM_PROMPT = `Ты бухгалтер-аналитик. Тебе дают краткую сводку расхождений акта сверки.
Предложи до 5 правдоподобных гипотез о причинах расхождений на русском языке.
Формат JSON: { "hypotheses": [ { "scope": "general" | "doc",
"docNumber": string | null, "text": string, "recommendation": string | null } ] }.
Гипотезы должны опираться только на данные. Отвечай строго JSON без markdown.`;

/**
 * Гипотезы от модели. null — если модель недоступна/ответ некорректен
 * (деградация к правилам, вызывающий код фиксирует это в reasoning).
 */
export async function aiHypotheses(
  config: { apiKey: string | null; model: string },
  ctx: HypothesisContext,
): Promise<Hypothesis[] | null> {
  try {
    const { data: raw } = await requestJson<AiHypothesesResponse>(
      config,
      SYSTEM_PROMPT,
      {
        summary: ctx.summary,
        balanceIssues: ctx.balanceIssues,
        amountMismatches: takeSamples(ctx.samples.amountMismatches),
        onlyOurs: takeSamples(ctx.samples.onlyOurs),
        onlyPartner: takeSamples(ctx.samples.onlyPartner),
        extractionAssumptions: ctx.assumptions,
      },
    );

    if (!Array.isArray(raw.hypotheses)) return null;

    const out: Hypothesis[] = [];
    for (const h of raw.hypotheses.slice(0, 5)) {
      if (typeof h.text !== 'string' || !h.text.trim()) continue;
      out.push({
        scope: h.scope === 'doc' ? 'doc' : 'general',
        docNumber: typeof h.docNumber === 'string' ? h.docNumber : null,
        text: h.text.trim(),
        recommendation: typeof h.recommendation === 'string' && h.recommendation.trim() ? h.recommendation.trim() : null,
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export { SAMPLE_LIMIT as HYPOTHESIS_SAMPLE_LIMIT };
