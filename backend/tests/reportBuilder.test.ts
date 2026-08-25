/**
 * Тесты сборки отчёта: сводка, итоги, проверки сальдо, итоговый баланс,
 * объединение гипотез правил и AI.
 */

import { describe, expect, it } from 'vitest';

import { buildReport } from '../src/services/reportBuilder.js';
import type { ReportBuildInput } from '../src/services/reportBuilder.js';
import type { ParsedRow, ParsedSide } from '@recon/shared';
import { reconcileSides } from '../src/services/reconcile.js';

function side(
  role: 'ours' | 'partner',
  rows: Array<[string, string | null, string | null]>,
  extra: Partial<ParsedSide> = {},
): ParsedSide {
  const parsed: ParsedRow[] = rows.map(([num, date, amount], i) => ({
    rowIndex: i + 10,
    docNumber: num,
    docNumberNorm: num.toLowerCase(),
    docDate: date,
    amount,
    debit: null,
    credit: null,
  }));
  return {
    role,
    meta: {
      fileName: `${role}.xlsx`,
      kind: 'excel',
      sheetName: null,
      pages: null,
      rowsExtracted: parsed.length,
      rowsSkipped: 0,
    },
    rows: parsed,
    openingBalance: null,
    closingBalance: null,
    turnoverDebit: null,
    turnoverCredit: null,
    assumptions: [],
    ...extra,
  };
}

function baseInput(ours: ParsedSide, partner: ParsedSide): ReportBuildInput {
  return {
    jobId: 'job-1',
    ours,
    partner,
    core: reconcileSides(ours, partner),
    hypothesesAi: null,
    aiLogic: [],
  };
}

describe('buildReport', () => {
  it('идеальное совпадение: нулевые расхождения и even-баланс', () => {
    const ours = side('ours', [
      ['1', '2026-03-05', '1000.00'],
      ['2', '2026-03-06', '2500.00'],
    ]);
    const partner = side('partner', [
      ['1', '2026-03-05', '1000.00'],
      ['2', '2026-03-06', '2500.00'],
    ]);

    const report = buildReport(baseInput(ours, partner));
    expect(report.summary).toMatchObject({ ourTotal: 2, partnerTotal: 2, matched: 2 });
    expect(report.amountMismatches).toHaveLength(0);
    expect(report.finalBalance.direction).toBe('even');
    expect(report.totals).toEqual({
      onlyOursSum: '0.00',
      onlyPartnerSum: '0.00',
      mismatchSum: '0.00',
    });
    // Период по датам документов
    expect(report.period).toEqual({ from: '2026-03-05', to: '2026-03-06' });
  });

  it('суммирует расхождения и определяет направление долга', () => {
    const ours = side('ours', [
      ['1', '2026-03-05', '15000.00'], // пара с разницей +5000
      ['2', '2026-03-06', '450.00'],   // только у нас
      ['3', '2026-03-07', '300.00'],   // только у нас
    ]);
    const partner = side('partner', [
      ['1', '2026-03-05', '10000.00'],
      ['9', '2026-03-09', '700.00'],   // только у контрагента
    ]);

    const report = buildReport(baseInput(ours, partner));
    expect(report.summary.matched).toBe(1);
    expect(report.summary.amountMismatches).toBe(1);
    expect(report.summary.onlyOurs).toBe(2);
    expect(report.summary.onlyPartner).toBe(1);

    expect(report.totals.onlyOursSum).toBe('750.00');
    expect(report.totals.onlyPartnerSum).toBe('700.00');
    expect(report.totals.mismatchSum).toBe('5000.00'); // модуль разницы

    // Итог: +5000 (пара) + 750 − 700 = 5050 → контрагент должен нам
    expect(report.finalBalance.amount).toBe('5050.00');
    expect(report.finalBalance.direction).toBe('they_owe');
    expect(report.finalBalance.explanation).toMatch(/5\s050,00/);
  });

  it('проверки сальдо: match/mismatch/missing', () => {
    const ours = side('ours', [['1', null, '100.00']], {
      openingBalance: '500.00',
      closingBalance: '400.00',
      turnoverDebit: '100.00',
      turnoverCredit: null,
    });
    const partner = side('partner', [['1', null, '100.00']], {
      openingBalance: '500.00',
      closingBalance: '350.00',
      turnoverDebit: null,
      turnoverCredit: '0.00',
    });

    const report = buildReport(baseInput(ours, partner));
    const byKey = Object.fromEntries(report.balanceChecks.map((b) => [b.key, b.status]));

    expect(byKey.openingBalance).toBe('match');
    expect(byKey.closingBalance).toBe('mismatch');
    expect(byKey.turnoverDebit).toBe('missing');
    expect(byKey.turnoverCredit).toBe('missing');
    expect(report.summary.balanceIssues).toBe(3);
  });

  it('гипотезы: правила + AI, при деградации — шаг в логике AI', () => {
    const ours = side('ours', [['1', '2026-03-01', '15000.00']]);
    const partner = side('partner', [['1', '2026-03-01', '10000.00']]);

    const degraded = buildReport(baseInput(ours, partner));
    expect(degraded.aiLogic.at(-1)!.title).toContain('по правилам');

    const withAi = buildReport({
      ...baseInput(ours, partner),
      hypothesesAi: [{ scope: 'doc', docNumber: '1', text: 'Возможен аванс.', recommendation: null }],
    });
    expect(withAi.hypotheses.some((h) => h.docNumber === '1')).toBe(true);
    expect(withAi.aiLogic.at(-1)!.title).toContain('Модель предложила гипотезы (1)');
  });
});
