/**
 * Проверки подключения, которые вызывает окно настроек модели.
 *
 * Окно вызывает их перед сохранением, чтобы оператор узнал об опечатке в
 * модели или отвергнутом ключе за секунды, а не посреди многошагового пайплайна:
 *   POST /api/ai/verify      — ключ OpenRouter и наличие модели в каталоге;
 *   GET  /api/ollama/status  — доступность локальной модели прямо сейчас.
 *
 * Обе проверки удалённого профиля бесплатны по построению: они ходят в
 * `GET /api/v1/key` и `GET /api/v1/models` и **не вызывают модель**. Проверка
 * ключа через однотоковый чат стоила бы кредита оператора — то есть ровно
 * того, чего она должна проверять. По той же причине здесь нет ни повторов, ни
 * цикла попыток: две попытки означали бы две сетевые ошибки вместо одного
 * внятного сообщения.
 *
 * Модуль чистый: без Fastify, без чтения настроек, без чтения файлов, без печати.
 * `index.ts` вызывает `await app.listen()` на уровне модуля и не отдаёт фабрику
 * приложения, поэтому HTTP-тест для маршрута невозможен; проверяемость даёт
 * только такое разбиение. `fetch` внедряется аргументом — как в `checkOllama`.
 *
 * Главное правило модуля: ключ оператора проходит через него, не оставляя следов.
 *  - наружу уходит только то, что оператор и так видит: вердикт, остаток кредита
 *    и текст на русском; сам ключ не входит ни в один из этих полей;
 *  - в тексты, которые мог прислать провайдер, ключ попасть не может: они
 *    проходят через `redact` до сборки сообщения. Провайдер вполне способен
 *    процитировать присланный заголовок Authorization в своём описании ошибки,
 *    и без обезличивания такой текст уехал бы оператору прямо в диалог;
 *  - модуль ничего не логирует и не прикрепляет ключ к объекту ошибки: pino
 *    сериализует собственные перечисляемые свойства `Error`, поэтому ключ в поле
 *    ошибки попал бы в лог одной только сериализацией (в `routes/jobs.ts` так
 *    печатается `req.log.error({ err, jobId })`);
 *  - из ответа `/key` наружу уходит только остаток кредита. Объект
 *    `free_model_daily_requests` не читается вовсе: у него нет действия,
 *    которое оператор мог бы предпринять.
 *
 * Проверка никому ничего не запрещает. Ни одна из двух проверок не является
 * условием запуска задания — решение об этом принимается в пайплайне.
 */

import { checkOllama, describeOllama } from '../../preflight.js';
import { classifyOllamaCheck } from './ollamaStatus.js';
import type { OllamaVerdict } from './ollamaStatus.js';
import { OPENROUTER_CHAT_COMPLETIONS_URL, classifyModelId, normalizeModelIdForCatalogLookup } from './openrouter.js';
import type { ModelIdVerdict } from './openrouter.js';
import type { ResolvedRemoteProfile } from './profile.js';

/**
 * Настройки, которых достаточно проверке локальной модели.
 *
 * Собственный интерфейс, а не `Pick<Settings, …>`: тип `Settings` в этом
 * каталоге не импортируется ничем, кроме `client.ts`, и объявлять его здесь
 * ради трёх полей значило бы протащить в модуль проверки объявление всего файла
 * настроек — вместе с ключами, которых проверке знать не нужно. Структурная
 * совместимость с `checkOllama` от этого не страдает.
 */
export interface LocalModelQuery {
  ollamaBaseUrl: string;
  ollamaModel: string;
  aiTimeoutSec: number;
}

/**
 * Адреса двух проверок выведены из адреса чата: `new URL('key', …/api/v1/chat/
 * completions)` даёт `…/api/v1/key`, потому что базовый путь у адреса чата —
 * `/api/v1/`. Так адрес назначения остаётся в одном месте, и правка
 * `openrouter.ts` увезла бы обе проверки с собой.
 */
const KEY_INFO_URL = new URL('key', OPENROUTER_CHAT_COMPLETIONS_URL).toString();
const CATALOG_URL = new URL('models', OPENROUTER_CHAT_COMPLETIONS_URL).toString();

