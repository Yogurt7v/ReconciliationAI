/**
 * E2E smoke: полный прогон пайплайна (без HTTP) на сгенерированных сэмплах.
 * Проверяет ожидания каждого сценария и пишет отчёты в samples/out/.
 *
 * Запуск: pnpm smoke  (из корня — pnpm --filter @recon/backend smoke)
 * OCR-сценарий включается переменной RUN_SCAN_SMOKE=1 (нужен tessdata).
 */

import fs from 'node:fs';
import path from 'node:path';

import { confirmMapping, createJob, toStatus } from '../src/jobs/store.js';
import { runPipeline } from '../src/jobs/pipeline.js';
import { buildHtmlReport } from '../src/services/export/htmlReport.js';
import { buildScenarios, buildPdfPairs } from './generate-samples.js';
import type { SamplePair } from './generate-samples.js';

interface SmokeResult {
  name: string;
  ok: boolean;
  details: string[];
}

async function runPair(pair: SamplePair, outDir: string): Promise<SmokeResult> {
  const details: string[] = [];
  const ours = fs.readFileSync(pair.oursFile);
  const partner = fs.readFileSync(pair.partnerFile);

  const job = createJob(
    { ours: path.basename(pair.oursFile), partner: path.basename(pair.partnerFile) },
    { ours, partner },
  );
  const pipelinePromise = runPipeline(job.id);

  // Smoke принимает предложенный маппинг автоматически (Human-in-the-Loop)
  const confirmTimer = setInterval(() => {
    const pending = job.pendingConfirmation;
    if (!pending) return;
    confirmMapping(job.id, {
      headerRowIndex: pending.suggested.headerRowIndex,
      dataStartRowIndex: pending.suggested.dataStartRowIndex,
      columns: pending.suggested.columns,
    });
    details.push(`ℹ подтверждена структура ${pending.side === 'ours' ? 'нашей' : 'контрагента'} стороны`);
  }, 100);
  try {
    await pipelinePromise;
  } finally {
    clearInterval(confirmTimer);
  }

  const status = toStatus(job);
  if (status.stage !== 'done' || !job.report) {
    return { name: pair.name, ok: false, details: [`стадия ${status.stage}, ошибка: ${status.error ?? '—'}`] };
  }

  const report = job.report;
  const s = report.summary;

  const checks: Array<[string, boolean]> = [
    [`совпавших пар ${s.matched} (ожидалось ≥ ${pair.expectMatched})`, s.matched >= pair.expectMatched],
    [
      `расхождений сумм ${s.amountMismatches}${pair.expectAmountMismatches !== undefined ? ` (ожидалось ${pair.expectAmountMismatches})` : ''}`,
      pair.expectAmountMismatches === undefined || s.amountMismatches === pair.expectAmountMismatches,
    ],
    [
      `расхождений дат ${s.dateMismatches}${pair.expectDateMismatches !== undefined ? ` (ожидалось ${pair.expectDateMismatches})` : ''}`,
      pair.expectDateMismatches === undefined || s.dateMismatches === pair.expectDateMismatches,
    ],
    [
      `только у нас ${s.onlyOurs}${pair.expectOnlyOurs !== undefined ? ` (ожидалось ${pair.expectOnlyOurs})` : ''}`,
      pair.expectOnlyOurs === undefined || s.onlyOurs === pair.expectOnlyOurs,
    ],
    [
      `итоговый баланс ${report.finalBalance.amount} (${report.finalBalance.direction})`,
      pair.expectEvenBalance === true
        ? report.finalBalance.direction === 'even'
        : pair.expectDirection === undefined || report.finalBalance.direction === pair.expectDirection,
    ],
  ];

  for (const [label, ok] of checks) {
    details.push(`${ok ? '✓' : '✗'} ${label}`);
  }

  // Экспортируем отчёт HTML рядом — ручная проверка вёрстки/печати
  const htmlPath = path.join(outDir, `${pair.name}-report.html`);
  fs.writeFileSync(htmlPath, buildHtmlReport(report), 'utf8');
  details.push(`✓ отчёт: samples/out/${path.basename(htmlPath)}`);

  return { name: pair.name, ok: checks.every(([, ok]) => ok) && details.every((d) => !d.startsWith('✗')), details };
}

async function main(): Promise<void> {
  const backendDir = path.resolve(process.cwd());
  const outDir = path.join(backendDir, 'samples');
  const htmlOutDir = path.join(outDir, 'out');
  fs.mkdirSync(htmlOutDir, { recursive: true });

  // Гарантируем наличие сэмплов
  if (!fs.existsSync(path.join(outDir, 'ideal-ours.xlsx'))) {
    console.log('Сэмплы не найдены — генерирую…\n');
    buildScenarios(outDir);
    await buildPdfPairs(outDir);
  }

  const { pairs } = buildScenarios(outDir);
  const { textPair, scanPair } = await buildPdfPairs(outDir);
  const all: SamplePair[] = [...pairs];
  if (textPair) all.push(textPair);
  if (scanPair && process.env.RUN_SCAN_SMOKE === '1') {
    all.push(scanPair);
  } else if (scanPair) {
    console.log('— OCR-сценарий пропущен (включается RUN_SCAN_SMOKE=1)\n');
  }

  let failed = 0;
  for (const pair of all) {
    const result = await runPair(pair, htmlOutDir);
    const icon = result.ok ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${result.name}`);
    for (const line of result.details) console.log(`       ${line}`);
    if (!result.ok) failed++;
    console.log('');
  }

  if (failed > 0) {
    console.error(`Провалено сценариев: ${failed}`);
    process.exit(1);
  }
  console.log(`Все сценарии прошли: ${all.length}/${all.length}`);
}

await main();
