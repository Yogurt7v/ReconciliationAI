import type {
  AiDebugInfo,
  CompareResult,
  ConfirmPayload,
  JobStatus,
  ReconciliationReport,
  Transaction,
} from '@recon/shared';

export type { AiDebugInfo, CompareResult, JobStatus, ReconciliationReport, Transaction };

declare global {
  interface Window {
    /** Заполняется скриптом /config.js, который отдаёт backend */
    __RECON_CONFIG__?: { apiBaseUrl?: string };
  }
}

/**
 * Базовый URL API. Пусто (по умолчанию) — запросы идут на тот же origin,
 * откуда открыт интерфейс. Значение приходит из settings.txt → /config.js,
 * поэтому переключение режима доступа (127.0.0.1 / 0.0.0.0) не требует
 * пересборки фронтенда.
 */
const API_BASE = (window.__RECON_CONFIG__?.apiBaseUrl ?? '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export class ApiError extends Error {
  debug?: AiDebugInfo;

  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(url), init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Ошибка запроса (${res.status})`;
    const err = new ApiError(message, res.status);
    if (body !== null && typeof body === 'object' && 'debug' in body) {
      err.debug = body.debug as AiDebugInfo;
    }
    throw err;
  }
  return body as T;
}

export interface Contract {
  name: string;
  openingBalance: number;
  closingBalance: number;
  turnoverDebit: number | null;
  turnoverCredit: number | null;
  transactions: Transaction[];
}

export interface DocumentData {
  totalRows: number;
  openingBalance: number;
  closingBalance: number;
  turnoverDebit: number | null;
  turnoverCredit: number | null;
  contracts: Contract[];
}

export interface TestAnalyzeResponse {
  fileName: string;
  sourceKind: string;
  sheetName: string | null;
  pages: number | null;
  result: DocumentData;
  /** Проблемы согласованности данных, найденные при валидации */
  warnings?: string[];
  debug: AiDebugInfo;
}

/**
 * Фактическая AI-конфигурация backend (GET /api/health).
 * Модель берётся из settings.txt и приходит сюда только для показа —
 * выбрать её из интерфейса нельзя.
 */
export interface AiRuntimeInfo {
  provider: 'ollama';
  /** Модель, которая реально применяется (OLLAMA_MODEL) */
  model: string;
}

export const api = {
  health(): Promise<{ ok: boolean; ai: AiRuntimeInfo }> {
    return request('/api/health');
  },

  testAnalyze(file: File): Promise<TestAnalyzeResponse> {
    const form = new FormData();
    form.append('file', file);
    return request('/api/test/analyze', { method: 'POST', body: form });
  },

  compare(ours: DocumentData, partner: DocumentData): Promise<CompareResult & { debug?: AiDebugInfo }> {
    return request('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ours, partner }),
    });
  },

  /* --------------------- Полный пайплайн сверки ------------------------ */

  /** Загружает пару файлов и запускает пайплайн. Возвращает первый статус. */
  createJob(ours: File, partner: File, twoSided = false): Promise<JobStatus> {
    const form = new FormData();
    form.append('ours', ours);
    form.append('partner', partner);
    if (twoSided) form.append('twoSided', 'true');
    return request('/api/jobs', { method: 'POST', body: form });
  },

  jobStatus(id: string): Promise<JobStatus> {
    return request(`/api/jobs/${id}`);
  },

  confirmJobMapping(id: string, payload: ConfirmPayload): Promise<JobStatus> {
    return request(`/api/jobs/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  cancelJob(id: string): Promise<JobStatus> {
    return request(`/api/jobs/${id}/cancel`, { method: 'POST' });
  },

  jobReport(id: string): Promise<ReconciliationReport> {
    return request(`/api/jobs/${id}/report`);
  },

  /** Ссылка на HTML-отчёт — открывается в новой вкладке, отчёт отдаётся сервером. */
  jobReportUrl(id: string): string {
    return apiUrl(`/api/jobs/${id}/report.html`);
  },
};
