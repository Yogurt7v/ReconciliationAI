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

export interface AiCompareResult {
  balanceCheck: {
    openingA: number;
    openingB: number;
    closingA: number;
    closingB: number;
    match: boolean;
    diff: number;
  };
  turnoverCheck: {
    debitA: number;
    creditA: number;
    debitB: number;
    creditB: number;
    debitMatch: boolean;
    creditMatch: boolean;
  };
  aiAnalysis: string;
  rows: ComparisonRow[];
  aiFallback?: boolean;
}

export interface MatchedPair {
  a: Transaction;
  b: Transaction;
  amountMatch: boolean;
  diff: number;
}

export type DocType = 'продажа' | 'приход' | 'оплата' | 'остаток' | 'прочее';

export interface ComparisonRow {
  side: 'A' | 'B';
  tx: Transaction;
  docType: DocType;
  matchedWith: Transaction | null;
  status: 'match' | 'partial' | 'unmatched';
  diff?: number;
}

export interface ComparisonResult {
  balanceCheck: {
    openingA: number;
    openingB: number;
    closingA: number;
    closingB: number;
    match: boolean;
    diff: number;
  };
  turnoverCheck: {
    debitA: number;
    creditA: number;
    debitB: number;
    creditB: number;
    debitA_eq_debitB: boolean;
    creditA_eq_creditB: boolean;
  };
  rows: ComparisonRow[];
}

export type PairStatus = 'match' | 'partial' | 'unmatched-a' | 'unmatched-b';

export interface ComparisonPair {
  index: number;
  pairStatus: PairStatus;
  typeA: DocType;
  typeB: DocType;
  a: ComparisonRow | null;
  b: ComparisonRow | null;
  diff?: number;
}

export const api = {
  testAnalyze(file: File): Promise<TestAnalyzeResponse> {
    const form = new FormData();
    form.append('file', file);
    return request('/api/test/analyze', { method: 'POST', body: form });
  },

  compare(ours: DocumentData, partner: DocumentData): Promise<AiCompareResult> {
    return request('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ours, partner }),
    });
  },
};
