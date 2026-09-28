/**
 * Клиент OpenAI-совместимого Chat Completions API (OpenRouter и Ollama).
 *
 * Особенности:
 *  - таймаут на запрос и ограниченный бюджет повторов;
 *  - деградированный режим: без ключа или при ошибке вызывающий код
 *    откатывается к эвристикам/правилам, а деградация фиксируется в reasoning;
 *  - debug-информация для диагностики на фронтенде;
 *  - поддержка выбора модели и graceful degradation через fallback-модели.
 */

import type { AiDebugInfo } from '@recon/shared';

export type { AiDebugInfo };

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Fallback-модели в порядке приоритета (от более умной к более доступной).
// Переопределяются через AI_FALLBACK_MODELS (список через запятую, пустая строка — отключает).
export const DEFAULT_FALLBACK_MODELS = [
  'meta-llama/llama-3-70b-instruct',
  'mistralai/mistral-large',
];

// Бюджет запросов: основная модель — до 2 попыток (повтор при 5xx/сети),
// каждая fallback-модель — 1 попытка. Суммарно максимум ~4 запроса.
const PRIMARY_MAX_ATTEMPTS = 2;
const FALLBACK_MAX_ATTEMPTS = 1;

export type AiProvider = 'openrouter' | 'ollama';

/**
 * Флаг «только локально»: использовать ТОЛЬКО локальную модель Ollama.
 *  - облачные вызовы (OpenRouter) отключены;
 *  - fallback на другие модели отключен;
 *  - при недоступности локальной модели система деградирует к эвристикам.
 *
 * Единственный источник истины для этого флага в модуле. Переопределяется
 * в .env: REQUIRE_LOCAL_ONLY=false
 */
export function isLocalOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.REQUIRE_LOCAL_ONLY ?? 'true').trim().toLowerCase() !== 'false';
}

/** Разбор строки списка моделей ("a,b,c") */
function parseModelList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fallback-цепочка из env; пустая строка в переменной отключает fallback */
function fallbackModelsFromEnv(raw: string | undefined, defaults: string[]): string[] {
  if (raw === undefined) return defaults;
  return parseModelList(raw);
}

export interface AiConfig {
  apiKey: string | null;
  model: string;
  /** Базовый URL Chat Completions API (включая /chat/completions) */
  baseUrl: string;
  provider: AiProvider;
  /** Цепочка запасных моделей (без основной) */
  fallbackModels: string[];
}

/**
 * Признак локальной Ollama-модели.
 *  - префикс "ollama/";
 *  - наличие тега ":версия" (qwen2.5:7b-instruct, llama3.2:3b) — в этом режиме
 *    облачная модель невозможна, поэтому подходит любое имя без "/"
 *    (в т.ч. валидные Ollama-имена без тега: llama3.1, mistral);
 *  - иначе, если в env задан OLLAMA_MODEL, совпадение с ним.
 */
export function looksLikeOllamaModel(model: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const m = model.trim();
  if (!m) return false;
  if (m.startsWith('ollama/')) return true;
  // OpenRouter-модели всегда содержат "/" (например openai/gpt-4o-mini)
  if (m.includes('/')) return false;
  // В режиме "только локально" облачный провайдер недоступен: любое имя
  // без "/" считаем именем локальной модели, даже без тега.
  if (isLocalOnly(env)) return true;
  // Ollama-модели обычно имеют тег (qwen2.5:7b-instruct, llama3.2:3b)
  if (/:[\w.-]+$/.test(m)) return true;
  return m === env.OLLAMA_MODEL?.trim();
}

/** URL Chat Completions API для Ollama (OpenAI-совместимый эндпоинт) */
function ollamaBaseUrlFromEnv(env: NodeJS.ProcessEnv): string {
  const host = env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434';
  return `${host.replace(/\/$/, '')}/v1/chat/completions`;
}

