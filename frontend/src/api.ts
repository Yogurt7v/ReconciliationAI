const API_URL = 'http://localhost:3001';

export interface AnalysisResult {
  extractedData: any[];
  reasoningLog: string[];
  warnings?: string[];
}

export interface ComparisonResult {
  matches: any[];
  discrepancies: any[];
  summary: string;
}

export async function testAnalyze(
  files: File[],
  apiKey?: string,
  model?: string
): Promise<AnalysisResult> {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));

  const headers: HeadersInit = {};
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (model) headers['X-Model'] = model;

  const response = await fetch(`${API_URL}/api/test/analyze`, {
    method: 'POST',
    body: formData,
    headers
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 503) {
      throw new Error(`AI недоступен: ${errorData.details || 'Попробуйте другую модель'}`);
    }
    throw new Error(errorData.error || 'Ошибка анализа');
  }

  return response.json();
}

export async function compareDocuments(
  files: File[],
  apiKey?: string,
  model?: string
): Promise<ComparisonResult> {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));

  const headers: HeadersInit = {};
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (model) headers['X-Model'] = model;

  const response = await fetch(`${API_URL}/api/compare`, {
    method: 'POST',
    body: formData,
    headers
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Ошибка сравнения');
  }

  return response.json();
}

export async function generateReport(data: any, format: string = 'html'): Promise<string> {
  const response = await fetch(`${API_URL}/api/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, format })
  });

  if (!response.ok) throw new Error('Ошибка генерации отчета');

  const result = await response.json();
  return `${API_URL}${result.url}`;
}
