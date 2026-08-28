/**
 * Оркестрация задания сверки.
 *
 * upload → parsing (∥ обе стороны) → structure (AI + эвристика) →
 * → awaiting_confirmation? (Human-in-the-Loop) → extraction →
 * → reconciliation → analysis → done.
 *
 * Прогресс — по весам стадий; ETA — грубая оценка от суммарного размера
 * файлов. Отмена проверяется между стадиями флагом cancelRequested.
 * Все решения фиксируются в reasoningLog («Логика AI»).
 */

import { CONFIDENCE_THRESHOLD } from '@recon/shared';
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
import { aiConfigFromEnv } from '../services/ai/client.js';
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

class CancelledError extends Error {
  constructor() {
    super('Задание отменено пользователем');
    this.name = 'CancelledError';
  }
}

/** Простая честная модель прогресса: доля выполненных стадий по их весам */
const STAGE_ORDER = ['uploaded', 'parsing', 'structure', 'awaiting_confirmation', 'extraction', 'reconciliation', 'analysis'] as const;

function progressFor(stage: Job['stage']): number {
  const idx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  if (stage === 'done') return 1;
  if (idx <= 0) return 0.02;
  let acc = 0;
  for (let i = 0; i < idx; i++) acc += STAGE_WEIGHTS[STAGE_ORDER[i]!] ?? 0;
  const current = stage === 'awaiting_confirmation' ? 0 : (STAGE_WEIGHTS[stage] ?? 0);
  return Math.min(0.99, (acc + current * 0.5) / TOTAL_WEIGHT);
}

