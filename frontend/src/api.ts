import type {
  ConfirmPayload,
  JobStatus,
  ReconciliationReport,
} from '@recon/shared';

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
  const res = await fetch(url, init);
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

export interface Transaction {
  date: string;
  document: string;
  debit: number | null;
  credit: number | null;
}

export interface BalanceCheck {
  expected: number | null;
  actual: number | null;
  match: boolean;
}

export interface DocumentData {
  totalRows: number;
  openingBalance: number | null;
  closingBalance: number | null;
  turnoverDebit: number | null;
  turnoverCredit: number | null;
  balanceCheck: BalanceCheck;
  transactions: Transaction[];
}

export interface AiDebugInfo {
  model: string;
  httpStatus: number | null;
  contentLength: number;
  errorMessage: string | null;
  rawPreview: string | null;
  attempts: number;
}

export interface TestAnalyzeResponse {
  fileName: string;
  sourceKind: string;
  sheetName: string | null;
  pages: number | null;
  result: DocumentData;
  debug: AiDebugInfo;
}

export const api = {
  testAnalyze(file: File): Promise<TestAnalyzeResponse> {
    const form = new FormData();
    form.append('file', file);
    return request('/api/test/analyze', { method: 'POST', body: form });
  },

  upload(ours: File, partner: File | null, twoSided = false): Promise<{ id: string }> {
    const form = new FormData();
    form.append('ours', ours);
    if (partner) form.append('partner', partner);
    if (twoSided) form.append('twoSided', 'true');
    return request('/api/upload', { method: 'POST', body: form });
  },

  status(jobId: string): Promise<JobStatus> {
    return request(`/api/jobs/${jobId}/status`);
  },

  confirm(jobId: string, payload: ConfirmPayload): Promise<{ ok: boolean }> {
    return request(`/api/jobs/${jobId}/mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  report(jobId: string): Promise<ReconciliationReport> {
    return request(`/api/jobs/${jobId}/report?format=json`);
  },

  cancel(jobId: string): Promise<{ ok: boolean }> {
    return request(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  },
};

export function formatMoney(value: string | null): string {
  return value ?? '—';
}
