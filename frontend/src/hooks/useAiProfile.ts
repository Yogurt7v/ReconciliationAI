import { useCallback, useMemo, useState } from 'react';

/**
 * Сохранённый в этом браузере выбор удалённой модели: идентификатор и ключ
 * OpenRouter. Решение D1 — ключ живёт только в `localStorage`: не в
 * `settings.txt`, не в окружении, не в отчёте.
 *
 * **Два ключа хранилища, а не один объект `{ model, apiKey }`.** В одном
 * JSON-блоке секрет неотделим от модели: очистка модели переписывает блок вместе
 * с ключом, любая правка модели трогает секрет, а испорченный блок уносит оба
 * значения разом. Здесь ключ достаётся отдельным обращением, и значение, из
 * которого рисуется надпись модели, само по себе секрета не содержит — вторая
 * половина пары читается для признака «сохранён ли ключ», и это всё, что нужно
 * шапке.
 *
 * Имена `recon-ai-model` и `recon-ai-apikey` — продолжение словаря репозитория,
 * а не формат: значения считаются непроверенными строками, и всё, что читается,
 * проверяется заново. `baseUrl` здесь не хранится и не читается — адрес
 * назначения задаёт сервер (`services/ai/openrouter.ts`), клиентский адрес был бы
 * полем, которое выглядит рабочим и молча выбрасывается.
 */

/** Ключ хранилища для идентификатора модели — не секрет, его можно читать свободно */
const MODEL_STORAGE_KEY = 'recon-ai-model';
/** Ключ хранилища для API-ключа OpenRouter — секрет, единственное его место */
const API_KEY_STORAGE_KEY = 'recon-ai-apikey';

/** Сколько символов с конца ключа показываем оператору */
const HINT_LENGTH = 4;

/** То, что оператор ввёл в диалоге настроек */
export interface AiProfileInput {
  /** Идентификатор модели из каталога OpenRouter, например `vendor/model:free` */
  model: string;
  /** API-ключ OpenRouter целиком — хук не проверяет его, это делает сервер */
  apiKey: string;
}

/** Прочитанный профиль: данные без действий */
export interface StoredAiProfile {
  /** Идентификатор модели; пустая строка — годного идентификатора нет */
  model: string;
  /** Ключ целиком. Только чтобы отправить в запрос — показывать нельзя */
  apiKey: string;
  /** Последние четыре символа ключа; пустая строка, если показывать нечего */
  keyHint: string;
  /** В этом браузере сохранён ключ — индикатор для IS-11 */
  hasKey: boolean;
  /** Профиль рабочий: есть и идентификатор, и ключ */
  isRemote: boolean;
}

/** Действия над хранилищем */
export interface AiProfileActions {
  /** Записать пару «модель + ключ». Пустое значение поля удаляет его из хранилища */
  save(next: AiProfileInput): void;
  /** Полная очистка профиля одним действием */
  clear(): void;
}

/** То, что отдаёт `useAiProfile` */
export interface AiProfile extends StoredAiProfile, AiProfileActions {}

/**
 * Обрезка пробелов с проверкой типа: из хранилища приходит `string | null`, а из
 * формы диалога значение может оказаться не строкой, и падение здесь уронило бы
 * обработчик нажатия.
 */