function updateStage(job: Job, stage: Job['stage'], message: string): void {
  job.stage = stage;
  job.message = message;
  job.progress = progressFor(stage);
  // ETA от суммарного размера файлов (грубо): базовые 3 с + ~1.2 с на МБ
  const totalMb = (job.buffers.ours.length + job.buffers.partner.length) / (1024 * 1024);
  const estimateSec = 3 + totalMb * 1.2;
  job.etaSeconds =
    stage === 'done' ? 0 : Math.max(1, Math.round(estimateSec * (1 - job.progress)));
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

/* ------------------------------- Структура -------------------------------- */

const REQUIRED: MappingFieldKey[] = ['docNumber', 'docDate', 'amount'];

function missingRequired(mapping: ColumnMapping): MappingFieldKey[] {
  return REQUIRED.filter((f) => mapping.columns[f] === null);
}

/**
 * Определяет структуру стороны и решает, нужно ли подтверждение.
 */
async function resolveStructure(job: Job, role: SideRole): Promise<void> {
  const source = job.sources[role];
  if (!source) throw new Error(`Источник ${role} не разобран`);

  const { mapping, aiUsed } = await assistStructure(source.grid);
  job.mappings[role] = mapping;

  const label = role === 'ours' ? 'наш файл' : 'файл контрагента';
  pushStep(
    job,
    'structure',
    `Структура ${label}: ${mapping.source}`,
    [
      ...mapping.reasoning,
      aiUsed ? '' : 'Модель не использовалась.',
    ]
      .filter(Boolean)
      .join(' '),
    mapping.confidence,
  );

  const missing = missingRequired(mapping);
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

async function ensureConfirmedStructure(job: Job, role: SideRole): Promise<void> {
  await resolveStructure(job, role);
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

  const label = role === 'ours' ? 'наш файл' : 'файл контрагента';
  const notes = parsed.assumptions.length ? ` Допущения: ${parsed.assumptions.join(' ')}` : '';
  pushStep(
    job,
    'extraction',
    `${label}: извлечено ${parsed.meta.rowsExtracted} строк`,
    `Пропущено служебных строк: ${parsed.meta.rowsSkipped}.${notes}`,
  );
  return parsed;
}

/* ------------------------------- Пайплайн --------------------------------- */

export async function runPipeline(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Задание ${jobId} не найдено`);

  let coreResult: ReconcileCoreResult | null = null;
  let oursParsed: ParsedSide | null = null;
  let partnerParsed: ParsedSide | null = null;

  try {
    /* ------------------------------ parsing ----------------------------- */
    checkCancelled(job);
    updateStage(job, 'parsing', 'Разбор файлов…');
    const [oursSource, partnerSource] = await Promise.all([
      parseSideBuffer(job.buffers.ours, job.files.ours),
      parseSideBuffer(job.buffers.partner, job.files.partner),
    ]);
    job.sources.ours = oursSource;
    job.sources.partner = partnerSource;

    const describe = (s: RawSource): string => {
      const kindLabel =
        s.kind === 'excel'
          ? `Excel${s.sheetName ? `, лист «${s.sheetName}»` : ''}`
          : s.kind === 'pdf-ocr'
            ? 'PDF через OCR (скан)'
            : 'PDF с текстовым слоем';
      return `${kindLabel}, страниц: ${s.pages ?? '—'}, строк сетки: ${s.grid.length}`;
    };
    pushStep(job, 'parsing', 'Файлы разобраны', `Наш файл: ${describe(oursSource)}. Контрагент: ${describe(partnerSource)}.`);
    if (oursSource.needsOcr || partnerSource.needsOcr) {
      pushStep(job, 'parsing', 'Обнаружен скан', 'Один из файлов распознан через OCR — возможны неточности распознавания.');
    }

    /* --------------------- двухсторонний PDF (AI) ----------------------- */
    // Двусторонний акт: пользователь галочкой указал, что файл контрагента
    // содержит данные обеих сторон. Парсим AI-моделью, берём только
    // контрагентскую сторону (party_1 = левая колонка в PDF).
    if (job.twoSidedRequested) {
      const partnerIsTextPdf = partnerSource.kind === 'pdf-text' && !partnerSource.needsOcr;
      if (partnerIsTextPdf) {
        const aiConfig = aiConfigFromEnv();
        const twoSided = await detectTwoSidedPdf(
          partnerSource,
          job.files.partner,
          aiConfig,
          true,
        );

        if (twoSided) {
          // party_1 (ours в structuredParse) = левая сторона = партнёр
          // party_2 (partner в structuredParse) = правая сторона = наши
          // Нам нужна только сторона партнёра (party_1 → twoSided.ours)
          partnerParsed = twoSided.ours;

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
        const aiConfig = aiConfigFromEnv();
        const twoSided = await detectTwoSidedPdf(
          oursSource,
          job.files.ours,
          aiConfig,
          job.twoSidedRequested,
        );

        if (twoSided) {
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
      updateStage(job, 'reconciliation', 'Сопоставление документов…');
      coreResult = reconcileSides(oursParsed, partnerParsed);
      pushStep(
        job,
        'reconciliation',
        'Сверка выполнена',
        `Совпало пар: ${coreResult.matchedPairs.length}; только у нас: ${coreResult.onlyOurs.length}; только у контрагента: ${coreResult.onlyPartner.length}; расхождений сумм: ${coreResult.amountMismatches.length}; дат: ${coreResult.dateMismatches.length}.`,
      );

      // Анализ и отчёт
      checkCancelled(job);
      updateStage(job, 'analysis', 'Формирование отчёта…');
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
    updateStage(job, 'structure', 'Определение структуры таблиц…');

    // Стороны обрабатываются последовательно: каждая может запросить подтверждение
    await ensureConfirmedStructure(job, 'ours');
    checkCancelled(job);
    if (!partnerParsed) {
      await ensureConfirmedStructure(job, 'partner');
      checkCancelled(job);
    }

    /* ----------------------------- extraction --------------------------- */
    updateStage(job, 'extraction', 'Извлечение строк документов…');
    oursParsed = extractSide(job, 'ours');
    if (!partnerParsed) {
      partnerParsed = extractSide(job, 'partner');
    }

    /* --------------------------- reconciliation ------------------------- */
    checkCancelled(job);
    updateStage(job, 'reconciliation', 'Сопоставление документов…');
    coreResult = reconcileSides(oursParsed, partnerParsed);
    pushStep(
      job,
      'reconciliation',
      'Сверка выполнена',
      `Совпало пар: ${coreResult.matchedPairs.length}; только у нас: ${coreResult.onlyOurs.length}; только у контрагента: ${coreResult.onlyPartner.length}; расхождений сумм: ${coreResult.amountMismatches.length}; дат: ${coreResult.dateMismatches.length}.`,
    );

    /* ------------------------------ analysis ---------------------------- */
    checkCancelled(job);
    updateStage(job, 'analysis', 'Формирование отчёта и гипотез…');
    const config = aiConfigFromEnv();
    const hypothesesAi = config.apiKey
      ? await aiHypotheses(config, {
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
        })
      : null;

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
      job.etaSeconds = null;
      return;
    }
    job.stage = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.message = 'Ошибка обработки';
    job.etaSeconds = null;
    pushStep(job, 'failed', 'Задание завершилось ошибкой', job.error);
  } finally {
    // Освобождаем буферы — они больше не нужны после формирования отчёта
    job.buffers = { ours: Buffer.alloc(0), partner: Buffer.alloc(0) };
  }
}
