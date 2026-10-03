/**
 * Клиент модели: локальный Ollama и, по выбору оператора, удалённый OpenRouter.
 * Оба провайдера говорят на одном OpenAI-совместимом Chat Completions API,
 * поэтому различия собраны в одном месте — в `buildRequest`.
 *
 * Адрес и имя модели локальной модели берутся из settings.txt. Удалённый
 * профиль (идентификатор модели и API-ключ) присылает браузер, а **адрес
 * назначения задаёт сервер**: клиент не принимает `baseUrl` из запроса, иначе
 * локальный backend стал бы открытым прокси, уносящим ключ оператора на любой
 * хост по его выбору.
 *
 * Ключ живёт только в памяти процесса: он не пишется в настройки, не попадает в
 * лог, в текст ошибки и ни в один диагностический объект (см. `redact`).
 *
 * Особенности:
 *  - таймаут на запрос и один повтор при 5xx/сети/таймауте;
 *  - ошибка, которую повтор не исправит, помечена terminal — второй запрос
 *    против платного провайдера не отправляется (см. GAP-10);
 *  - деградация: при недоступности модели вызывающий код откатывается
 *    к эвристикам/правилам, а деградация фиксируется в reasoning;
 *  - запасной модели нет и быть не должно: `AiConfig` — это ровно один
 *    провайдер с ровно одной моделью, выбранной оператором явно. Отказ,
 *    который повтор не лечит, обязан дойти до оператора с названной причиной,
 *    а не раствориться в «попробуем локальную» — это была бы выдача чужого
 *    отчёта (см. `AGENTS.md`, раздел AI);
 *  - debug-информация для диагностики на фронтенде, включая модель, которая
 *    реально ответила, а не запрошенная.
 */

import type { AiDebugInfo, AiProvider } from '@recon/shared';
import type { Settings } from '../../settings.js';

import { OPENROUTER_CHAT_COMPLETIONS_URL } from './openrouter.js';
import type { ResolvedRemoteProfile } from './profile.js';

export type { AiDebugInfo };

/** Повтор при временной ошибке (5xx / сеть / таймаут) */
const PRIMARY_MAX_ATTEMPTS = 2;

/**
 * Как провайдера называть в сообщении об ошибке. Оператор должен из текста
 * понять, чей это адрес: у локальной модели и у шлюза причины неодинаковы.
 * Record по `AiProvider`, а не две строки в ветке: забытый провайдер — ошибка
 * компиляции, а не молчаливое «OpenRouter» у локальной модели.
 */
const PROVIDER_NAMES: Record<AiProvider, string> = {
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
};

/**
 * Значения `HTTP-Referer` и `X-OpenRouter-Title`, которые шлюз просит назвать
 * для атрибуции запроса.
 *
 * Они зафиксированы литералами и намеренно **не** выводятся из настроек:
 * `API_BASE_URL` — это адрес локального backend'а, и его публикация в заголовке
 * наружу раскрыла бы внутреннее имя хоста вместе с тем, что документ ушёл
 * на сторону.
 */
const OPENROUTER_REFERER = 'https://recon.local';
const OPENROUTER_TITLE = 'Reconciliation AI';

/** Конфигурация локальной модели Ollama */
export interface AiOllamaConfig {
  provider: 'ollama';
  /** Базовый URL Chat Completions API (включая /chat/completions) */
  baseUrl: string;
  model: string;
  /** Таймаут одного запроса, мс */
  timeoutMs: number;
}

/**
 * Конфигурация удалённого провайдера — ровно тот профиль, который вернул
 * `resolveClientProfile`. `provider` сужен до литерала: без этого union нельзя
 * было бы различать по провайдеру, а `apiKey` было бы видно у локальной ветки.
 */
export interface AiRemoteConfig extends ResolvedRemoteProfile {
  provider: 'openrouter';
}

/**
 * Конфигурация одного вызова AI. Различается по `provider`: локальная ветка
 * не несёт ключа, удалённая — несёт.
 */
export type AiConfig = AiOllamaConfig | AiRemoteConfig;

/**
 * Конфигурация запросов к локальной модели из настроек приложения.
 * Принимает только нужные поля, поэтому в тестах достаточно передать литерал.
 */
export function aiConfigFromSettings(
  settings: Pick<Settings, 'ollamaBaseUrl' | 'ollamaModel' | 'aiTimeoutSec'>,
): AiOllamaConfig {
  return {
    provider: 'ollama',
    baseUrl: `${settings.ollamaBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`,
    model: settings.ollamaModel,
    timeoutMs: settings.aiTimeoutSec * 1000,
  };
}

