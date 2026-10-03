import type {
  AiDebugInfo,
  AiProvider,
  CompareResult,
  ConfirmPayload,
  JobStatus,
  ReconciliationReport,
  Transaction,
} from '@recon/shared';

export type { AiDebugInfo, CompareResult, JobStatus, ReconciliationReport, Transaction };

declare global {
  interface Window {
    /** Заполняется скриптом /config.js, который отдаёт backend */
    __RECON_CONFIG__?: { apiBaseUrl?: string };
  }
}

/**
 * Базовый URL API. Пусто (по умолчанию) — запросы идут на тот же origin,
 * откуда открыт интерфейс. Значение приходит из settings.txt → /config.js,
 * поэтому переключение режима доступа (127.0.0.1 / 0.0.0.0) не требует
 * пересборки фронтенда.
 */
const API_BASE = (window.__RECON_CONFIG__?.apiBaseUrl ?? '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

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
  const res = await fetch(apiUrl(url), init);
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

export interface TestAnalyzeResponse {
  fileName: string;
  sourceKind: string;
  sheetName: string | null;
  pages: number | null;
  result: DocumentData;
  /** Проблемы согласованности данных, найденные при валидации */
  warnings?: string[];
  debug: AiDebugInfo;
}

/**
 * Конфигурация AI по умолчанию на сервере (GET /api/health).
 *
 * Это **не** ответ на вопрос «какая модель применяется в моём браузере»: маршрут
 * общий для всех, кто зашёл на этот backend, а профиль лежит в `localStorage`
 * каждого браузера отдельно. Два браузера на одной машине держат разные модели,
 * и у сервера нет данных, чтобы их различить, — отсюда берётся только запасной
 * вариант: локальная модель из settings.txt и признак «backend недоступен».
 */
export interface AiRuntimeInfo {
  /** Провайдер из settings.txt; удалённый сюда не попадает — он в профиле запроса */
  provider: AiProvider;
  /** Модель из settings.txt (OLLAMA_MODEL) */
  model: string;
}

/**
 * Сохранённый в браузере выбор модели, который уходит с каждым AI-запросом.
 *
 * Структурно совместим с возвратом `useAiProfile()`: подсказка ключа и признак
 * его наличия здесь не нужны и просто игнорируются. Поэтому профиль передаётся
 * целиком, а правило «пара целиком или ничего» живёт в `applyProfile`.
 */
export interface AiRequestProfile {
  /** Пара рабочая: есть и идентификатор модели, и ключ */
  isRemote: boolean;
  model: string;
  apiKey: string;
}

/**
 * Половина профиля — это `400` с названной причиной, а не «работает локальная
 * модель». Поэтому поля добавляются только рабочей парой: с пустым профилем
 * запрос уходит побайтно так же, как до появления удалённых моделей.
 */
function applyProfile(form: FormData, profile: AiRequestProfile | undefined): void {
  if (profile?.isRemote !== true) return;
  form.append('aiModel', profile.model);
  form.append('aiApiKey', profile.apiKey);
}

/** То же для JSON-тела `/api/compare`: имена полей общие с multipart */
function profileFields(profile: AiRequestProfile | undefined): { aiModel?: string; aiApiKey?: string } {
  if (profile?.isRemote !== true) return {};
  return { aiModel: profile.model, aiApiKey: profile.apiKey };
}

/** Пара, которую оператор ввёл в окне настроек: проверка принимает её как есть */
export interface AiVerifyInput {
  model: string;
  apiKey: string;
}

/**
 * Машинное имя причины, по которой проверка не прошла. Текст для оператора лежит
 * в `AiVerifyResult.message` и показывается дословно — принадлежит он серверу.
 */
export type AiVerifyFailure =
  | 'key-rejected'
  | 'key-no-credit'
  | 'key-unreachable'
  | 'key-unexpected'
  | 'model-absent'
  | 'catalog-unavailable'
  | 'catalog-empty';

/**
 * Ответ `POST /api/ai/verify`.
 *
 * Три состояния, а не два: «не сработало» и «не смогли проверить» — разные вещи.
 * При `unchecked` ключ принят, а каталог не пришёл, поэтому сказать «модели нет»
 * на основании отсутствия данных нельзя. Обе проверки бесплатны: модель не
 * вызывается, кредит не тратится.
 */
export interface AiVerifyResult {
  status: 'ok' | 'unchecked' | 'failed';
  keyValid: boolean;
  /** Остаток кредита по данным провайдера; null, если он его не сообщил */
  remainingCredit: number | null;
  modelVerdict: 'present' | 'absent' | 'inconclusive';
  /** null ровно тогда, когда проверка ничего не сломала */
  reason: AiVerifyFailure | null;
  /** Текст для строки результата в окне настроек */
  message: string;
}

/**
 * Четырёхзначный вердикт о локальной модели: «не ответила» и «не слушает» —
 * разные поломки с разными подсказками, сводить их к «недоступна» нельзя.
 */
export type OllamaVerdict = 'ready' | 'model-missing' | 'not-listening' | 'unresponsive';

/** Ответ `GET /api/ollama/status` */
export interface OllamaStatus {
  verdict: OllamaVerdict;
  /** Модель из settings.txt, о которой шла проверка */
  model: string;
  /** Что делать: текст сервера, показывается дословно */
  remedy: string;
}

export const api = {
  health(): Promise<{ ok: boolean; ai: AiRuntimeInfo }> {
    return request('/api/health');
  },

  /**
   * Разбор одного файла в режиме «Быстро». Профиль уходит тем же `applyProfile`,
   * что и в полном пайплайне: иначе быстрый режим остался бы локальным при
   * сохранённом удалённом профиле, и это выглядело бы как «модель проигнорирована».
   */
  testAnalyze(file: File, profile?: AiRequestProfile): Promise<TestAnalyzeResponse> {
    const form = new FormData();
    form.append('file', file);
    applyProfile(form, profile);
    return request('/api/test/analyze', { method: 'POST', body: form });
  },

  /** Поля профиля разворачиваются в тело объектом — имена те же, что в multipart */
  compare(
    ours: DocumentData,
    partner: DocumentData,
    profile?: AiRequestProfile,
  ): Promise<CompareResult & { debug?: AiDebugInfo }> {
    return request('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ours, partner, ...profileFields(profile) }),
    });
  },

  /* --------------------- Полный пайплайн сверки ------------------------ */

  /** Загружает пару файлов и запускает пайплайн. Возвращает первый статус. */
  createJob(
    ours: File,
    partner: File,
    twoSided = false,
    profile?: AiRequestProfile,
  ): Promise<JobStatus> {
    const form = new FormData();
    form.append('ours', ours);
    form.append('partner', partner);
    if (twoSided) form.append('twoSided', 'true');
    applyProfile(form, profile);
    return request('/api/jobs', { method: 'POST', body: form });
  },

  jobStatus(id: string): Promise<JobStatus> {
    return request(`/api/jobs/${id}`);
  },

  confirmJobMapping(id: string, payload: ConfirmPayload): Promise<JobStatus> {
    return request(`/api/jobs/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  cancelJob(id: string): Promise<JobStatus> {
    return request(`/api/jobs/${id}/cancel`, { method: 'POST' });
  },

  jobReport(id: string): Promise<ReconciliationReport> {
    return request(`/api/jobs/${id}/report`);
  },

  /** Ссылка на HTML-отчёт — открывается в новой вкладке, отчёт отдаётся сервером. */
  jobReportUrl(id: string): string {
    return apiUrl(`/api/jobs/${id}/report.html`);
  },

  /* --------------------- Проверки подключения (todo 7) --------------------- */

  /**
   * Бесплатная проверка ключа и идентификатора модели.
   *
   * Тело — JSON, а не multipart: файла тут нет, и разбор частей в хендлере был бы
   * ветвлением в маршруте. Зовётся **только** по нажатию оператора: запрос уходит
   * к удалённому шлюзу, и вызов без инициатора означал бы, что интерфейс
   * стучится наружу сам.
   */
  verifyProfile(input: AiVerifyInput): Promise<AiVerifyResult> {
    return request('/api/ai/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: input.model, apiKey: input.apiKey }),
    });
  },

  /**
   * Вердикт о локальной модели «прямо сейчас».
   *
   * Ключ сюда не уходит: маршрут не делает AI-вызова, и отправлять секрет туда,
   * где можно обойтись без него, значило бы завести лишний путь утечки.
   */
  ollamaStatus(): Promise<OllamaStatus> {
    return request('/api/ollama/status');
  },
};
