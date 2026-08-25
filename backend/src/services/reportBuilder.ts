/**
 * Сборка итогового отчёта сверки из результатов детерминированного движка.
 *
 * Никакой арифметики «на глаз»: все суммы — Decimal, сравнение до копейки.
 * Итоговый баланс складывается из всех расхождений позиций:
 *   our − partner по парам  +  документы только у нас  −  только у контрагента.
 * Гипотезы: детерминированные правила ∪ гипотезы модели (если доступны).
 */

import Decimal from 'decimal.js';

import { formatMoney } from '@recon/shared';
import type {
  BalanceCheck,
  FinalBalance,
  Hypothesis,
  ParsedSide,
  ReasoningStep,
  ReconciliationReport,
  SummaryCounts,
} from '@recon/shared';

import { ruleBasedHypotheses } from './ai/hypotheses.js';
import type { HypothesisContext } from './ai/hypotheses.js';
import type { ReconcileCoreResult } from './reconcile.js';

export interface ReportBuildInput {
  jobId: string;
  ours: ParsedSide;
  partner: ParsedSide;
  core: ReconcileCoreResult;
  /** null — модель недоступна/без ключа (деградация к правилам) */
  hypothesesAi: Hypothesis[] | null;
  /** Таймлайн «Логики AI», накопленный пайплайном до стадии analysis */
  aiLogic: ReasoningStep[];
}

const BALANCE_LABELS: Record<BalanceCheck['key'], string> = {
  openingBalance: 'Сальдо на начало периода',
  closingBalance: 'Сальдо на конец периода',
  turnoverDebit: 'Оборот по дебету',
  turnoverCredit: 'Оборот по кредиту',
};

function compareBalances(
  key: BalanceCheck['key'],
  ours: string | null,
  partner: string | null,
): BalanceCheck {
  let status: BalanceCheck['status'];
  if (ours === null || partner === null) {
    status = 'missing';
  } else if (new Decimal(ours).equals(new Decimal(partner))) {
    status = 'match';
  } else {
    status = 'mismatch';
  }
  return { key, label: BALANCE_LABELS[key], ours, partner, status };
}

function sumAmounts(values: Array<string | null>): string {
  return values
    .reduce(
      (acc, v) => (v === null ? acc : acc.plus(v)),
      new Decimal(0),
    )
    .toFixed(2);
}

function periodOf(sides: ParsedSide[]): { from: string | null; to: string | null } {
  const dates = sides.flatMap((s) => s.rows.map((r) => r.docDate).filter((d): d is string => d !== null)).sort();
  return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
}

/**
 * Итоговый баланс: суммируем все источники разногласий со знаком
 * («+» — контрагент должен нам, «−» — мы должны контрагенту).
 */
function finalBalance(core: ReconcileCoreResult): FinalBalance {
  const pairsDiff = core.amountMismatches.reduce(
    (acc, item) => (item.difference === null ? acc : acc.plus(item.difference)),
    new Decimal(0),
  );
  const onlyOursSum = sumAmounts(core.onlyOurs.map((i) => i.amount));
  const onlyPartnerSum = sumAmounts(core.onlyPartner.map((i) => i.amount));

  const total = pairsDiff.plus(onlyOursSum).minus(onlyPartnerSum);

  const direction: FinalBalance['direction'] = total.greaterThan(0)
    ? 'they_owe'
    : total.lessThan(0)
      ? 'we_owe'
      : 'even';

  const parts: string[] = [];
  if (!pairsDiff.isZero()) parts.push(`расхождения сумм пар ${formatMoney(pairsDiff.toFixed(2))}`);
  if (!new Decimal(onlyOursSum).isZero()) {
    parts.push(`документы без пары у контрагента ${formatMoney(onlyOursSum)}`);
  }
  if (!new Decimal(onlyPartnerSum).isZero()) {
    parts.push(`документы без пары у нас ${formatMoney(onlyPartnerSum)}`);
  }

  const explanation =
    direction === 'even'
      ? 'Расхождения сошлись взаимозачётом: итоговое сальдо сторон равно нулю.'
      : `Итоговая разница ${formatMoney(total.toFixed(2))} — ${
          direction === 'they_owe' ? 'контрагент должен нам' : 'мы должны контрагенту'
        }. Состав: ${parts.join('; ')}.`;

  return { amount: total.toFixed(2), direction, explanation };
}

