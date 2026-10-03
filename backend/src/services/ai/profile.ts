/**
 * Разбор профиля удалённой модели, присланного браузером.
 *
 * Оператор вводит идентификатор модели и API-ключ OpenRouter в окне настроек;
 * браузер хранит их у себя и присылает с каждым запросом. Здесь это значение
 * превращается в конфигурацию, понятную остальному backend'у, — либо в
 * конкретную причину отказа, которую диалог показывает дословно.
 *
 * Модуль намеренно чистый: без сети, без чтения settings.txt, без побочных
 * эффектов. `index.ts` вызывает `await app.listen()` на уровне модуля и не
 * отдаёт фабрику приложения, поэтому проверить код маршрута через HTTP нельзя;
 * проверяемость даёт только выделение правил в такой модуль.
 *
 * Всё, что сюда приходит, — радиоактивно: это живой ключ оператора. Модуль
 * ничего не печатает и не логирует, включая текст ошибки, — потому что лог
 * приложения уезжает вместе с папкой, а ключ не должен покидать память процесса
 * ни в одном виде. Наружу ключ возвращается только в составе успешного
 * результата, и вызывающий код нигде его не сериализует.
 *
 * Поле `baseUrl`, даже если оно прислано, не читается и не проверяется: адрес
 * назначения задаёт сервер, а не браузер. Иначе любой, кто сумеет отправить
 * запрос к локальному backend'у, отправил бы ключ оператора на любой хост по
 * своему выбору — это открытый прокси, а не настройка модели.
 */

import type { AiProvider } from '@recon/shared';

import { OPENROUTER_CHAT_COMPLETIONS_URL, OPENROUTER_PROVIDER } from './openrouter.js';

/** Что нужно знать о провайдере помимо того, что прислал браузер */
export interface ProfileDefaults {
  /** Таймаут одного запроса, мс — из настроек приложения */
  timeoutMs: number;
}

/** Конфигурация запросов к удалённому провайдеру, готовая к передаче в клиент */
export interface ResolvedRemoteProfile {
  provider: AiProvider;
  /** Всегда адрес из openrouter.ts, независимо от присланного baseUrl */
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

/**
 * Почему профиль не принят. Машинное имя нужно вызывающему коду, русское
 * `message` показывается оператору дословно, поэтому оно обязано называть
 * конкретную проблему, а не «неверные параметры».
 */
export type ProfileRejection =
  | 'not-an-object'
  | 'model-missing'
  | 'model-empty'
  | 'model-invalid-characters'
  | 'key-missing'
  | 'key-empty'
  | 'unreadable';

export type ProfileResolution =
  | { ok: true; profile: ResolvedRemoteProfile }
  | { ok: false; reason: ProfileRejection; message: string };

/**
 * Пробел, таб и управляющие символы в идентификаторе модели.
 *
 * Перебор по символам, а не регулярное выражение с диапазоном `\x00-\x1f`:
 * в исходнике такие байты невидимы и легко портятся при переносе файла между
 * системами, а здесь каждое сравнение видно глазами.
 */
function hasForbiddenChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) return true;
    if (/\s/.test(char)) return true;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function reject(reason: ProfileRejection, message: string): ProfileResolution {
  return { ok: false, reason, message };
}

/** Поле ожидается строкой; всё остальное — не то, чем оно должно быть */
function readField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Превращает значение из запроса в конфигурацию удалённой модели либо в причину
 * отказа.
 *
 * Никогда не бросает исключений: вход приходит из тела multipart-запроса, то
 * есть от клиента, и падение здесь стало бы пятисоткой с текстом внутренней
 * ошибки вместо внятного ответа оператору.
 *
 * Порядок проверок — от модели к ключу: модель оператор набирает сам, и без неё
 * ключ всё равно некуда применить.
 */
export function resolveClientProfile(input: unknown, defaults: ProfileDefaults): ProfileResolution {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return reject(
        'not-an-object',
        'Не удалось прочитать выбор модели: в запросе ожидались идентификатор модели и API-ключ.',
      );
    }

    const record = input as Record<string, unknown>;

    const model = readField(record.model);
    if (model === undefined) {
      return reject('model-missing', 'Не удалось прочитать идентификатор модели — введите его заново.');
    }
    if (model.trim() === '') {
      return reject('model-empty', 'Укажите модель — её идентификатор из каталога OpenRouter.');
    }
    if (hasForbiddenChars(model)) {
      return reject(
        'model-invalid-characters',
        'Идентификатор модели не должен содержать пробелов или служебных символов.',
      );
    }

    const apiKey = readField(record.apiKey);
    if (apiKey === undefined) {
      return reject('key-missing', 'Не удалось прочитать API-ключ — введите его заново.');
    }
    if (apiKey.trim() === '') {
      return reject('key-empty', 'Укажите API-ключ OpenRouter.');
    }

    // baseUrl из запроса здесь не читается намеренно: адрес задаёт сервер.
    return {
      ok: true,
      profile: {
        provider: OPENROUTER_PROVIDER,
        baseUrl: OPENROUTER_CHAT_COMPLETIONS_URL,
        model,
        apiKey,
        timeoutMs: defaults.timeoutMs,
      },
    };
  } catch {
    // Причина неизвестна, а сообщение не должно содержать ничего из
    // присланного значения — поэтому оно обезличенное.
    return reject(
      'unreadable',
      'Не удалось разобрать выбор модели. Введите модель и API-ключ заново.',
    );
  }
}
