/**
 * Минимальный клиент OpenRouter (OpenAI-совместимый Chat Completions API).
 *
 * Особенности:
 *  - таймаут на запрос и один повтор при сетевой ошибке/5xx/таймауте;
 *  - деградированный режим: без ключа или при ошибке вызывающий код
 *    откатывается к эвристикам/правилам, а деградация фиксируется в reasoning;
 *  - debug-информация для диагностики на фронтенде.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface AiConfig {
  apiKey: string | null;
  model: string;
}

/** Диагностическая информация о вызове AI */
export interface AiDebugInfo {
  model: string;
  httpStatus: number | null;
  contentLength: number;
  errorMessage: string | null;
  rawPreview: string | null;
  attempts: number;
}

/** Конфиг из окружения (читается в момент вызова — удобно для тестов) */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    apiKey: env.OPENROUTER_API_KEY?.trim() || null,
    model: env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini',
  };
}

export class AiUnavailableError extends Error {
  debug?: AiDebugInfo;

  constructor(
    message: string,
    readonly detail?: string,
    /** HTTP-статус ответа OpenRouter, если был; network-ошибки без статуса */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }

  /** Повтор имеет смысл только для «временных» проблем */
  get retryable(): boolean {
    if (this.status === undefined) return true; // сеть/таймаут
    return this.status >= 500;
  }
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatChoice {
  message?: { content?: string | null };
}

interface ChatResponse {
  choices?: ChatChoice[];
  error?: { message?: string };
}

interface CallResult {
  content: string;
  httpStatus: number;
  errorMessage: string | null;
}

const REQUEST_TIMEOUT_MS = 30_000;

async function callOnce(
  config: AiConfig,
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://reconciliation-ai.local',
        'X-Title': 'Reconciliation AI Agent',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0,
        max_tokens: 4000,
      }),
    });

    const body = (await res.json().catch(() => null)) as ChatResponse | null;

    if (!res.ok) {
      const detail = body?.error?.message ?? `HTTP ${res.status}`;
      throw new AiUnavailableError(
        res.status >= 400 && res.status < 500 && res.status !== 429
          ? 'Модель OpenRouter отклонила запрос'
          : 'Ошибка запроса к OpenRouter',
        detail,
        res.status,
      );
    }

    const content = body?.choices?.[0]?.message?.content ?? '';
    return {
      content,
      httpStatus: res.status,
      errorMessage: body?.error?.message ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Запрос с ожиданием JSON-ответа. Таймаут + ровно один повтор
 * при сетевой ошибке/таймауте/5xx/429.
 *
 * Возвращает { data, debug } — данные и диагностическая информация.
 */
export async function requestJson<T>(
  config: AiConfig,
  systemPrompt: string,
  userPayload: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ data: T; debug: AiDebugInfo }> {
  if (!config.apiKey) {
    throw new AiUnavailableError('OPENROUTER_API_KEY не задан');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(userPayload) },
  ];

  const debug: AiDebugInfo = {
    model: config.model,
    httpStatus: null,
    contentLength: 0,
    errorMessage: null,
    rawPreview: null,
    attempts: 0,
  };

  let lastError: AiUnavailableError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    debug.attempts = attempt + 1;
    try {
      const result = await callOnce(config, messages, timeoutMs);
      debug.httpStatus = result.httpStatus;
      debug.contentLength = result.content.length;
      debug.errorMessage = result.errorMessage;
      debug.rawPreview = result.content.slice(0, 500);

      if (!result.content) {
        throw new AiUnavailableError('Пустой ответ модели');
      }

      try {
        const cleaned = result.content
          .replace(/^```(?:json)?\s*\n?/i, '')
          .replace(/\n?\s*```\s*$/i, '')
          .trim();
        const data = JSON.parse(cleaned) as T;
        return { data, debug };
      } catch {
        throw new AiUnavailableError(
          'Ответ модели не является валидным JSON',
          result.content.slice(0, 300),
        );
      }
    } catch (err) {
      lastError =
        err instanceof AiUnavailableError
          ? err
          : new AiUnavailableError('Сетевая ошибка OpenRouter', String(err));
      debug.errorMessage = lastError.detail ?? lastError.message;
      if (!lastError.retryable) break;
    }
  }
  if (lastError) {
    lastError.debug = debug;
    throw lastError;
  }
  const fallback = new AiUnavailableError('Неизвестная ошибка OpenRouter');
  fallback.debug = debug;
  throw fallback;
}
