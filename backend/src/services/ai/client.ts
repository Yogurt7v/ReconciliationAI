/**
 * Минимальный клиент OpenRouter (OpenAI-совместимый Chat Completions API).
 *
 * Особенности:
 *  - JSON mode: ответ модели обязан быть валидным JSON;
 *  - таймаут на запрос и один повтор при сетевой ошибке/5xx/таймауте;
 *  - деградированный режим: без ключа или при ошибке вызывающий код
 *    откатывается к эвристикам/правилам, а деградация фиксируется в reasoning.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface AiConfig {
  apiKey: string | null;
  model: string;
}

/** Конфиг из окружения (читается в момент вызова — удобно для тестов) */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    apiKey: env.OPENROUTER_API_KEY?.trim() || null,
    model: env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini',
  };
}

export class AiUnavailableError extends Error {
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
    return this.status >= 500 || this.status === 429;
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

const REQUEST_TIMEOUT_MS = 30_000;

async function callOnce(
  config: AiConfig,
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        // Заголовки OpenRouter рекомендует для атрибуции
        'HTTP-Referer': 'https://reconciliation-ai.local',
        'X-Title': 'Reconciliation AI Agent',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 2000,
      }),
    });

    const body = (await res.json().catch(() => null)) as ChatResponse | null;

    if (!res.ok) {
      const detail = body?.error?.message ?? `HTTP ${res.status}`;
      // 4xx (кроме 429) — повторять бессмысленно
      throw new AiUnavailableError(
        res.status >= 400 && res.status < 500 && res.status !== 429
          ? 'Модель OpenRouter отклонила запрос'
          : 'Ошибка запроса к OpenRouter',
        detail,
        res.status,
      );
    }

    const content = body?.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiUnavailableError('Пустой ответ модели');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Запрос с ожиданием JSON-ответа. Таймаут + ровно один повтор
 * при сетевой ошибке/таймауте/5xx/429.
 */
export async function requestJson<T>(
  config: AiConfig,
  systemPrompt: string,
  userPayload: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  if (!config.apiKey) {
    throw new AiUnavailableError('OPENROUTER_API_KEY не задан');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(userPayload) },
  ];

  let lastError: AiUnavailableError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content = await callOnce(config, messages, timeoutMs);
      try {
        return JSON.parse(content) as T;
      } catch {
        throw new AiUnavailableError('Ответ модели не является валидным JSON', content.slice(0, 300));
      }
    } catch (err) {
      lastError =
        err instanceof AiUnavailableError
          ? err
          : new AiUnavailableError('Сетевая ошибка OpenRouter', String(err));
      if (!lastError.retryable) break;
    }
  }
  throw lastError ?? new AiUnavailableError('Неизвестная ошибка OpenRouter');
}
