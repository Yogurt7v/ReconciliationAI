/**
 * Интеграционные тесты оркестрации: полный прогон без AI-ключа
 * (деградированный режим), поток подтверждения структуры и отмена.
 */

import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';

import { createJob, getJob, confirmMapping, requestCancel, toStatus } from '../src/jobs/store.js';
import { runPipeline } from '../src/jobs/pipeline.js';

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

/** xlsx-буфер из массива массивов */
function xlsxBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function goodRows(): unknown[][] {
  return [
    ['Акт сверки за март 2026'],
    [],
    ['№', 'Дата', 'Сумма', 'Назначение'],
    ['101', '05.03.2026', '15000,00', 'Оплата'],
    ['102', '06.03.2026', '4200,50', 'Отгрузка'],
  ];
}

describe('runPipeline (деградированный режим, без ключа)', () => {
  it('полный прогон идеальной пары файлов → done + отчёт', async () => {
    const job = createJob(
      { ours: 'ours.xlsx', partner: 'partner.xlsx' },
      { ours: xlsxBuffer(goodRows()), partner: xlsxBuffer(goodRows()) },
    );

    await runPipeline(job.id);

    const status = toStatus(job);
    expect(status.stage).toBe('done');
    expect(status.reportReady).toBe(true);
    expect(job.report).not.toBeNull();

    const report = job.report!;
    expect(report.summary.matched).toBe(2);
    expect(report.summary.amountMismatches).toBe(0);
    expect(report.finalBalance.direction).toBe('even');
    // Логика AI зафиксировала стадии
    const stages = report.aiLogic.map((s) => s.stage);
    expect(stages).toContain('parsing');
    expect(stages).toContain('structure');
    expect(stages).toContain('reconciliation');
    expect(stages.at(-1)).toBe('analysis');
  }, 30_000);

  it('файл без узнаваемой шапки → awaiting_confirmation → подтверждение → done', async () => {
    // Колонки без бухгалтерских заголовков: эвристика не уверена
    const unclear = [
      ['A', 'B', 'C'],
      ['101', '05.03.2026', '1500,00'],
      ['102', '07.03.2026', '900,00'],
    ];
    const job = createJob(
      { ours: 'o.xlsx', partner: 'p.xlsx' },
      { ours: xlsxBuffer(unclear), partner: xlsxBuffer(unclear) },
    );

    const running = runPipeline(job.id);
    let confirmations = 0;

    // Обе стороны могут запросить подтверждение — подтверждаем по мере появления
    while (!job.reportReady && job.stage !== 'failed' && job.stage !== 'cancelled') {
      const status = toStatus(job);
      if (status.pendingConfirmation) {
        expect(status.pendingConfirmation.side).toBeDefined();
        expect(status.pendingConfirmation.preview.rows.length).toBeGreaterThan(0);
        const ok = confirmMapping(job.id, {
          headerRowIndex: 0,
          dataStartRowIndex: 1,
          columns: { docNumber: 0, docDate: 1, amount: 2, debit: null, credit: null },
        });
        expect(ok).toBe(true);
        confirmations++;
        continue;
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    await running;
    expect(toStatus(job).stage).toBe('done');
    expect(confirmations).toBeGreaterThanOrEqual(1);
    expect(getJob(job.id)!.report!.summary.matched).toBe(2);
    // Маппинг после подтверждения помечен как пользовательский
    expect(getJob(job.id)!.mappings.ours!.source).toBe('user');
  }, 30_000);

  it('отмена до запуска → stage=cancelled', async () => {
    const job = createJob(
      { ours: 'o.xlsx', partner: 'p.xlsx' },
      { ours: xlsxBuffer(goodRows()), partner: xlsxBuffer(goodRows()) },
    );
    expect(requestCancel(job.id)).toBe(true);

    await runPipeline(job.id);
    expect(job.stage).toBe('cancelled');
    expect(job.error).toBeNull();
    expect(requestCancel(job.id)).toBe(false); // терминальная стадия
  }, 30_000);
});
