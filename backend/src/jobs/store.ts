/**
 * Хранилище заданий сверки (in-memory Map). Процесс-синглтон: задания живут
 * в памяти backend'а, отчёты — вместе с заданием.
 */

import { randomUUID } from 'node:crypto';

import type {
  ColumnMapping,
  ConfirmPayload,
  JobStage,
  JobStatus,
  PendingConfirmation,
  RawSource,
  ReasoningStep,
  ReconciliationReport,
  SideRole,
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

export function createJob(
  files: { ours: string; partner: string },
  buffers: { ours: Buffer; partner: Buffer },
  twoSidedRequested = false,
): Job {
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
