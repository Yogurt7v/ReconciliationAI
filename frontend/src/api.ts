import type { AiDebugInfo, CompareResult, Transaction } from '@recon/shared';

export type { AiDebugInfo, CompareResult, Transaction };

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

export const api = {
  testAnalyze(file: File, model?: string, apiKey?: string): Promise<TestAnalyzeResponse> {
    const form = new FormData();
    form.append('file', file);
    if (model) form.append('model', model);
    if (apiKey) form.append('apiKey', apiKey);
    return request('/api/test/analyze', { method: 'POST', body: form });
  },

  compare(ours: DocumentData, partner: DocumentData, model?: string, apiKey?: string): Promise<CompareResult & { debug?: AiDebugInfo }> {
    return request('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ours, partner, model, apiKey }),
    });
  },
};