/**
 * Конфигурация запросов к удалённому провайдеру по профилю из `profile.ts`.
 *
 * `baseUrl` профиля здесь **перезаписывается** константой модуля: адрес
 * назначения выбирает сервер, и даже если в профиле окажется чужой адрес,
 * запрос с ключом уйдёт туда, куда задумано приложением.
 */
export function aiConfigFromRemoteProfile(profile: ResolvedRemoteProfile): AiRemoteConfig {
  return {
    provider: 'openrouter',
    baseUrl: OPENROUTER_CHAT_COMPLETIONS_URL,
    model: profile.model,
    apiKey: profile.apiKey,
    timeoutMs: profile.timeoutMs,
  };
}

/** Как провайдер описывает ошибку в теле ответа */
interface ProviderError {
  message?: string;
  metadata?: { error_type?: string };
}

/**
 * Пометка клиента для ошибки, пришедшей внутри «успешного» ответа.
 *
 * Класс ошибки провайдер в этом случае обычно не называет, а HTTP-статус на
 * ошибку не указывает вовсе — статус 200. Без собственной пометки такая ошибка
 * была бы для цикла неотличима от сетевой, и повтор ушёл бы в шлюз второй раз,
 * то есть в счёт за вторую попытку.
 */
const ERROR_IN_SUCCESS_RESPONSE = 'error_in_success_response';

/**
 * Пометка клиента для пустого «успешного» ответа: `200`, в котором нет ни одного
 * choice либо `message.content === null`.
 *
 * Повтор такого ответа не исправляет ничего, поэтому у удалённого провайдера он
 * запрещён — вторая попытка стоила бы оператору денег за уже посчитанный запрос.
 * Локальной модели гейт не касается: там повтор бесплатен и штатно закрывает
 * разовый сбой, иначе её деградация изменилась бы вместе с этим правилом.
 */
const EMPTY_SUCCESS_RESPONSE = 'empty_success_response';

/**
 * Классы ошибок, которые повтором не лечатся: отвергнутый ключ, нет денег, нет
 * такой модели — и клиентские пометки об ошибке внутри «успешного» ответа.
 *
 * Всё остальное (`rate_limit_exceeded`, `bad_gateway`, `timeout`) повтор
 * исправляет, и молча превращать его в «терминальную» нельзя — оператор
 * потерял бы отчёт из-за минутной паузы.
 *
 * Объявлено после обеих пометок: `new Set([…])` вычисляется при загрузке
 * модуля, и ссылка на ещё не инициализированную `const` упала бы с
 * `ReferenceError` до первого запроса.
 */
const TERMINAL_ERROR_TYPES = new Set([
  'authentication_error',
  EMPTY_SUCCESS_RESPONSE,
  ERROR_IN_SUCCESS_RESPONSE,
  'invalid_api_key',
  'invalid_request_error',
  'model_not_found',
  'not_found_error',
  'payment_required',
  'permission_error',
  'unsupported_model',
]);

/**
 * Статусы, которые повтором не меняются. Это тот же смысл, что у `retryable`
 * (`< 500`), но с исключением: 429 шлюз может пережить, а 402 — никогда.
 */
const TERMINAL_STATUSES = new Set([400, 401, 402, 403, 404, 422]);

/**
 * Что провайдер сообщил об отказе — ровно те поля, которые уже есть у ошибки.
 * Структурный тип, а не `AiUnavailableError`: причину приходится называть и там,
 * где отказ пролетел через чужую границу (стадия structure отдаёт только
 * статус и текст), и подставлять туда ошибку значило бы выдумывать её.
 */
export interface RemoteRefusal {
  /** Что сказал провайдер; уже обезличено `redact` в момент создания ошибки */
  detail?: string;
  /** HTTP-статус, если ответ его сообщал; у ошибки внутри 200 статуса нет */
  status?: number;
  /** `error.metadata.error_type` либо клиентская пометка */
  errorType?: string;
}

/**
 * Названная причина отказа удалённого шлюза.
 *
 * Проверяется в порядке «отвечает ли это поле на вопрос оператора»: код
 * `error_type` шлюза точнее статуса, поэтому он смотрится первым. Три
 * нелечимые причины, ради которых вообще существует отказ, названы своими
 * словами — «OpenRouter отклонил запрос» не сказало бы оператору, что чинить.
 *
 * Формулировка одна на все три точки входа с AI-вызовом (`/api/jobs`,
 * `/api/test/analyze`, `/api/compare`). Расхождение строк означало бы, что
 * README не может сослаться ни на одну из них, не соврав.
 */