function trimmed(value: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Пробел, таб и управляющие символы в идентификаторе модели.
 *
 * Перебором по символам, а не регуляркой с диапазоном `\x00-\x1f`: такие байты
 * в исходнике невидимы и портятся при переносе файла между системами. Правило
 * то же, что у сервера в `services/ai/profile.ts` — на сервере оно отвечает за
 * отказ с названной причиной, здесь только за то, чтобы не отправить заведомо
 * негодное значение.
 */
function isPlausibleModelId(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) return false;
    if (/\s/.test(char)) return false;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Идентификатор приводится к тому виду, в котором его можно отправить, либо
 * считается отсутствующим. Практическое правило хука: он не пишет в хранилище
 * то, что потом не прочитает обратно, поэтому состояние и хранилище не могут
 * разойтись.
 */
function normalizeModel(value: string | null): string {
  const text = trimmed(value);
  return isPlausibleModelId(text) ? text : '';
}

/**
 * Чтение одного значения хранилища.
 *
 * Обращение к самому `window.localStorage` тоже бросает `SecurityError`, когда
 * браузер запретил хранилище, а `getItem` — когда исчерпана квота. Поэтому и
 * обращение, и вызов внутри `try`: чтение происходит во время рендера, и
 * исключение здесь означало бы, что интерфейс не открылся вообще.
 */
function readStored(key: string): string | null {
  try {
    const value = trimmed(window.localStorage.getItem(key));
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

/**
 * Запись одного значения хранилища. Пустая строка означает удаление, а не
 * пустое значение: ключ, которого нет, и ключ, который пуст, для профиля — одно
 * и то же состояние, а различать их незачем.
 *
 * При отказе хранилища состояние намеренно не меняется: записанного не
 * существует, а показывать оператору «сохранено» было бы враньём — следующий
 * запрос ушёл бы со старым профилем.
 */
function writeStored(key: string, value: string): void {
  try {
    if (value === '') window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // квота исчерпана или хранилище запрещено — профиль остаётся прежним
  }
}

/**
 * Подсказка — это последние четыре символа, а не первые. Префикс у ключа
 * OpenRouter фиксированный и опубликованный (`sk-or-v1-`), поэтому подсказка из
 * начала не отличила бы один вставленный ключ от другого и выдала бы вендора.
 * Совпадение подсказки с самим коротким ключом тоже не выводится: «подсказка»,
 * равная секрету, секретом и остаётся.
 */
function hintOf(apiKey: string): string {
  return apiKey.length > HINT_LENGTH ? apiKey.slice(-HINT_LENGTH) : '';
}

/**
 * Профиль целиком собирается в одной функции, поэтому его правило одно и
 * одинаково для всех путей: чтение при открытии, `save` и `clear`.
 *
 * `isRemote` требует и модели, и ключа — то же правило, что на сервере в
 * `resolveRequestAiConfig`: половина профиля не включается молча, а браузер
 * вообще не отправляет такой запрос (запрос без полей уходит на локальную
 * модель, запрос с половиной полей сервер отвергает). Причина отказа целиком
 * принадлежит серверу, поэтому её текст здесь не дублируется.
 */
function buildProfile(model: string, apiKey: string): StoredAiProfile {
  return {
    model,
    apiKey,
    keyHint: hintOf(apiKey),
    hasKey: apiKey !== '',
    isRemote: apiKey !== '' && model !== '',
  };
}

/** Профиль из хранилища при первом рендере */
function readStoredProfile(): StoredAiProfile {
  return buildProfile(
    normalizeModel(readStored(MODEL_STORAGE_KEY)),
    trimmed(readStored(API_KEY_STORAGE_KEY)),
  );
}

/**
 * Профиль удалённой модели, сохранённый в этом браузере.
 *
 * Чтение синхронное и происходит в инициализаторе состояния, а не в
 * `useEffect`: эффект после первого кадра показал бы «локальная модель» и
 * переключил на удалённую через мигание — это ровно тот снимок на момент
 * монтирования, из-за которого значок в шапке нельзя было обновить без
 * перезагрузки. Асинхронного продолжения здесь нет, поэтому и «живой» флаг в
 * `useEffect`, как в `useAiRuntime`, не нужен: ждать нечего, а ждать было бы
 * нечего.
 *
 * Побочное свойство такого чтения: `localStorage` не пишется во время рендера,
 * то есть побочный эффект остаётся только в `save` и `clear`.
 */
export function useAiProfile(): AiProfile {
  const [profile, setProfile] = useState<StoredAiProfile>(readStoredProfile);

  const save = useCallback((next: AiProfileInput): void => {
    const model = normalizeModel(next.model);
    const apiKey = trimmed(next.apiKey);
    writeStored(MODEL_STORAGE_KEY, model);
    writeStored(API_KEY_STORAGE_KEY, apiKey);
    setProfile(buildProfile(model, apiKey));
  }, []);

  const clear = useCallback((): void => {
    // Два отдельных вызова, а не один обход: каждый `removeItem` защищён своим
    // `try`, и падение на первом ключе не оставит второй на месте. «Модель
    // удалена, ключ остался» — ровно тот дефект, из-за которого очистка нужна
    // в один клик (IS-11).
    writeStored(MODEL_STORAGE_KEY, '');
    writeStored(API_KEY_STORAGE_KEY, '');
    setProfile(buildProfile('', ''));
  }, []);

  // Возвращаемое значение стабильно между рендерами: вкладки 10 и 11 кладут его
  // в зависимости эффектов, и новый объект на каждом рендере гонял бы их по кругу.
  return useMemo(() => ({ ...profile, save, clear }), [profile, save, clear]);
}