/**
 * Fallback-цепочка для Ollama из OLLAMA_FALLBACK_MODELS.
 * В режиме "только локально" цепочка отключена: используется ровно одна модель,
 * чтобы не обращаться к другим распознавателям.
 */
function ollamaFallbacksFromEnv(env: NodeJS.ProcessEnv): string[] {
  if (isLocalOnly(env)) return [];
  return fallbackModelsFromEnv(env.OLLAMA_FALLBACK_MODELS, []);
}

/**
 * Применение клиентского выбора модели к конфигу окружения.
 * Если выбрана Ollama-модель, а конфиг облачный — переключаемся на локальный
 * провайдер (и наоборот), чтобы один backend мог обслуживать оба режима.
 */
export function applyClientOverrides(
  base: AiConfig,
  overrides: { model?: string | null; apiKey?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): AiConfig {
  const clientModel = overrides.model?.trim();
  const config: AiConfig = {
    ...base,
    model: clientModel || base.model,
    apiKey: overrides.apiKey?.trim() || base.apiKey,
  };

  // РЕЖИМ "ТОЛЬКО ЛОКАЛЬНО" (REQUIRE_LOCAL_ONLY=true по умолчанию):
  // любое клиентское переключение провайдеров запрещено. Всегда Ollama,
  // всегда без fallback-цепочки. Если клиент прислал облачную модель ID —
  // она игнорируется, остаётся локальная модель из env.
  if (isLocalOnly(env)) {
    return {
      ...config,
      provider: 'ollama',
      baseUrl: ollamaBaseUrlFromEnv(env),
      // Ollama не проверяет ключ, но формат Bearer требует непустого значения
      apiKey: env.OLLAMA_API_KEY?.trim() || 'ollama',
      model:
        clientModel && looksLikeOllamaModel(clientModel, env)
          ? clientModel
          : env.OLLAMA_MODEL?.trim() || base.model,
      fallbackModels: [],
    };
  }

  if (!clientModel || clientModel === base.model) return config;

  if (looksLikeOllamaModel(clientModel, env) && base.provider !== 'ollama') {
    return {
      ...config,
      provider: 'ollama',
      baseUrl: ollamaBaseUrlFromEnv(env),
      // Ключ для Ollama не нужен, но формат Bearer требует непустого значения
      apiKey: env.OLLAMA_API_KEY?.trim() || config.apiKey || 'ollama',
      fallbackModels: ollamaFallbacksFromEnv(env).filter((m) => m !== clientModel),
    };
  }

  if (!looksLikeOllamaModel(clientModel, env) && base.provider === 'ollama') {
    return {
      ...config,
      provider: 'openrouter',
      baseUrl: OPENROUTER_CHAT_URL,
      fallbackModels: fallbackModelsFromEnv(env.AI_FALLBACK_MODELS, DEFAULT_FALLBACK_MODELS),
    };
  }

  return config;
}

/** Конфиг из окружения (читается в момент вызова — удобно для тестов) */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig {
  // REQUIRE_LOCAL_ONLY=true по умолчанию: провайдер всегда ollama,
  // облачные вызовы (OpenRouter) полностью отключены.
  const provider: AiProvider =
    isLocalOnly(env) || env.AI_PROVIDER?.trim().toLowerCase() === 'ollama' ? 'ollama' : 'openrouter';

  if (provider === 'ollama') {
    // Внутри docker-compose: http://ollama:11434. На хосте: http://localhost:11434
    const host = env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434';
    return {
      apiKey: env.OLLAMA_API_KEY?.trim() || 'ollama', // Ollama не проверяет ключ, но поле обязательнее по формату Bearer
      model: env.OLLAMA_MODEL?.trim() || 'qwen2.5:7b-instruct',
      baseUrl: `${host.replace(/\/$/, '')}/v1/chat/completions`,
      provider: 'ollama',
      fallbackModels: ollamaFallbacksFromEnv(env),
    };
  }

  return {
    apiKey: env.OPENROUTER_API_KEY?.trim() || null,
    model: env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini',
    baseUrl: OPENROUTER_CHAT_URL,
    provider: 'openrouter',
    fallbackModels: fallbackModelsFromEnv(env.AI_FALLBACK_MODELS, DEFAULT_FALLBACK_MODELS),
  };
}

export class AiUnavailableError extends Error {
  debug?: AiDebugInfo;
  fallbackUsed?: boolean;

  constructor(
    message: string,
    readonly detail?: string,
    /** HTTP-статус ответа AI-провайдера, если был; network-ошибки без статуса */
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
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
    // Реферер/титул требует только OpenRouter
    if (config.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://reconciliation-ai.local';
      headers['X-Title'] = 'Reconciliation AI Agent';
    }

    const res = await fetch(config.baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers,
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
          ? `Модель ${config.provider} отклонила запрос`
          : `Ошибка запроса к ${config.provider}`,
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
  // ЖЁСТКИЙ БЛОКИРОР: REQUIRE_LOCAL_ONLY=true (по умолчанию) запрещает любые
  // обращения к облачным распознавателям. Даже если конфигурация по какой-то
  // причине получилась openrouter — запрос не будет отправлен.
  if (isLocalOnly() && config.provider !== 'ollama') {
    throw new AiUnavailableError(
      'Облачные модели отключены (REQUIRE_LOCAL_ONLY=true). Разрешено использовать только локальную модель Ollama.',
    );
  }

  if (!config.apiKey) {
    throw new AiUnavailableError(
      config.provider === 'ollama' ? 'OLLAMA_API_KEY не задан' : 'OPENROUTER_API_KEY не задан',
    );
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(userPayload) },
  ];

  // Список моделей для попытки: основная + fallback (без дубликатов, бюджет ограничен).
  // Цепочка приходит из config, поэтому тестируется без process.env.
  // В режиме "только локально" fallbackModels всегда пуст => ровно одна модель.
  const modelsToTry = [config.model, ...config.fallbackModels.filter((m) => m !== config.model)];
  let fallbackUsed = false;

  const debug: AiDebugInfo = {
    model: config.model,
    httpStatus: null,
    contentLength: 0,
    errorMessage: null,
    rawPreview: null,
    attempts: 0,
    fallbackUsed: false,
  };

  let lastError: AiUnavailableError | null = null;

  modelLoop: for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    const currentModel = modelsToTry[modelIndex]!;
    const isPrimary = modelIndex === 0;
    const maxAttempts = isPrimary ? PRIMARY_MAX_ATTEMPTS : FALLBACK_MAX_ATTEMPTS;

    if (!isPrimary) {
      fallbackUsed = true;
      console.warn(`[AI] Основная модель недоступна, пробуем fallback: ${currentModel}`);
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      debug.attempts++;
      debug.model = currentModel;
      debug.fallbackUsed = fallbackUsed;

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
            : new AiUnavailableError('Сетевая ошибка AI-провайдера', String(err), undefined, fallbackUsed);
        debug.errorMessage = lastError.detail ?? lastError.message;
        debug.httpStatus = lastError.status ?? debug.httpStatus;

        // Невременная ошибка (400/401/404...) — смена модели не поможет, стоп.
        if (!lastError.retryable) break modelLoop;

        // Повтор внутри одной модели: только первая попытка.
        if (attempt === 0 && maxAttempts > 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    // Никакой паузы между моделями — сразу следующая fallback-модель.
  }

  // Все модели исчерпаны
  if (lastError) {
    lastError.debug = debug;
    lastError.fallbackUsed = fallbackUsed;
    throw lastError;
  }
  const fallback = new AiUnavailableError('Неизвестная ошибка AI-провайдера', undefined, undefined, fallbackUsed);
  fallback.debug = debug;
  throw fallback;
}
