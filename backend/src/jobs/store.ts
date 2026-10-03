/**
 * Хранилище заданий сверки (in-memory Map). Процесс-синглтон: задания живут
 * в памяти backend'а, отчёты — вместе с заданием.
 */

import { randomUUID } from 'node:crypto';

import {
  COMBINABLE_FIELD_PAIR,
  JOB_TTL_MS,
  MAX_ACTIVE_JOBS,
  type AiProvider,
  type ColumnMapping,
  type ConfirmPayload,
  type JobStage,
  type JobStatus,
  type PendingConfirmation,
  type RawSource,
  type ReasoningStep,
  type ReconciliationReport,
  type SideRole,
} from '@recon/shared';

/**
 * Модель, обслуживающая этот запуск: провайдер и идентификатор, выбранные
 * оператором в этом браузере.
 *
 * API-ключа здесь нет и быть не должно: `runPipeline` держит полный конфиг в
 * своём замыкании всё время жизни задания, а `toStatus` — строгий белый
 * список полей, уходящий в HTTP-ответ. Ключ рядом с ними расширял бы радиус
 * поражения без единой функциональной выгоды.
 */
export interface JobAiProfile {
  provider: AiProvider;
  model: string;
}

export interface Job {
  id: string;
  stage: JobStage;
  progress: number; // 0..1
  message: string;
  error: string | null;
  cancelRequested: boolean;
  pendingConfirmation: PendingConfirmation | null;
  reportReady: boolean;
  report: ReconciliationReport | null;
  reasoningLog: ReasoningStep[];

  files: { ours: string; partner: string };
  buffers: { ours: Buffer; partner: Buffer };
  sources: Partial<Record<SideRole, RawSource>>;
  mappings: Partial<Record<SideRole, ColumnMapping>>;
  /** Разрешение ожидания подтверждения маппинга пользователем */
  confirmResolver: (() => void) | null;
  createdAt: number;
  /** Пользователь запросил двухсторонний парсинг PDF */
  twoSidedRequested: boolean;
  /** Модель этого запуска; null — профиль не передан, локальная модель по умолчанию */
  aiProfile: JobAiProfile | null;
  /**
   * Модель, которая **реально ответила** на вызовы этого запуска; null — пока
   * не ответила ни одна.
   *
   * Отдельное поле, а не `aiProfile.model`: то, что оператор выбрал, известно с
   * момента создания задания и не меняется до конца, а подписать им отчёт,
   * который считала другая (или никто), — значит соврать в самом важном месте.
   */
  effectiveModel: string | null;
}

const jobs = new Map<string, Job>();

function cleanupExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (isTerminal(job) || now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

export function createJob(
  files: { ours: string; partner: string },
  buffers: { ours: Buffer; partner: Buffer },
  twoSidedRequested = false,
  aiProfile: JobAiProfile | null = null,
): Job {
  if (jobs.size >= MAX_ACTIVE_JOBS) {
    throw new Error('Превышен лимит одновременных заданий. Попробуйте позже.');
  }

  cleanupExpiredJobs();

  const job: Job = {
    id: randomUUID(),
    stage: 'uploaded',
    progress: 0.02,
    message: 'Файлы получены',
    error: null,
    cancelRequested: false,
    pendingConfirmation: null,
    reportReady: false,
    report: null,
    reasoningLog: [],
    files,
    buffers,
    sources: {},
    mappings: {},
    confirmResolver: null,
    createdAt: Date.now(),
    twoSidedRequested,
    aiProfile,
    effectiveModel: null,
  };
  jobs.set(job.id, job);

  // Safety TTL: отменяем задание, если оно зависло
  const ttlTimer = setTimeout(() => {
    if (!isTerminal(job)) {
      job.stage = 'cancelled';
      job.message = 'Авто-отмена: задание не завершено вовремя';
      jobs.delete(job.id);
    }
  }, JOB_TTL_MS);
  ttlTimer.unref();

  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function toStatus(job: Job): JobStatus {
  return {
    id: job.id,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    error: job.error,
    pendingConfirmation: job.pendingConfirmation,
    reportReady: job.reportReady,
    reasoningLog: job.reasoningLog,
    files: job.files,
    // Только ответившая модель: `aiProfile.model` — это запрос, а не обработка
    effectiveModel: job.effectiveModel,
    // Запрошенная — отдельной строкой: при подмене модели на стороне шлюза это
    // единственное место, где различие видно. Ключа здесь нет — в `JobAiProfile`
    // такого поля не существует.
    requestedModel: job.aiProfile?.model ?? null,
  };
}

const TERMINAL_STAGES: JobStage[] = ['done', 'failed', 'cancelled'];

export function isTerminal(job: Job): boolean {
  return TERMINAL_STAGES.includes(job.stage);
}

/**
 * Подтверждение маппинга пользователем (Human-in-the-Loop).
 * Маппинг помечается source='user', confidence=1, ожидание разрешается.
 */
export function confirmMapping(jobId: string, payload: ConfirmPayload): boolean {
  const job = jobs.get(jobId);
  if (!job || !job.pendingConfirmation) return false;

  // Валидация payload
  if (payload.headerRowIndex < 0 || payload.dataStartRowIndex < 0) return false;
  if (payload.dataStartRowIndex <= payload.headerRowIndex) return false;
  const colValues = Object.values(payload.columns);
  if (colValues.some((v) => v !== null && (!Number.isInteger(v) || v < 0))) return false;

  // Одна колонка может обслуживать только пару «номер + дата» из объединённого
  // заголовка акта — именно такую раскладку предлагает эвристика. Любые другие
  // совпадения означают, что два разных поля читают одно и то же, и это ошибка.
  const [combinedA, combinedB] = COMBINABLE_FIELD_PAIR;
  const allowedDuplicate =
    payload.columns[combinedA] !== null &&
    payload.columns[combinedA] === payload.columns[combinedB]
      ? payload.columns[combinedA]
      : null;
  const seen = new Set<number>();
  for (const v of colValues) {
    if (v === null || v === allowedDuplicate) continue;
    if (seen.has(v)) return false;
    seen.add(v);
  }

  const role = job.pendingConfirmation.side;
  const previous = job.mappings[role];
  const mapping: ColumnMapping = {
    headerRowIndex: payload.headerRowIndex,
    dataStartRowIndex: payload.dataStartRowIndex,
    columns: payload.columns,
    confidence: 1,
    source: 'user',
    reasoning: [
      ...(previous?.reasoning ?? []),
      'Структура подтверждена или скорректирована пользователем.',
    ],
  };
  job.mappings[role] = mapping;
  job.pendingConfirmation = null;
  const resolver = job.confirmResolver;
  job.confirmResolver = null;
  resolver?.();
  return true;
}

/** Запрос отмены: пайплайн завершится на ближайшей границе стадии */
export function requestCancel(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || isTerminal(job)) return false;
  job.cancelRequested = true;
  // Если задание ждёт подтверждения — будим его, чтобы отмена применилась
  if (job.confirmResolver) {
    job.pendingConfirmation = null;
    const resolver = job.confirmResolver;
    job.confirmResolver = null;
    resolver();
  }
  return true;
}