const REMOTE_REFUSAL_REASONS: Array<[readonly string[], string]> = [
  [['authentication_error', 'invalid_api_key'], 'Ключ OpenRouter отклонён провайдером'],
  [['payment_required'], 'На счёте OpenRouter нет средств'],
  [['model_not_found', 'not_found_error', 'unsupported_model'], 'Модель не найдена в каталоге OpenRouter'],
  [['permission_error'], 'Провайдер не разрешил запрос этому ключу'],
];

/** Причина по статусу: у отказа, пришедшего внутри 200, статуса нет вовсе */
const REMOTE_REFUSAL_BY_STATUS: Record<number, string> = {
  401: 'Ключ OpenRouter отклонён провайдером',
  402: 'На счёте OpenRouter нет средств',
  403: 'Провайдер не разрешил запрос этому ключу',
  404: 'Модель не найдена в каталоге OpenRouter',
};

/**
 * Деталь, которая не добавляет ничего к уже названному статусу.
 *
 * Клиент подставляет в деталь сам `HTTP <статус>`, когда тело ошибки разобрать не
 * удалось (шлюз ответил пустым или не-JSON телом), — и причина выходила двоитной:
 * «(HTTP 403): HTTP 403». Отбрасываем деталь по содержимому, а не сравнением со
 * строкой: снимаем сам номер статуса и слово `http`, и если в остатке не осталось
 * ни букв, ни цифр, пояснять было нечем. Объяснение провайдера вроде
 * `Invalid API key` остаётся — оператору оно и нужно.
 */
function detailRepeatsStatus(detail: string, status: number): boolean {
  const rest = detail
    .replace(new RegExp(`\\b${status}\\b`, 'g'), ' ')
    .replace(/\bhttp\b/gi, ' ');
  return !/[\p{L}\p{N}]/u.test(rest);
}

/**
 * Строка, которую показывают оператору. Ключа в ней нет и быть не может: текст
 * провайдера обезличен в момент создания ошибки, а всё остальное здесь —
 * литералы этого модуля.
 */
export function remoteProviderCause(refusal: RemoteRefusal): string {
  const reason =
    REMOTE_REFUSAL_REASONS.find(([types]) => refusal.errorType !== undefined && types.includes(refusal.errorType))?.[1] ??
    (refusal.status === undefined ? undefined : REMOTE_REFUSAL_BY_STATUS[refusal.status]) ??
    'OpenRouter отклонил запрос';
  const { status } = refusal;
  const statusPart = status === undefined ? '' : ` (HTTP ${status})`;
  const detailPart =
    refusal.detail && !(status !== undefined && detailRepeatsStatus(refusal.detail, status))
      ? `: ${refusal.detail}`
      : '';
  return `${reason}${statusPart}${detailPart}`;
}

export class AiUnavailableError extends Error {
  debug?: AiDebugInfo;

  constructor(
    message: string,
    readonly detail?: string,
    /** HTTP-статус ответа модели, если был; network-ошибки без статуса */
    readonly status?: number,
    /**
     * Класс ошибки: `error.metadata.error_type` от провайдера либо пометка
     * клиента `ERROR_IN_SUCCESS_RESPONSE`. То, что повтор не лечит, определяет
     * именно это значение — HTTP-статус у «успешного» ответа на ошибку не
     * указывает.
     */
    readonly errorType?: string,
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }

  /** Повтор имеет смысл только для «временных» проблем */
  get retryable(): boolean {
    if (this.status === undefined) return true; // сеть/таймаут
    return this.status >= 500;
  }