function hypothesisSteps(input: ReportBuildInput): ReasoningStep {
  const now = new Date().toISOString();
  if (input.hypothesesAi === null) {
    return {
      id: `${input.jobId}-hyp`,
      stage: 'analysis',
      title: 'Гипотезы сформированы по правилам',
      detail:
        'Модель недоступна или ключ не задан. Использованы только детерминированные правила — это не влияет на точность арифметики сверки.',
      createdAt: now,
    };
  }
  return {
    id: `${input.jobId}-hyp`,
    stage: 'analysis',
    title: `Модель предложила гипотезы (${input.hypothesesAi.length})`,
    detail: 'Гипотезы AI объединены с результатами правил и добавлены в отчёт.',
    createdAt: now,
  };
}

/** Главная функция сборки отчёта */
export function buildReport(input: ReportBuildInput): ReconciliationReport {
  const { ours, partner, core } = input;

  const balanceChecks: BalanceCheck[] = [
    compareBalances('openingBalance', ours.openingBalance, partner.openingBalance),
    compareBalances('closingBalance', ours.closingBalance, partner.closingBalance),
    compareBalances('turnoverDebit', ours.turnoverDebit, partner.turnoverDebit),
    compareBalances('turnoverCredit', ours.turnoverCredit, partner.turnoverCredit),
  ];

  const summary: SummaryCounts = {
    ourTotal: ours.rows.length,
    partnerTotal: partner.rows.length,
    matched: core.matchedPairs.length,
    onlyOurs: core.onlyOurs.length,
    onlyPartner: core.onlyPartner.length,
    amountMismatches: core.amountMismatches.length,
    dateMismatches: core.dateMismatches.length,
    balanceIssues: balanceChecks.filter((b) => b.status !== 'match').length,
  };

  // Гипотезы: правила всегда, модель — при наличии
  const ctx: HypothesisContext = {
    summary,
    balanceIssues: balanceChecks.filter((b) => b.status !== 'match'),
    assumptions: [...ours.assumptions, ...partner.assumptions],
    samples: {
      amountMismatches: core.amountMismatches,
      onlyOurs: core.onlyOurs,
      onlyPartner: core.onlyPartner,
    },
  };
  const hypotheses: Hypothesis[] = [
    ...ruleBasedHypotheses(ctx),
    ...(input.hypothesesAi ?? []),
  ];

  const aiLogic: ReasoningStep[] = [...input.aiLogic, hypothesisSteps(input)];

  return {
    id: input.jobId,
    createdAt: new Date().toISOString(),
    sides: { ours: ours.meta, partner: partner.meta },
    period: periodOf([ours, partner]),
    summary,
    onlyOurs: core.onlyOurs,
    onlyPartner: core.onlyPartner,
    amountMismatches: core.amountMismatches,
    dateMismatches: core.dateMismatches,
    balanceChecks,
    totals: {
      onlyOursSum: sumAmounts(core.onlyOurs.map((i) => i.amount)),
      onlyPartnerSum: sumAmounts(core.onlyPartner.map((i) => i.amount)),
      mismatchSum: core.amountMismatches.reduce(
        (acc, item) =>
          item.difference === null ? acc : acc.plus(new Decimal(item.difference).abs()),
        new Decimal(0),
      ).toFixed(2),
    },
    finalBalance: finalBalance(core),
    hypotheses,
    aiLogic,
  };
}
