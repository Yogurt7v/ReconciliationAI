/**
 * Оркестрация задания сверки.
 *
 * upload → parsing (∥ обе стороны) → structure (AI + эвристика) →
 * → awaiting_confirmation? (Human-in-the-Loop) → extraction →
 * → reconciliation → analysis → done.
 *
 * Прогресс — по весам стадий, внутри стадии — по доле шага (inner 0..1).
 * Отмена проверяется между стадиями флагом cancelRequested.
 * Все решения фиксируются в reasoningLog («Логика AI»).
 */

import { CONFIDENCE_THRESHOLD, missingRequiredFields } from '@recon/shared';
import type {
  ColumnMapping,
  MappingFieldKey,
  ParsedSide,
  RawSource,
  ReasoningStep,
  SideRole,
} from '@recon/shared';

import { parseExcel } from '../parsers/excelParser.js';
import { parsePdf, detectTwoSidedPdf } from '../parsers/pdfParser.js';
import { parsePdfWithOcr } from '../parsers/ocrPipeline.js';
import { buildPreview, columnStats } from '../services/heuristics.js';
import { applyMapping } from '../services/applyMapping.js';
import { assistStructure } from '../services/ai/structureAssist.js';
import { aiHypotheses } from '../services/ai/hypotheses.js';
import { aiConfigFromSettings, aiProgressText } from '../services/ai/client.js';
import type { AiProgressCallback, AiProgressEvent } from '../services/ai/client.js';
import type { Settings } from '../settings.js';
import { reconcileSides } from '../services/reconcile.js';
import type { ReconcileCoreResult } from '../services/reconcile.js';
import { buildReport } from '../services/reportBuilder.js';

import { getJob } from './store.js';
import type { Job } from './store.js';

/* Веса стадий для прогресса */
const STAGE_WEIGHTS: Record<string, number> = {
  uploaded: 0,
  parsing: 20,
  structure: 15,
  awaiting_confirmation: 0,
  extraction: 25,
  reconciliation: 25,
  analysis: 10,
  done: 5,
};
const TOTAL_WEIGHT = Object.values(STAGE_WEIGHTS).reduce((a, b) => a + b, 0);

/** Порядок стадий пайплайна (без терминальных) — для прогресса и степпера */
const STAGE_ORDER = [
  'uploaded',
  'parsing',
  'structure',
  'awaiting_confirmation',
  'extraction',
  'reconciliation',
  'analysis',
] as const;

class CancelledError extends Error {
  constructor() {
    super('Задание отменено пользователем');
    this.name = 'CancelledError';
  }
}

/** Сумма весов всех стадий, предшествующих данной */
function stageBase(stage: Job['stage']): number {
  const idx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  if (stage === 'done') return TOTAL_WEIGHT;
  if (idx <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < idx; i++) acc += STAGE_WEIGHTS[STAGE_ORDER[i]!] ?? 0;
  return acc;
}

/**
 * Доли прогресса внутри стадии: inner 0 — только вошли, 1 — шаг завершён.
 * Позволяет полоске двигаться, пока идёт долгий шаг (например, AI-вызов),
 * а не стоять между стадиями.
 */
function updateStage(job: Job, stage: Job['stage'], message: string, inner = 0): void {
  job.stage = stage;
  job.message = message;
  if (stage === 'done') {
    job.progress = 1;
    return;
  }
  const base = stage === 'awaiting_confirmation' ? 0 : stageBase(stage);
  const weight = STAGE_WEIGHTS[stage] ?? 0;
  const clamped = Math.min(1, Math.max(0, inner));
  job.progress = Math.min(0.99, (base + weight * clamped) / TOTAL_WEIGHT);
}

/** Сообщение текущей стадии без изменения прогресса (для телеметрии AI) */
function updateMessage(job: Job, message: string): void {
  job.message = message;
}

function pushStep(
  job: Job,
  stage: ReasoningStep['stage'],
  title: string,
  detail: string,
  confidence?: number,
): void {
  job.reasoningLog.push({
    id: `${job.id}-${job.reasoningLog.length + 1}`,
    stage,
    title,
    detail,
    ...(confidence !== undefined ? { confidence } : {}),
    createdAt: new Date().toISOString(),
  });
}

function checkCancelled(job: Job): void {
  if (job.cancelRequested) throw new CancelledError();
}

/* ------------------------------ Разбор файлов ----------------------------- */