  /**
   * Повтор заведомо ничего не изменит: провайдер отверг запрос, отвечает
   * «успехом», вложив в него ошибку, либо сам назвал класс ошибки нелечимым.
   *
   * Отдельный признак, а не подмножество `retryable`: у ошибки, пришедшей
   * внутри 200-го ответа, нет ни статуса, ни названия класса от провайдера, и
   * `retryable` считает её сетевой — то есть разрешает второй запрос и вторую
   * оплату.
   */
  get terminal(): boolean {
    if (this.errorType !== undefined) return TERMINAL_ERROR_TYPES.has(this.errorType);
    if (this.status === undefined) return false; // сеть/таймаут — повтор обычно спасает
    return TERMINAL_STATUSES.has(this.status);
  }
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatChoice {
  message?: { content?: string | null };
  /** Ошибка внутри выбора: ответ «успешный», а выбор не отвечает */
  error?: ProviderError;
  finish_reason?: string | null;
}

interface ChatResponse {
  choices?: ChatChoice[];
  error?: ProviderError;
  /** Модель, которая ответила, — может отличаться от запрошенной */
  model?: string;
  /**
   * Расход токенов. У обоих провайдеров ответ OpenAI-совместимый, поэтому поле
   * приходит одинаково; `AiDebugInfo.totalTokens` забирает его на путь к
   * диагностике, то есть к ответу на «сколько токенов стоил этот вызов».
   */
  usage?: { total_tokens?: number };
}

interface CallResult {
  content: string;
  httpStatus: number;
  /** Что ответил шлюз вместо запрошенной модели */
  effectiveModel: string;
  /** `usage.total_tokens` из ответа; null — провайдер не сообщил */
  totalTokens: number | null;
}

/** Готовый HTTP-запрос: адрес, заголовки и тело, собранные под провайдера */
interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Ключ оператора не должен покидать память процесса: лог приложения уезжает
 * вместе с portable-папкой, а провайдер в тексте ошибки вполне может
 * процитировать присланный заголовок Authorization.
 *
 * Локальная ветка возвращает строку как есть — там секрета не существует, и
 * вывод остаётся побайтно прежним. Ключ короче четырёх символов не ищем: такой
 * «секрет» испортил бы текст, не имеющий отношения к ключу.
 *
 * Второй слой — регулярное выражение по форме ключа; провайдер может
 * процитировать его не дословно (с обрезкой или в другом регистре), и дословная
 * замена такое не поймает. Флаг `i` здесь обязателен: без него `SK-OR-V1-…`
 * прошёл бы оба слоя. Смысл слоёв тот же, что в `verify.ts`.
 */
function redact(value: string, config: AiConfig): string {
  if (config.provider !== 'openrouter') return value;
  const secret = config.apiKey.trim();
  const withoutExact = secret.length >= 4 ? value.split(secret).join('***') : value;
  return withoutExact.replace(/sk-[A-Za-z0-9_-]{6,}/gi, '***');
}

/**
 * Заголовки и тело запроса — единственное место, где провайдеры расходятся.
 *
 * Локальная ветка не меняется никогда: её заголовки, тело и порядок полей
 * зафиксированы, потому что от них зависит поведение reasoning-моделей Ollama.
 *
 * `reasoning_effort` отправляется только локальной модели. Это не «неизвестное
 * поле, которое шлюз проигнорирует»: у моделей с обязательным reasoning значение
 * `none` запрещено, и запрос с ним отклоняется целиком — при том, что
 * приложение не знает, какую удалённую модель выбрал оператор.
 *
 * Адрес удалённого запроса берётся из константы, а не из объекта конфига:
 * конфиг — структура данных, доступная и вызывающему коду, и тестам, и
 * назначение запроса задаёт только сервер.
 */
function buildRequest(config: AiConfig, messages: ChatMessage[]): BuiltRequest {
  if (config.provider === 'ollama') {
    return {
      url: config.baseUrl,
      headers: {
        // Ollama не проверяет ключ, но требует непустой Bearer
        Authorization: 'Bearer ollama',
        'Content-Type': 'application/json',
      },
      body: {
        model: config.model,
        messages,
        temperature: 0,
        max_tokens: 4000,
        // Reasoning-модели тратят на внутренний разум тысячи токенов до первого
        // символа ответа: на реальных промптах пайплайна запрос не успевает
        // уложиться в AI_TIMEOUT_SEC и обрывается пустым. Выключаем reasoning —
        // модели без этой настройки параметр игнорируют.
        reasoning_effort: 'none',
      },
    };
  }

  return {
    url: OPENROUTER_CHAT_COMPLETIONS_URL,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': OPENROUTER_REFERER,
      'X-OpenRouter-Title': OPENROUTER_TITLE,
    },
    body: {
      model: config.model,
      messages,
      temperature: 0,
      max_tokens: 4000,
    },
  };
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
  /** Модель, которая ответила на попытку (success) */
  effectiveModel?: string;
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
  const request = buildRequest(config, messages);

