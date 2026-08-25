import type {
  ConfirmPayload,
  JobStatus,
  ReconciliationReport,
} from '@recon/shared';

export class ApiError extends Error {
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
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const api = {
  upload(ours: File, partner: File): Promise<{ id: string }> {
    const form = new FormData();
    form.append('ours', ours);
    form.append('partner', partner);
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
