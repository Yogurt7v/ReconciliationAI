/**
 * Хранилище заданий сверки (in-memory Map). Процесс-синглтон: задания живут
 * в памяти backend'а, отчёты — вместе с заданием.
 */

import { randomUUID } from 'node:crypto';

import {
  JOB_TTL_MS,
  MAX_ACTIVE_JOBS,
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

export interface Job {
  id: string;
  stage: JobStage;
  progress: number; // 0..1
  etaSeconds: number | null;
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
): Job {
  if (jobs.size >= MAX_ACTIVE_JOBS) {
    throw new Error('Превышен лимит одновременных заданий. Попробуйте позже.');
  }

  cleanupExpiredJobs();

  const job: Job = {
    id: randomUUID(),
    stage: 'uploaded',
    progress: 0.02,
    etaSeconds: null,
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
  };
  jobs.set(job.id, job);

  // Safety TTL: отменяем задание, если оно зависло
  const ttlTimer = setTimeout(() => {
    if (!isTerminal(job)) {
      job.stage = 'cancelled';
      job.message = 'Задание отменено по таймауту';
      job.etaSeconds = null;
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
    etaSeconds: job.etaSeconds,
    message: job.message,
    error: job.error,
    pendingConfirmation: job.pendingConfirmation,
    reportReady: job.reportReady,
    reasoningLog: job.reasoningLog,
    files: job.files,
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
  const nonNull = colValues.filter((v): v is number => v !== null);
  if (new Set(nonNull).size !== nonNull.length) return false;

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
