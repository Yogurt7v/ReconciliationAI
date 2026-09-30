/**
 * Клиент локальной модели Ollama (OpenAI-совместимый Chat Completions API).
 *
 * Приложение работает только с локальной моделью: адрес, имя модели и
 * таймаут берутся из settings.txt. Ключей API нет — облачные провайдеры
 * и цепочки запасных моделей удалены как класс.
 *
 * Особенности:
 *  - таймаут на запрос и один повтор при 5xx/сети/таймауте;
 *  - деградация: при недоступности модели вызывающий код откатывается
 *    к эвристикам/правилам, а деградация фиксируется в reasoning;
 *  - debug-информация для диагностики на фронтенде.
 */

import type { AiDebugInfo } from '@recon/shared';
import type { Settings } from '../../settings.js';

export type { AiDebugInfo };

/** Повтор при временной ошибке (5xx / сеть / таймаут) */
const PRIMARY_MAX_ATTEMPTS = 2;

export interface AiConfig {
  /** Базовый URL Chat Completions API (включая /chat/completions) */
  baseUrl: string;
  model: string;
  /** Таймаут одного запроса, мс */
  timeoutMs: number;
}

/**
 * Конфигурация запросов к модели из настроек приложения.
 * Принимает только нужные поля, поэтому в тестах достаточно передать литерал.
 */
export function aiConfigFromSettings(
  settings: Pick<Settings, 'ollamaBaseUrl' | 'ollamaModel' | 'aiTimeoutSec'>,
): AiConfig {
  return {
    baseUrl: `${settings.ollamaBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`,
    model: settings.ollamaModel,
    timeoutMs: settings.aiTimeoutSec * 1000,
  };
}

export class AiUnavailableError extends Error {
  debug?: AiDebugInfo;

  constructor(
    message: string,
    readonly detail?: string,
    /** HTTP-статус ответа модели, если был; network-ошибки без статуса */
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

/** Фаза события телеметрии AI-вызова */
export type AiProgressPhase = 'attempt' | 'success' | 'retry';

/**
 * Событие телеметрии: вызывающий код может показывать его в статусе задания,
 * чтобы пользователь видел, что модель работает, а не зависла.
 */
export interface AiProgressEvent {
  phase: AiProgressPhase;
  /** Номер текущей попытки, с 1 */
  attempt: number;
  maxAttempts: number;
  /** Сколько длилась попытка, мс (только success/retry) */
  elapsedMs?: number;
  /** Длина полученного контента, символов (success) */
  contentLength?: number;
  /** Причина ошибки (retry) */
  error?: string;
  /** Что именно делает модель — попадает в статус задания */
  label?: string;
}

export type AiProgressCallback = (event: AiProgressEvent) => void;

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)} с`;
}

/** Человекочитаемое сообщение для статуса задания */
export function aiProgressText(event: AiProgressEvent): string {
  const prefix = event.label
    ? `${event.label.charAt(0).toUpperCase()}${event.label.slice(1)}: `
    : '';
  if (event.phase === 'attempt') {
    return event.attempt > 1
      ? `${prefix}модель не ответила, повторная попытка ${event.attempt}/${event.maxAttempts}…`
      : `${prefix}модель анализирует данные…`;
  }
  if (event.phase === 'success') {
    return `${prefix}готово за ${formatElapsed(event.elapsedMs ?? 0)}`;
  }
  return `${prefix}модель не ответила за ${formatElapsed(event.elapsedMs ?? 0)}, повтор…`;
}

async function callOnce(
  config: AiConfig,
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(config.baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        // Ollama не проверяет ключ, но требует непустой Bearer
        Authorization: 'Bearer ollama',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0,
        max_tokens: 4000,
        // Reasoning-модели тратят на внутренний разум тысячи токенов до первого
        // символа ответа: на реальных промптах пайплайна запрос не успевает
        // уложиться в AI_TIMEOUT_SEC и обрывается пустым. Выключаем reasoning —
        // модели без этой настройки параметр игнорируют.
        reasoning_effort: 'none',
      }),
    });

    const body = (await res.json().catch(() => null)) as ChatResponse | null;

    if (!res.ok) {
      const detail = body?.error?.message ?? `HTTP ${res.status}`;
      throw new AiUnavailableError(
        res.status >= 400 && res.status < 500 && res.status !== 429
          ? `Модель ${config.model} отклонила запрос`
          : `Ошибка запроса к модели ${config.model}`,
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
 * Запрос с ожиданием JSON-ответа. Таймаут из настроек + ровно один повтор
 * при сетевой ошибке/таймауте/5xx/429.
 *
 * Возвращает { data, debug } — данные и диагностическая информация.
 * `options.onProgress` получает события на каждой попытке — это единственный
 * способ показать пользователю, что модель работает, а не зависла.
 */
export async function requestJson<T>(
  config: AiConfig,
  systemPrompt: string,
  userPayload: unknown,
  options: {
    /** Таймаут одной попытки, мс (по умолчанию из настроек) */
    timeoutMs?: number;
    onProgress?: AiProgressCallback;
    /** Метка вызывающего контекста для логов (например, «двухсторонний акт») */
    label?: string;
  } = {},
): Promise<{ data: T; debug: AiDebugInfo }> {
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const onProgress = options.onProgress;
  const label = options.label ? ` [${options.label}]` : '';
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

  for (let attempt = 0; attempt < PRIMARY_MAX_ATTEMPTS; attempt++) {
    debug.attempts++;
    const attemptNo = attempt + 1;
    const startedAt = Date.now();
    const emit = (event: Omit<AiProgressEvent, 'attempt' | 'maxAttempts'>): void => {
      onProgress?.({
        ...event,
        attempt: attemptNo,
        maxAttempts: PRIMARY_MAX_ATTEMPTS,
        label: options.label,
      });
    };

    console.log(
      `[AI]${label} попытка ${attemptNo}/${PRIMARY_MAX_ATTEMPTS}, model=${config.model}, таймаут=${timeoutMs} мс`,
    );
    emit({ phase: 'attempt' });

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
        const elapsedMs = Date.now() - startedAt;
        console.log(
          `[AI]${label} ok за ${(elapsedMs / 1000).toFixed(1)} с, символов=${result.content.length}, попыток=${debug.attempts}`,
        );
        emit({ phase: 'success', elapsedMs, contentLength: result.content.length });
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
          : new AiUnavailableError('Сетевая ошибка при обращении к модели', String(err));
      debug.errorMessage = lastError.detail ?? lastError.message;
      debug.httpStatus = lastError.status ?? debug.httpStatus;

      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[AI]${label} ошибка за ${(elapsedMs / 1000).toFixed(1)} с: ${lastError.message}` +
          `${lastError.detail ? ` (${lastError.detail.slice(0, 200)})` : ''}`,
      );

      // Невременная ошибка (400/401/404...) — повтор не поможет.
      if (!lastError.retryable) break;

      // Событие «повтор» — только если повтор реально будет
      if (attempt + 1 < PRIMARY_MAX_ATTEMPTS) {
        emit({ phase: 'retry', elapsedMs, error: lastError.message });
      }

      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  const error = lastError ?? new AiUnavailableError('Неизвестная ошибка AI-провайдера');
  error.debug = debug;
  throw error;
}