function logRawSource(label: string, source: RawSource): void {
  console.log(`\n📄 RAW DATA | ${label} | ${source.kind}, строк сетки: ${source.grid.length}`);
  for (let i = 0; i < Math.min(15, source.grid.length); i++) {
    console.log(`  row ${i}:`, JSON.stringify(source.grid[i]));
  }
}

async function parseSideBuffer(buffer: Buffer, fileName: string): Promise<RawSource> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) {
    const textSource = await parsePdf(buffer, fileName);
    if (textSource.needsOcr) {
      return parsePdfWithOcr(buffer, fileName);
    }
    return textSource;
  }
  return parseExcel(buffer, fileName);
}

/** Сообщение статуса по итогам сверки (короткое, для строки статуса) */
function summarizeReconcile(result: ReconcileCoreResult): string {
  return `Сверено: совпало пар ${result.matchedPairs.length}, расхождений сумм ${result.amountMismatches.length}`;
}

/* ------------------------------- Структура -------------------------------- */

/**
 * Определяет структуру стороны и решает, нужно ли подтверждение.
 */
async function resolveStructure(
  job: Job,
  role: SideRole,
  settings: Settings,
  onProgress?: AiProgressCallback,
): Promise<void> {
  const source = job.sources[role];
  if (!source) throw new Error(`Источник ${role} не разобран`);

  const label = role === 'ours' ? 'наш файл' : 'файл контрагента';
  // Доли прогресса внутри стадии structure: наши — первая половина, вторая — вторая
  const innerStart = role === 'ours' ? 0.1 : 0.55;
  const innerDone = role === 'ours' ? 0.45 : 0.95;

  updateStage(job, 'structure', `Определение структуры: ${label}…`, innerStart);
  const { mapping, aiUsed } = await assistStructure(source.grid, settings, onProgress);
  job.mappings[role] = mapping;
  updateStage(
    job,
    'structure',
    `Структура «${label}»: ${mapping.source}, уверенность ${Math.round(mapping.confidence * 100)}%`,
    innerDone,
  );

  console.log(`\n🔍 STRUCTURE | ${role === 'ours' ? 'НАШ ФАЙЛ' : 'ФАЙЛ КОНТРАГЕНТА'}`, JSON.stringify({
    source: mapping.source,
    confidence: mapping.confidence,
    headerRow: mapping.headerRowIndex,
    dataStart: mapping.dataStartRowIndex,
    columns: mapping.columns,
  }, null, 2));

  pushStep(
    job,
    'structure',
    `Структура ${role === 'ours' ? 'наш файл' : 'файл контрагента'}: ${mapping.source}`,
    [
      ...mapping.reasoning,
      aiUsed ? '' : 'Модель не использовалась.',
    ]
      .filter(Boolean)
      .join(' '),
    mapping.confidence,
  );

  const missing = missingRequiredFields(mapping.columns);
  const lowConfidence = mapping.confidence < CONFIDENCE_THRESHOLD;

  if (missing.length > 0 || lowConfidence) {
    const reason =
      missing.length > 0
        ? `Не определены обязательные колонки: ${missing.join(', ')}.`
        : `Уверенность определения структуры ${(mapping.confidence * 100).toFixed(0)}% ниже порога.`;

    job.pendingConfirmation = {
      side: role,
      reason,
      preview: buildPreview(source.grid, {
        headerRowIndex: mapping.headerRowIndex,
        headerScore: 0,
        dataStartRowIndex: mapping.dataStartRowIndex,
        stats: columnStats(source.grid, mapping.dataStartRowIndex),
      }),
      suggested: mapping,
    };
  }
}

/** Ждёт подтверждения пользователя (резолвер дергается из HTTP API) */
function waitForConfirmation(job: Job): Promise<void> {
  return new Promise((resolve) => {
    job.confirmResolver = resolve;
  });
}

async function ensureConfirmedStructure(
  job: Job,
  role: SideRole,
  settings: Settings,
  onProgress?: AiProgressCallback,
): Promise<void> {
  await resolveStructure(job, role, settings, onProgress);
  while (
    !job.cancelRequested &&
    job.pendingConfirmation !== null &&
    job.pendingConfirmation.side === role
  ) {
    updateStage(job, 'awaiting_confirmation', `Требуется подтверждение структуры (${role === 'ours' ? 'наш файл' : 'файл контрагента'})`);
    await waitForConfirmation(job);
  }
}