/**
 * Таймаут одной бесплатной проверки.
 *
 * Своё значение, а не `AI_TIMEOUT_SEC` из настроек: там это десятки секунд на
 * ответ модели, а здесь два GET, которые укладываются в секунды. Ждать полминуты
 * ради того, чтобы сказать «OpenRouter не ответил», оператор не станет.
 */
const VERIFY_TIMEOUT_MS = 10_000;

/**
 * Машинное имя причины, которую диалог показывает оператору дословно.
 * `key-rejected` — ключ не принят провайдером, `key-no-credit` — денег нет,
 * `key-unreachable` — провайдер не ответил вовсе, `key-unexpected` — ответил, но
 * так, что его нельзя истолковать, `model-absent` — идентификатора нет в
 * каталоге, `catalog-unavailable` — каталог не пришёл, `catalog-empty` —
 * каталог пришёл, но пуст.
 */
export type VerifyFailure =
  | 'key-rejected'
  | 'key-no-credit'
  | 'key-unreachable'
  | 'key-unexpected'
  | 'model-absent'
  | 'catalog-unavailable'
  | 'catalog-empty';

/**
 * Итог проверки профиля.
 *
 * `status` различает три состояния, а не два: «не сработало» и «не смогли
 * проверить» — разные вещи, и сводить их к одному флагу нельзя. При
 * `unchecked` ключ провайдером принят, но каталог не пришёл, и сказать «модели
 * нет» на основании отсутствия данных нельзя.
 *
 * У `status: 'ok'` поле `reason` всегда `null`, а у `'unchecked'` причина всегда
 * одна: каталог не пришёл. Причина есть ровно тогда, когда проверка что-то сломала.
 */
export type RemoteVerification =
  | {
      status: 'ok';
      keyValid: true;
      /** Остаток кредита по данным /key; null, если провайдер его не сообщил */
      remainingCredit: number | null;
      modelVerdict: 'present';
      reason: null;
      /** Текст для строки результата в диалоге */
      message: string;
    }
  | {
      status: 'unchecked';
      keyValid: true;
      remainingCredit: number | null;
      modelVerdict: 'inconclusive';
      reason: 'catalog-unavailable' | 'catalog-empty';
      message: string;
    }
  | {
      status: 'failed';
      keyValid: boolean;
      remainingCredit: number | null;
      modelVerdict: ModelIdVerdict;
      reason: VerifyFailure;
      message: string;
    };

/** Что удалось узнать о ключе у провайдера */
type KeyVerdict =
  | { ok: true; remainingCredit: number | null }
  | { ok: false; failure: VerifyFailure; message: string };

/** Что удалось получить из каталога */
type CatalogResult = { ok: true; ids: string[] } | { ok: false; message: string };

/** Ответ сети: HTTP-статус и разобранное тело либо «до ответа не дошли» */
type RawResponse =
  | { kind: 'http'; status: number; body: unknown }
  | { kind: 'unreachable'; detail: string };

/**
 * Убирает ключ из любой строки, которая может попасть в сообщение оператору.
 *
 * Повторяет приём из `client.ts` и намеренно не импортирует оттуда: модуль
 * проверки не должен видеть клиента модели даже на уровне импорта, иначе
 * «проверка, которая не тратит кредит» однажды получила бы возможность вызвать
 * модель. Второй слой — регулярное выражение по форме ключа: провайдер может
 * процитировать его не дословно (с обрезкой или в другом регистре), и дословная
 * замена такое не поймает.
 */
function redact(value: string, apiKey: string): string {
  const secret = apiKey.trim();
  const withoutExact = secret.length >= 4 ? value.split(secret).join('***') : value;
  return withoutExact.replace(/sk-[A-Za-z0-9_-]{6,}/gi, '***');
}

/** Принимает только число — иначе в ответе провайдера поле просто другое */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Остаток кредита из ответа /key.
 *
 * Провайдер отдаёт его двумя способами: полем `limit_remaining` либо парой
 * «лимит минус израсходовано». Когда лимита нет вовсе (бесплатный тариф, ключ
 * без потолка), правильного ответа не существует — возвращается `null`, и
 * диалог не показывает выдуманную цифру.
 */