  try {
    const res = await fetch(request.url, {
      method: 'POST',
      signal: controller.signal,
      headers: request.headers,
      body: JSON.stringify(request.body),
    });

    const body = (await res.json().catch(() => null)) as ChatResponse | null;

    if (!res.ok) {
      const providerError = body?.error;
      throw new AiUnavailableError(
        res.status >= 400 && res.status < 500 && res.status !== 429
          ? `Модель ${config.model} отклонила запрос`
          : `Ошибка запроса к модели ${config.model}`,
        redact(providerError?.message ?? `HTTP ${res.status}`, config),
        res.status,
        providerError?.metadata?.error_type,
      );
    }

    // Статус 200 ничего не гарантирует: шлюз отдаёт «успех», вложив в тело
    // ошибку — без choices, внутри choices[0].error или с finish_reason=error.
    // Дальше такое тело выглядело бы как пустой ответ, а пустой ответ
    // повторяется: платный запрос уходит второй раз и оператор платит за
    // ошибку, которую повтор не исправит.
    //
    // Гейт касается только удалённого шлюза — по той же причине, что и
    // `EMPTY_SUCCESS_RESPONSE` ниже: локальной модели повтор бесплатен и штатно
    // закрывает разовый сбой, а без оговорки её путь потерял бы его молча.
    //
    // Статус здесь не передаётся: на 200 он ничего не объясняет, а отсутствие
    // статуса иначе означало бы «сетевая ошибка, можно повторить».
    const choice = body?.choices?.[0];
    const carried = body?.error ?? choice?.error;
    if (config.provider === 'openrouter' && (carried || choice?.finish_reason === 'error')) {
      throw new AiUnavailableError(
        `Провайдер ${PROVIDER_NAMES[config.provider]} вернул ошибку вместо ответа модели`,
        redact(
          carried?.message ?? `finish_reason=${choice?.finish_reason ?? 'неизвестен'}`,
          config,
        ),
        undefined,
        carried?.metadata?.error_type ?? ERROR_IN_SUCCESS_RESPONSE,
      );
    }

    return {
      content: choice?.message?.content ?? '',
      httpStatus: res.status,
      effectiveModel: body?.model ?? config.model,
      totalTokens: body?.usage?.total_tokens ?? null,
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
    provider: config.provider,
    // null, а не config.model: пока модель не ответила, показывать запрошенную
    // нельзя — весь смысл effectiveModel в том, что это не одно и то же.
    effectiveModel: null,
    httpStatus: null,
    contentLength: 0,
    totalTokens: null,
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
      `[AI]${label} попытка ${attemptNo}/${PRIMARY_MAX_ATTEMPTS}, model=${redact(config.model, config)}, таймаут=${timeoutMs} мс`,
    );
    emit({ phase: 'attempt' });

    try {
      const result = await callOnce(config, messages, timeoutMs);
      debug.httpStatus = result.httpStatus;
      debug.contentLength = result.content.length;
      debug.effectiveModel = result.effectiveModel;
      debug.totalTokens = result.totalTokens;
      debug.rawPreview = redact(result.content.slice(0, 500), config);

      if (!result.content) {
        // Статус 200 с пустым телом — запрос принят и посчитан, а содержания в
        // нём нет. Повтор не исправит это, поэтому удалённому провайдеру он
        // запрещён: пометка `errorType` переводит ошибку в разряд terminal, и
        // цикл обрывается на `if (lastError.terminal)`. Локальной модели
        // пометка не ставится — её повтор бесплатен и остаётся прежним.
        throw new AiUnavailableError(
          'Пустой ответ модели',
          undefined,
          undefined,
          config.provider === 'openrouter' ? EMPTY_SUCCESS_RESPONSE : undefined,
        );
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
        emit({ phase: 'success', elapsedMs, contentLength: result.content.length, effectiveModel: result.effectiveModel });
        return { data, debug };
      } catch {
        throw new AiUnavailableError(
          'Ответ модели не является валидным JSON',
          redact(result.content.slice(0, 300), config),
        );
      }
    } catch (err) {
      lastError =
        err instanceof AiUnavailableError
          ? err
          : new AiUnavailableError(
              'Сетевая ошибка при обращении к модели',
              redact(String(err), config),
            );
      debug.errorMessage = redact(lastError.detail ?? lastError.message, config);
      debug.httpStatus = lastError.status ?? debug.httpStatus;

      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[AI]${label} ошибка за ${(elapsedMs / 1000).toFixed(1)} с: ${redact(lastError.message, config)}` +
          `${lastError.detail ? ` (${redact(lastError.detail.slice(0, 200), config)})` : ''}`,
      );

      // Провайдер отверг запрос или отвечает «успехом» с ошибкой внутри:
      // второй запрос только спишет деньги. Проверяется раньше retryable,
      // потому что у ошибки из 200-го ответа статуса нет, а retryable считает
      // отсутствие статуса сетевой ошибкой.
      if (lastError.terminal) break;

      // Невременная ошибка (400/401/404...) — повтор не поможет.
      if (!lastError.retryable) break;

      // Событие «повтор» — только если повтор реально будет
      if (attempt + 1 < PRIMARY_MAX_ATTEMPTS) {
        emit({ phase: 'retry', elapsedMs, error: redact(lastError.message, config) });
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