/** Применяет подтверждённый/предложенный маппинг и извлекает строки */
function extractSide(job: Job, role: SideRole): ParsedSide {
  const source = job.sources[role];
  const mapping = job.mappings[role];
  if (!source || !mapping) throw new Error(`Нет данных стороны ${role}`);
  const parsed = applyMapping(source, mapping, role);

  const label = role === 'ours' ? 'НАШ ФАЙЛ' : 'ФАЙЛ КОНТРАГЕНТА';
  console.log(`\n📊 EXTRACTED | ${label} | ${parsed.rows.length} строк (пропущено ${parsed.meta.rowsSkipped})`);
  for (const row of parsed.rows) {
    console.log(`  #${row.rowIndex}:`, JSON.stringify({
      docNumber: row.docNumber,
      docDate: row.docDate,
      amount: row.amount,
    }));
  }
  console.log(`  сальдо: начало=${parsed.openingBalance}, конец=${parsed.closingBalance}`);

  const notes = parsed.assumptions.length ? ` Допущения: ${parsed.assumptions.join(' ')}` : '';
  pushStep(
    job,
    'extraction',
    `${role === 'ours' ? 'наш файл' : 'файл контрагента'}: извлечено ${parsed.meta.rowsExtracted} строк`,
    `Пропущено служебных строк: ${parsed.meta.rowsSkipped}.${notes}`,
  );
  return parsed;
}

/* ------------------------------- Пайплайн --------------------------------- */