function remainingCreditFrom(data: Record<string, unknown>): number | null {
  const direct = readNumber(data.limit_remaining);
  if (direct !== null) return Math.max(0, direct);

  const limit = readNumber(data.limit);
  const usage = readNumber(data.usage);
  if (limit !== null && usage !== null) return Math.max(0, limit - usage);

  return null;
}

/**
 * Модель, за которую провайдер не берёт кредит.
 *
 * Признак — суффикс `:free` в самом идентификаторе, то есть соглашение
 * каталога. Суффикс маршрутизации перед сравнением снимается: у `a/b:nitro`
 * варианта «бесплатным» нет, а у `a/b:free` — есть, и решение о кредите не
 * должно зависеть от того, как оператор назвал маршрут.
 */
function isFreeModel(model: string): boolean {
  return normalizeModelIdForCatalogLookup(model).toLowerCase().endsWith(':free');
}

/** Кредит в виде строки: две цифры после запятой, без «длинного хвоста» float */
function formatCredit(value: number): string {
  return value.toFixed(2);
}

/**
 * Фраза про кредит для сообщения оператору.
 *
 * «Кредит неизвестен» и «кредита нет» — разные случаи: в первом показать
 * нечего, и выдумывать ноль нельзя. Второй сюда попадает только после того, как
 * нулевой остаток при бесплатной модели уже признан допустимым, иначе фраза
 * врала бы про платную модель.
 */
function creditNote(remaining: number | null): string {
  if (remaining === null) return '';
  if (remaining === 0) return ' На ключе нет кредита, но бесплатная модель его не требует.';
  return ` Остаток кредита: ${formatCredit(remaining)}.`;
}

/**
 * Один GET без повторов.
 *
 * Тело читается строкой и разбирается в вызывающем: невалидный JSON — это тоже
 * ответ, о котором надо сказать, а не повод бросить исключение наружу.
 */
