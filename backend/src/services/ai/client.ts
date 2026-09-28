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

// Fallback-модели для облачного режима (OpenRouter)
const OPENROUTER_FALLBACK_MODELS = [
  'meta-llama/llama-3-70b-instruct',
  'mistralai/mistral-large',
  'qwen/qwen-2.5-coder-32b-instruct',
];

// Fallback-модели для локального режима (Ollama) по умолчанию.
// По REQUIRE_LOCAL_ONLY (см. ниже) fallback-цепочка ОТКЛЮЧЕНА: используется
// только выбранная локальная модель, без автопереключений на другие модели.
// Чтобы вернуть цепочку — задайте в .env: LOCAL_FALLBACK_ENABLED=true
// и при желании свой список OLLAMA_FALLBACK_MODELS через запятую.
const DEFAULT_OLLAMA_FALLBACK_MODELS: string[] = [];

/**
 * Требование пользователя: использовать ТОЛЬКО локальную модель Ollama.
 * - все облачные вызовы (OpenRouter) отключены;
 * - fallback на другие модели (облачные и локальные) отключен;
 * - при недоступности локальной модели система деградирует к эвристикам,
 *   а не обращается к другим распознавателям.
 * Переопределяется в .env: REQUIRE_LOCAL_ONLY=false
 */
export const REQUIRE_LOCAL_ONLY =
  (process.env.REQUIRE_LOCAL_ONLY ?? 'true').trim().toLowerCase() !== 'false';

export type AiProvider = 'openrouter' | 'ollama';

export interface AiConfig {
  apiKey: string | null;
  model: string;
  /** Базовый URL Chat Completions API (включая /chat/completions) */
  baseUrl: string;
  provider: AiProvider;
  /** Цепочка запасных моделей (без основной) */
  fallbackModels: string[];
}

/** Разбор строки списка моделей ("a,b,c") */
function parseModelList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Авто-переключение провайдера по ID модели.
 * Пользователь может выбрать локальную модель (qwen2.5:7b-instruct, llama3.1:8b и т.п.)
 * в UI даже когда backend запущен в облачном режиме (AI_PROVIDER=openrouter).
 * Признак Ollama-модели — отсутствие namespace-префикса "vendor/" и наличие тега ":версия"
 * (Ollama-нотация), либо префикс "ollama/".
 */
export function looksLikeOllamaModel(model: string): boolean {
  const m = model.trim();
  if (!m) return false;
  if (m.startsWith('ollama/')) return true;
  // OpenRouter-модели всегда содержат "/" (например openai/gpt-4o-mini)
  if (m.includes('/')) return false;
  // Ollama-модели обычно имеют тег (qwen2.5:7b-instruct, llama3.2:3b)
  return /:[\w.-]+$/.test(m);
}

/** URL Chat Completions API для Ollama (OpenAI-совместимый эндпоинт) */
function ollamaBaseUrlFromEnv(env: NodeJS.ProcessEnv): string {
  const host = env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434';
  return `${host.replace(/\/$/, '')}/v1/chat/completions`;
}

/** Fallback-цепочка для Ollama из env или по умолчанию */
function ollamaFallbacksFromEnv(env: NodeJS.ProcessEnv): string[] {
  // REQUIRE_LOCAL_ONLY (по умолчанию true) — локальная модель используется
  // строго одна, без переключений на другие распознаватели.
  if (isLocalOnly(env)) return [];
  // Явное включение цепочки: LOCAL_FALLBACK_ENABLED=true
  const enabled = env.LOCAL_FALLBACK_ENABLED?.trim().toLowerCase() === 'true';
  if (!enabled) return [];
  const parsed = parseModelList(env.OLLAMA_FALLBACK_MODELS);
  return parsed.length > 0 ? parsed : DEFAULT_OLLAMA_FALLBACK_MODELS;
}

/** Флаг "только локально" с учётом env (для тестов можно передать свой env) */
export function isLocalOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.REQUIRE_LOCAL_ONLY ?? 'true').trim().toLowerCase() !== 'false';
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
      apiKey: 'ollama', // ключ не проверяется, но нужен формат Bearer
      model:
        clientModel && looksLikeOllamaModel(clientModel)
          ? clientModel
          : env.OLLAMA_MODEL?.trim() || base.model,
      fallbackModels: [],
    };
  }

  if (!clientModel || clientModel === base.model) return config;

  if (looksLikeOllamaModel(clientModel) && base.provider !== 'ollama') {
    return {
      ...config,
      provider: 'ollama',
      baseUrl: ollamaBaseUrlFromEnv(env),
      // Ключ для Ollama не нужен, но формат Bearer требует непустого значения
      apiKey: config.apiKey || 'ollama',
      fallbackModels: ollamaFallbacksFromEnv(env).filter((m) => m !== clientModel),
    };
  }

  if (!looksLikeOllamaModel(clientModel) && base.provider === 'ollama') {
    return {
      ...config,
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      fallbackModels: parseModelList(env.OPENROUTER_FALLBACKS).length > 0
        ? parseModelList(env.OPENROUTER_FALLBACKS)
        : OPENROUTER_FALLBACK_MODELS,
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
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    provider: 'openrouter',
    fallbackModels: parseModelList(env.OPENROUTER_FALLBACKS) .length > 0
      ? parseModelList(env.OPENROUTER_FALLBACKS)
      : OPENROUTER_FALLBACK_MODELS,
  };
}

/** Экспорт для совместимости со старым кодом/тестами */
export const FALLBACK_MODELS = OPENROUTER_FALLBACK_MODELS;

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
  if (REQUIRE_LOCAL_ONLY && config.provider !== 'ollama') {
    throw new AiUnavailableError(
      'Облачные модели отключены (REQUIRE_LOCAL_ONLY=true). Разрешено использовать только локальную модель Ollama.',
    );
  }

  if (!config.apiKey) {
    throw new AiUnavailableError('OPENROUTER_API_KEY не задан');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(userPayload) },
  ];

  // Список моделей для попытки: основная + fallback (без дубликатов).
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
            : new AiUnavailableError('Сетевая ошибка AI-провайдера', String(err), undefined, fallbackUsed);
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
  const fallback = new AiUnavailableError('Неизвестная ошибка AI-провайдера', undefined, undefined, fallbackUsed);
  fallback.debug = debug;
  throw fallback;
}