export async function runPipeline(jobId: string, settings: Settings): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Задание ${jobId} не найдено`);

  let coreResult: ReconcileCoreResult | null = null;
  let oursParsed: ParsedSide | null = null;
  let partnerParsed: ParsedSide | null = null;

  try {
    /* ------------------------------ parsing ----------------------------- */
    checkCancelled(job);
    updateStage(job, 'parsing', 'Чтение файлов…', 0.05);
    const [oursSource, partnerSource] = await Promise.all([
      parseSideBuffer(job.buffers.ours, job.files.ours),
      parseSideBuffer(job.buffers.partner, job.files.partner),
    ]);
    job.sources.ours = oursSource;
    job.sources.partner = partnerSource;

    logRawSource('НАШ ФАЙЛ', oursSource);
    logRawSource('ФАЙЛ КОНТРАГЕНТА', partnerSource);

    const describe = (s: RawSource): string => {
      const kindLabel =
        s.kind === 'excel'
          ? `Excel${s.sheetName ? `, лист «${s.sheetName}»` : ''}`
          : s.kind === 'pdf-ocr'
            ? 'PDF через OCR (скан)'
            : 'PDF с текстовым слоем';
      return `${kindLabel}, страниц: ${s.pages ?? '—'}, строк сетки: ${s.grid.length}`;
    };
    updateStage(
      job,
      'parsing',
      `Файлы разобраны. Наш: ${describe(oursSource)}. Контрагент: ${describe(partnerSource)}.`,
      0.5,
    );
    pushStep(job, 'parsing', 'Файлы разобраны', `Наш файл: ${describe(oursSource)}. Контрагент: ${describe(partnerSource)}.`);
    if (oursSource.needsOcr || partnerSource.needsOcr) {
      pushStep(job, 'parsing', 'Обнаружен скан', 'Один из файлов распознан через OCR — возможны неточности распознавания.');
    }

    // Телеметрия AI-вызовов: модель может думать десятки секунд — показываем
    // это в статусе, иначе пользователь решает, что процесс завис.
    const aiEvent = (ev: AiProgressEvent): void => updateMessage(job, aiProgressText(ev));

    /* --------------------- двухсторонний PDF (AI) ----------------------- */
    // Двусторонний акт: пользователь галочкой указал, что файл контрагента
    // содержит данные обеих сторон. Парсим AI-моделью, берём только
    // контрагентскую сторону (party_1 = левая колонка в PDF).
    if (job.twoSidedRequested) {
      const partnerIsTextPdf = partnerSource.kind === 'pdf-text' && !partnerSource.needsOcr;
      if (partnerIsTextPdf) {
        const aiConfig = aiConfigFromSettings(settings);
        updateStage(job, 'parsing', 'Распознавание двухстороннего акта через AI…', 0.7);
        const twoSided = await detectTwoSidedPdf(
          partnerSource,
          job.files.partner,
          aiConfig,
          true,
          aiEvent,
        );

        if (twoSided) {
          // party_1 (ours в structuredParse) = левая сторона = партнёр
          // party_2 (partner в structuredParse) = правая сторона = наши
          // Нам нужна только сторона партнёра (party_1 → twoSided.ours)
          partnerParsed = twoSided.ours;
          updateStage(
            job,
            'parsing',
            `Двусторонний акт контрагента распознан: ${partnerParsed.rows.length} строк`,
            0.95,
          );

          console.log(`\n📄 TWO-SIDED PDF | ФАЙЛ КОНТРАГЕНТА | распознано через AI`);
          console.log(`  сторона контрагента: ${partnerParsed.rows.length} строк`);
          for (const row of partnerParsed.rows.slice(0, 10)) {
            console.log(`  #${row.rowIndex}:`, JSON.stringify(row));
          }

          pushStep(
            job,
            'structure',
            'Двусторонний акт контрагента распознан через AI',
            `Извлечено ${partnerParsed.rows.length} строк со стороны контрагента.`,
          );
        }
      }
    }

    // Legacy: автодетект двухстороннего акта в нашем файле (если не было ручного флага)
    if (!partnerParsed) {
      const oursIsTextPdf = oursSource.kind === 'pdf-text' && !oursSource.needsOcr;
      if (oursIsTextPdf) {
        const aiConfig = aiConfigFromSettings(settings);
        updateStage(job, 'parsing', 'Распознавание акта сверки через AI…', 0.7);
        const twoSided = await detectTwoSidedPdf(
          oursSource,
          job.files.ours,
          aiConfig,
          job.twoSidedRequested,
          aiEvent,
        );

        if (twoSided) {
          updateStage(
            job,
            'parsing',
            `Акт сверки распознан через AI: ${twoSided.ours.rows.length} + ${twoSided.partner.rows.length} строк`,
            0.95,
          );
          job.sources.ours = {
            grid: [],
            kind: 'ai-structured',
            fileName: job.files.ours,
            sheetName: null,
            pages: null,
          };
          job.sources.partner = {
            grid: [],
            kind: 'ai-structured',
            fileName: job.files.partner,
            sheetName: null,
            pages: null,
          };
          oursParsed = twoSided.ours;
          partnerParsed = twoSided.partner;

          console.log(`\n📄 TWO-SIDED PDF | наш файл | распознано через AI`);
          console.log(`  наша сторона: ${oursParsed.rows.length} строк`);
          for (const row of oursParsed.rows.slice(0, 10)) {
            console.log(`  #${row.rowIndex}:`, JSON.stringify(row));
          }
          console.log(`  сторона контрагента: ${partnerParsed.rows.length} строк`);
          for (const row of partnerParsed.rows.slice(0, 10)) {
            console.log(`  #${row.rowIndex}:`, JSON.stringify(row));
          }

          pushStep(
            job,
            'structure',
            'Двусторонний акт распознан через AI',
            `Извлечено ${twoSided.ours.rows.length} строк (наша сторона), ${twoSided.partner.rows.length} строк (контрагент).`,
          );
        }
      }
    }

    if (oursParsed && partnerParsed) {
      // Обе стороны уже извлечены — переходим сразу к reconciliation
      checkCancelled(job);
      updateStage(job, 'reconciliation', 'Сопоставление документов…', 0.2);
      console.log(`\n⚖️ RECONCILE | наш файл: ${oursParsed.rows.length} строк, контрагент: ${partnerParsed.rows.length} строк`);
      console.log(`  наши первые 5:`, oursParsed.rows.slice(0, 5).map(r => r.docNumber));
      console.log(`  контрагент первые 5:`, partnerParsed.rows.slice(0, 5).map(r => r.docNumber));
      coreResult = reconcileSides(oursParsed, partnerParsed);
      updateStage(job, 'reconciliation', summarizeReconcile(coreResult), 0.9);
      pushStep(
        job,
        'reconciliation',
        'Сверка выполнена',
        `Совпало пар: ${coreResult.matchedPairs.length}; только у нас: ${coreResult.onlyOurs.length}; только у контрагента: ${coreResult.onlyPartner.length}; расхождений сумм: ${coreResult.amountMismatches.length}; дат: ${coreResult.dateMismatches.length}.`,
      );

      // Анализ и отчёт
      checkCancelled(job);
      updateStage(job, 'analysis', 'Формирование отчёта…', 0.4);
      const report = buildReport({
        jobId: job.id,
        ours: oursParsed,
        partner: partnerParsed,
        core: coreResult,
        hypothesesAi: null,
        aiLogic: job.reasoningLog,
      });
      job.report = report;
      job.reportReady = true;
      updateStage(job, 'done', 'Отчёт готов');
      return;
    }

    /* ----------------------------- structure ---------------------------- */
    checkCancelled(job);
    updateStage(job, 'structure', 'Определение структуры таблиц…', 0.02);

    // Стороны обрабатываются последовательно: каждая может запросить подтверждение
    await ensureConfirmedStructure(job, 'ours', settings, aiEvent);
    checkCancelled(job);
    if (!partnerParsed) {
      await ensureConfirmedStructure(job, 'partner', settings, aiEvent);
      checkCancelled(job);
    }

    /* ----------------------------- extraction --------------------------- */
    updateStage(job, 'extraction', 'Извлечение строк: наш файл…', 0.1);
    oursParsed = extractSide(job, 'ours');
    updateStage(job, 'extraction', `Извлечено строк (наш файл): ${oursParsed.rows.length}`, 0.5);
    if (!partnerParsed) {
      updateStage(job, 'extraction', 'Извлечение строк: файл контрагента…', 0.6);
      partnerParsed = extractSide(job, 'partner');
      updateStage(
        job,
        'extraction',
        `Извлечено строк: наш файл ${oursParsed.rows.length}, контрагент ${partnerParsed.rows.length}`,
        0.95,
      );
    }

    /* --------------------------- reconciliation ------------------------- */
    checkCancelled(job);
    updateStage(job, 'reconciliation', 'Сопоставление документов…', 0.2);
    console.log(`\n⚖️ RECONCILE | наш файл: ${oursParsed.rows.length} строк, контрагент: ${partnerParsed.rows.length} строк`);
    console.log(`  наши первые 5:`, oursParsed.rows.slice(0, 5).map(r => r.docNumber));
    console.log(`  контрагент первые 5:`, partnerParsed.rows.slice(0, 5).map(r => r.docNumber));
    coreResult = reconcileSides(oursParsed, partnerParsed);
    updateStage(job, 'reconciliation', summarizeReconcile(coreResult), 0.9);
    pushStep(
      job,
      'reconciliation',
      'Сверка выполнена',
      `Совпало пар: ${coreResult.matchedPairs.length}; только у нас: ${coreResult.onlyOurs.length}; только у контрагента: ${coreResult.onlyPartner.length}; расхождений сумм: ${coreResult.amountMismatches.length}; дат: ${coreResult.dateMismatches.length}.`,
    );

    /* ------------------------------ analysis ---------------------------- */
    checkCancelled(job);
    updateStage(job, 'analysis', 'Формирование отчёта…', 0.2);
    const config = aiConfigFromSettings(settings);
    updateStage(job, 'analysis', 'AI анализирует расхождения и готовит гипотезы…', 0.5);
    const hypothesesAi = await aiHypotheses(config, {
      summary: {
        ourTotal: oursParsed.rows.length,
        partnerTotal: partnerParsed.rows.length,
        matched: coreResult.matchedPairs.length,
        onlyOurs: coreResult.onlyOurs.length,
        onlyPartner: coreResult.onlyPartner.length,
        amountMismatches: coreResult.amountMismatches.length,
        dateMismatches: coreResult.dateMismatches.length,
        balanceIssues: 0,
      },
      balanceIssues: [],
      assumptions: [...oursParsed.assumptions, ...partnerParsed.assumptions],
      samples: {
        amountMismatches: coreResult.amountMismatches,
        onlyOurs: coreResult.onlyOurs,
        onlyPartner: coreResult.onlyPartner,
      },
    }, aiEvent);

    updateStage(job, 'analysis', 'Генерация итогового отчёта…', 0.85);
    const report = buildReport({
      jobId: job.id,
      ours: oursParsed,
      partner: partnerParsed,
      core: coreResult,
      hypothesesAi,
      aiLogic: job.reasoningLog,
    });

    job.report = report;
    job.reportReady = true;
    updateStage(job, 'done', 'Отчёт готов');
  } catch (err) {
    if (err instanceof CancelledError) {
      job.stage = 'cancelled';
      job.message = 'Задание отменено';
      job.error = null;
      return;
    }
    job.stage = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.message = 'Ошибка обработки';
    pushStep(job, 'failed', 'Задание завершилось ошибкой', job.error);
  } finally {
    // Освобождаем буферы — они больше не нужны после формирования отчёта
    job.buffers = { ours: Buffer.alloc(0), partner: Buffer.alloc(0) };
  }
}