async function request(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    return { kind: 'http', status: res.status, body };
  } catch (err) {
    // Текст сетевой ошибки может процитировать заголовок Authorization — в
    // сообщение оператору он пойдёт только после redact.
    return { kind: 'unreachable', detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Описание ошибки, которое провайдер вернул в теле ответа */
function providerMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const message = (body as { error?: { message?: unknown } }).error?.message;
  return typeof message === 'string' ? message : null;
}

/**
 * `GET /api/v1/key`: принимает ли провайдер ключ и сколько на нём осталось.
 *
 * Это единственное место, где ключ покидает процесс — в заголовке
 * Authorization. Второй запрос, к каталогу, уходит без ключа: там он не нужен,
 * а лишняя отправка секрета туда, где можно обойтись без него, только создала бы
 * новый путь утечки.
 */
async function checkApiKey(profile: ResolvedRemoteProfile, fetchImpl: typeof fetch): Promise<KeyVerdict> {
  const res = await request(
    KEY_INFO_URL,
    { Authorization: `Bearer ${profile.apiKey}`, Accept: 'application/json' },
    fetchImpl,
  );

  const safe = (value: string): string => redact(value, profile.apiKey);

  if (res.kind === 'unreachable') {
    return {
      ok: false,
      failure: 'key-unreachable',
      message:
        `OpenRouter не ответил на проверку ключа (${safe(res.detail)}). ` +
        'Это значит «проверить не удалось», а не «ключ отвергнут»: ' +
        'проверьте подключение к интернету и повторите.',
    };
  }

  if (res.status === 401 || res.status === 403) {
    const quoted = providerMessage(res.body);
    return {
      ok: false,
      failure: 'key-rejected',
      message:
        `Ключ OpenRouter отклонён (HTTP ${res.status})` +
        (quoted ? `: ${safe(quoted)}` : '.') +
        ' Проверьте ключ — он мог быть скопирован с ошибкой или уже отозван.',
    };
  }

  if (res.status === 402) {
    return {
      ok: false,
      failure: 'key-no-credit',
      message:
        'OpenRouter ответил «требуется оплата» (HTTP 402). ' +
        'Пополните баланс ключа или выберите бесплатную модель с суффиксом «:free».',
    };
  }

  if (res.status < 200 || res.status >= 300) {
    const quoted = providerMessage(res.body);
    return {
      ok: false,
      failure: 'key-unreachable',
      message:
        `OpenRouter ответил на проверку ключа неожиданным кодом HTTP ${res.status}` +
        (quoted ? `: ${safe(quoted)}` : '.') +
        ' Проверка не прошла, но это не значит, что ключ отвергнут.',
    };
  }

  const data = (res.body as { data?: unknown } | null)?.data;
  if (typeof data !== 'object' || data === null) {
    return {
      ok: false,
      failure: 'key-unexpected',
      message:
        'OpenRouter ответил без данных о ключе — остаток кредита узнать не удалось, ' +
        'и проверку следует считать невыполненной.',
    };
  }

  // free_model_daily_requests здесь намеренно не читается: у этого объекта нет
  // действия, которое оператор мог бы предпринять, а наружу он бы уехал просто
  // потому, что пришёл в том же теле ответа.
  return { ok: true, remainingCredit: remainingCreditFrom(data as Record<string, unknown>) };
}

/**
 * `GET /api/v1/models`: идентификаторы каталога для сверки с моделью оператора.
 *
 * Тексты строятся как продолжение общей фразы вызывающего кода («Ключ принят.
 * …»), поэтому начинаются с заглавной буквы и заканчиваются точкой.
 */
async function fetchCatalog(profile: ResolvedRemoteProfile, fetchImpl: typeof fetch): Promise<CatalogResult> {
  // Ключ сюда не отправляется: каталог открыт, а секрет незачем отдавать туда,
  // где он не запрашивался.
  const res = await request(CATALOG_URL, { Accept: 'application/json' }, fetchImpl);

  if (res.kind === 'unreachable') {
    return {
      ok: false,
      message:
        `Каталог OpenRouter недоступен (${redact(res.detail, profile.apiKey)}). ` +
        'Наличие модели не проверено — это не значит, что модели нет.',
    };
  }

  if (res.status < 200 || res.status >= 300) {
    return {
      ok: false,
      message: `Каталог OpenRouter ответил кодом HTTP ${res.status}. Наличие модели не проверено.`,
    };
  }

  const entries = (res.body as { data?: unknown } | null)?.data;
  if (!Array.isArray(entries)) {
    return { ok: false, message: 'Каталог OpenRouter пришёл в неожиданном виде. Наличие модели не проверено.' };
  }

  const ids: string[] = [];
  for (const entry of entries) {
    const id = (entry as { id?: unknown }).id;
    if (typeof id === 'string' && id !== '') ids.push(id);
  }
  return { ok: true, ids };
}

/**
 * Проверяет ключ и идентификатор модели удалённого профиля.
 *
 * Обе проверки идут одновременно и выполняются всегда, даже если первая уже
 * провалилась: каталог открыт, стоит бесплатно и говорит оператору о второй
 * ошибке за то же время. Задача, где оба запроса прервались, получила бы одну
 * бесполезную попытку узнать о двух проблемах.
 *
 * Никогда не бросает: вызывающий код — маршрут, и исключение здесь стало бы
 * пятисоткой вместо внятного ответа.
 */
export async function verifyRemoteProfile(
  profile: ResolvedRemoteProfile,
  fetchImpl: typeof fetch = fetch,
): Promise<RemoteVerification> {
  try {
    const [key, catalog] = await Promise.all([checkApiKey(profile, fetchImpl), fetchCatalog(profile, fetchImpl)]);

    // Причина сбоя выбирается по тому, что мешает сильнее: сломанный ключ
    // обесценивает проверку модели, поэтому он идёт первым.
    if (!key.ok) {
      return {
        status: 'failed',
        keyValid: false,
        remainingCredit: null,
        modelVerdict: catalog.ok ? classifyModelId(profile.model, catalog.ids) : 'inconclusive',
        reason: key.failure,
        message: key.message,
      };
    }

    // Каталог не пришёл: сказать «модели нет» на основании отсутствия данных
    // нельзя — это не то же самое, что её отсутствие.
    if (!catalog.ok) {
      return {
        status: 'unchecked',
        keyValid: true,
        remainingCredit: key.remainingCredit,
        modelVerdict: 'inconclusive',
        reason: 'catalog-unavailable',
        message: `Ключ принят. ${catalog.message}`,
      };
    }

    const modelVerdict = classifyModelId(profile.model, catalog.ids);

    if (modelVerdict === 'inconclusive') {
      return {
        status: 'unchecked',
        keyValid: true,
        remainingCredit: key.remainingCredit,
        modelVerdict,
        reason: 'catalog-empty',
        message: 'Ключ принят. Каталог OpenRouter пришёл без единой модели — наличие выбранной не проверено.',
      };
    }

    if (modelVerdict === 'absent') {
      const lookedUp = normalizeModelIdForCatalogLookup(profile.model);
      const stripped = lookedUp !== profile.model;
      return {
        status: 'failed',
        keyValid: true,
        remainingCredit: key.remainingCredit,
        modelVerdict,
        reason: 'model-absent',
        message:
          `Модель «${profile.model}» не найдена в каталоге OpenRouter` +
          (stripped ? ` (проверялось «${lookedUp}»: суффикс маршрутизации снимается перед поиском)` : '') +
          '. Сверьте идентификатор с каталогом: «:free» и «:batch» — часть имени модели.',
      };
    }

    // Нулевой кредит — решение, а не приговор: бесплатная модель его не требует.
    if (key.remainingCredit === 0 && !isFreeModel(profile.model)) {
      return {
        status: 'failed',
        keyValid: true,
        remainingCredit: 0,
        modelVerdict,
        reason: 'key-no-credit',
        message:
          'На ключе не осталось кредита, а модель «' +
          profile.model +
          '» не бесплатная. Пополните баланс OpenRouter или выберите модель с суффиксом «:free».',
      };
    }

    return {
      status: 'ok',
      keyValid: true,
      remainingCredit: key.remainingCredit,
      modelVerdict,
      reason: null,
      message: `Ключ принят, модель «${profile.model}» найдена в каталоге OpenRouter.${creditNote(key.remainingCredit)}`,
    };
  } catch (err) {
    // Страховка для вызывающего кода: наружу уходит только результат.
    // Ключа в тексте быть не может — он сюда не попадает, но redact стоит
    // рядом с любым текстом, который пришёл извне.
    return {
      status: 'failed',
      keyValid: false,
      remainingCredit: null,
      modelVerdict: 'inconclusive',
      reason: 'key-unexpected',
      message:
        `Проверка подключения не завершилась (${redact(err instanceof Error ? err.message : String(err), profile.apiKey)}). ` +
        'Повторите проверку.',
    };
  }
}

/** Доступность локальной модели: вердикт, о какой модели он и чем чинить */
export interface LocalAvailability {
  verdict: OllamaVerdict;
  /** Модель из settings.txt, о которой шла проверка */
  model: string;
  /** Текст из describeOllama: оператор видит его дословно */
  remedy: string;
}

/**
 * Проверяет локальную модель Ollama прямо сейчас.
 *
 * Своя проверка на каждый запрос диалога вместо результата, посчитанного при
 * старте: приложение живёт долго, а локальный сервис может быть остановлен или
 * запущен уже после старта.
 *
 * `checkOllama` не бросает — причина недоступности приходит полем `causeCode` и
 * разбирается в `classifyOllamaCheck`. Внешний `try` нужен затем, чтобы маршрут
 * не содержал ни одного ветвления: маршрут должен оставаться тонким, а
 * предполагаться, что проверка не бросит, — нельзя.
 */
export async function checkLocalAvailability(
  settings: LocalModelQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalAvailability> {
  try {
    const check = await checkOllama(settings, fetchImpl);
    return {
      verdict: classifyOllamaCheck(check),
      model: settings.ollamaModel,
      remedy: describeOllama(check, settings),
    };
  } catch {
    return {
      verdict: 'unresponsive',
      model: settings.ollamaModel,
      remedy:
        `Не удалось проверить Ollama по адресу ${settings.ollamaBaseUrl}. ` +
        'Проверка ничего не блокирует: без модели приложение продолжит работать по правилам.',
    };
  }
}