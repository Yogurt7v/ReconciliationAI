/**
 * Минимальный клиент OpenRouter (OpenAI-совместимый Chat Completions API).
 *
 * Особенности:
 *  - таймаут на запрос и один повтор при сетевой ошибке/5xx/таймауте;
 *  - деградированный режим: без ключа или при ошибке вызывающий код
 *    откатывается к эвристикам/правилам, а деградация фиксируется в reasoning;
 *  - debug-информация для диагностики на фронтенде;
 *  - поддержка выбора модели и graceful degradation через fallback-модели.
 */

import type { AiDebugInfo } from '@recon/shared';

export type { AiDebugInfo };

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Fallback-модели в порядке приоритета (от более умной к более доступной)
export const FALLBACK_MODELS = [
  'meta-llama/llama-3-70b-instruct',
  'mistralai/mistral-large',
  'qwen/qwen-2.5-coder-32b-instruct',
];

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
  debug?: AiDebugInfo;
  fallbackUsed?: boolean;

  constructor(
    message: string,
    readonly detail?: string,
    /** HTTP-статус ответа OpenRouter, если был; network-ошибки без статуса */
    readonly status?: number,
    /** Была ли использована fallback-модель */
    fallbackUsed = false,
  ) {
    super(message);
    this.name = 'AiUnavailableError';
    this.fallbackUsed = fallbackUsed;
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

  // Список моделей для попытки: основная + fallback
  const modelsToTry = [config.model, ...FALLBACK_MODELS.filter(m => m !== config.model)];
  let fallbackUsed = false;

  const debug: AiDebugInfo = {
    model: config.model,
    httpStatus: null,
    contentLength: 0,
    errorMessage: null,
    rawPreview: null,
    attempts: 0,
  };

  let lastError: AiUnavailableError | null = null;

  for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    const currentModel = modelsToTry[modelIndex];
    if (!currentModel) continue; // Пропускаем undefined модели
    
    if (modelIndex > 0) {
      fallbackUsed = true;
      console.warn(`[AI] Основная модель недоступна, пробуем fallback: ${currentModel}`);
    }
    
    // Для каждой модели пробуем до 2 раз (основная попытка + 1 retry)
    for (let attempt = 0; attempt < 2; attempt++) {
      debug.attempts = modelIndex * 2 + attempt + 1;
      debug.model = currentModel;
      
      try {
        const result = await callOnce({ ...config, model: currentModel }, messages, timeoutMs);
        debug.httpStatus = result.httpStatus;
        debug.contentLength = result.content.length;
        debug.errorMessage = result.errorMessage;
        debug.rawPreview = result.content.slice(0, 500);

        if (!result.content) {
          throw new AiUnavailableError('Пустой ответ модели', undefined, undefined, fallbackUsed);
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
            undefined,
            fallbackUsed,
          );
        }
      } catch (err) {
        lastError =
          err instanceof AiUnavailableError
            ? err
            : new AiUnavailableError('Сетевая ошибка OpenRouter', String(err), undefined, fallbackUsed);
        debug.errorMessage = lastError.detail ?? lastError.message;
        
        if (!lastError.retryable) break;
        // Задержка перед повтором только внутри одной модели
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    
    // Если модель исчерпана и это был fallback, переходим к следующей
    if (modelIndex < modelsToTry.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  
  // Все модели исчерпаны
  if (lastError) {
    lastError.debug = debug;
    lastError.fallbackUsed = fallbackUsed;
    throw lastError;
  }
  const fallback = new AiUnavailableError('Неизвестная ошибка OpenRouter', undefined, undefined, fallbackUsed);
  fallback.debug = debug;
  throw fallback;
}
