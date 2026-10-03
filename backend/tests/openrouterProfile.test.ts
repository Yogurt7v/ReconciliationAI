/**
 * Тесты чистых модулей профиля удалённой модели и правила каталога OpenRouter.
 * Сеть не используется: оба модуля её не выполняют в принципе.
 */

import { describe, expect, it } from 'vitest';

import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  classifyModelId,
  normalizeModelIdForCatalogLookup,
} from '../src/services/ai/openrouter.js';
import { resolveClientProfile } from '../src/services/ai/profile.js';
import type { ProfileDefaults, ProfileResolution } from '../src/services/ai/profile.js';

const defaults: ProfileDefaults = { timeoutMs: 30000 };

const NON_OBJECT_INPUTS: ReadonlyArray<readonly [string, unknown]> = [
  ['строка', 'a/b:free'],
  ['число', 42],
  ['null', null],
  ['массив', ['a/b:free', 'k']],
  ['неопределённость', undefined],
  ['булево значение', true],
];

/** Принимает профиль и достаёт конфигурацию, падая на отказе с его текстом */
function accepted(resolution: ProfileResolution) {
  if (!resolution.ok) throw new Error(`ожидался успех, получено «${resolution.reason}»`);
  return resolution.profile;
}

/** Принимает профиль и достаёт причину отказа */
function rejected(resolution: ProfileResolution) {
  if (resolution.ok) throw new Error('ожидался отказ, получена конфигурация');
  return resolution;
}

describe('resolveClientProfile', () => {
  it('корректный профиль даёт провайдера openrouter с точным идентификатором модели', () => {
    const profile = accepted(
      resolveClientProfile(
        { model: 'inclusionai/ling-3.0-flash-sante:free', apiKey: 'sk-or-v1-x' },
        defaults,
      ),
    );

    expect(profile.provider).toBe('openrouter');
    expect(profile.model).toBe('inclusionai/ling-3.0-flash-sante:free');
    expect(profile.apiKey).toBe('sk-or-v1-x');
    expect(profile.baseUrl).toBe(OPENROUTER_CHAT_COMPLETIONS_URL);
    expect(profile.timeoutMs).toBe(30000);
  });

  it('таймаут берётся из настроек, а не из запроса', () => {
    const profile = accepted(
      resolveClientProfile({ model: 'a/b:free', apiKey: 'k', timeoutMs: 1 }, { timeoutMs: 45000 }),
    );
    expect(profile.timeoutMs).toBe(45000);
  });

  it('присланный baseUrl игнорируется — адрес назначения задаёт сервер', () => {
    // Защита от открытого прокси: подставив свой адрес, отправитель увёл бы
    // ключ оператора на чужой хост.
    const profile = accepted(
      resolveClientProfile({ model: 'a/b:free', apiKey: 'k', baseUrl: 'http://evil.example/v1' }, defaults),
    );

    expect(profile.baseUrl).toBe(OPENROUTER_CHAT_COMPLETIONS_URL);
    expect(profile.baseUrl).not.toContain('evil');
  });

  it('пустая модель — «Укажите модель»', () => {
    expect(rejected(resolveClientProfile({ model: '', apiKey: 'k' }, defaults))).toMatchObject({
      reason: 'model-empty',
      message: 'Укажите модель — её идентификатор из каталога OpenRouter.',
    });
  });

  it('модель из одних пробелов — та же причина, что и пустая', () => {
    expect(rejected(resolveClientProfile({ model: '   ', apiKey: 'k' }, defaults)).reason).toBe('model-empty');
  });

  it('пустой ключ — «Укажите API-ключ OpenRouter.»', () => {
    expect(rejected(resolveClientProfile({ model: 'a/b:free', apiKey: '  ' }, defaults))).toMatchObject({
      reason: 'key-empty',
      message: 'Укажите API-ключ OpenRouter.',
    });
  });

  it('модель с пробелом внутри — отдельная причина, а не «модель не указана»', () => {
    expect(rejected(resolveClientProfile({ model: 'a/b free', apiKey: 'k' }, defaults))).toMatchObject({
      reason: 'model-invalid-characters',
      message: 'Идентификатор модели не должен содержать пробелов или служебных символов.',
    });
  });

  it('модель с табулицией и переводом строки — та же причина', () => {
    const tab = String.fromCharCode(9);
    const newline = String.fromCharCode(10);
    expect(rejected(resolveClientProfile({ model: `a/b${tab}c`, apiKey: 'k' }, defaults)).reason).toBe(
      'model-invalid-characters',
    );
    expect(rejected(resolveClientProfile({ model: `a/b${newline}c`, apiKey: 'k' }, defaults)).reason).toBe(
      'model-invalid-characters',
    );
  });

  it('модель с управляющим символом DEL — та же причина', () => {
    const del = String.fromCharCode(0x7f);
    expect(rejected(resolveClientProfile({ model: `a/b${del}c`, apiKey: 'k' }, defaults)).reason).toBe(
      'model-invalid-characters',
    );
  });

  it('модель не строка — «введите заново», а не «укажите модель»', () => {
    expect(rejected(resolveClientProfile({ model: 42, apiKey: 'k' }, defaults))).toMatchObject({
      reason: 'model-missing',
      message: 'Не удалось прочитать идентификатор модели — введите его заново.',
    });
  });

  it('ключ не строка — «введите заново», а не «укажите ключ»', () => {
    expect(rejected(resolveClientProfile({ model: 'a/b:free', apiKey: { value: 'k' } }, defaults))).toMatchObject({
      reason: 'key-missing',
      message: 'Не удалось прочитать API-ключ — введите его заново.',
    });
  });

  it('модель проверяется раньше ключа — без модели ключ ни при чём', () => {
    expect(rejected(resolveClientProfile({ apiKey: 'k' }, defaults)).reason).toBe('model-missing');
    expect(rejected(resolveClientProfile({}, defaults)).reason).toBe('model-missing');
  });

  it.each(NON_OBJECT_INPUTS)('вход не объект (%s) — отказ без исключения', (_label, input) => {
    expect(() => resolveClientProfile(input, defaults)).not.toThrow();

    const resolution = resolveClientProfile(input, defaults);
    expect(rejected(resolution)).toMatchObject({ reason: 'not-an-object' });
    expect(rejected(resolution).message).toContain('Не удалось прочитать выбор модели');
  });

  it('объект с чужими полями без модели и ключа — отказ, а не «профиль пуст, едем на локальную модель»', () => {
    expect(rejected(resolveClientProfile({ provider: 'openrouter', model2: 'a/b' }, defaults)).reason).toBe(
      'model-missing',
    );
  });

  it('в сообщении об отказе нет ни фрагмента ключа, ни фрагмента модели', () => {
    // Текст отказа показывается оператору и уходит в интерфейс, поэтому он
    // обязан быть обезличенным даже при самом неудачном входе.
    const key = 'sk-or-v1-super-secret';
    const messages = [
      resolveClientProfile({ model: '', apiKey: key }, defaults),
      resolveClientProfile({ model: 'a/b free', apiKey: key }, defaults),
      resolveClientProfile({ model: 'a/b:free', apiKey: '' }, defaults),
      resolveClientProfile(key, defaults),
    ].map((resolution) => rejected(resolution).message);

    for (const message of messages) {
      expect(message).not.toContain(key);
      expect(message).not.toContain('sk-or');
    }
  });
});

describe('OPENROUTER_CHAT_COMPLETIONS_URL', () => {
  it('адрес задан на сервере и указывает на chat completions', () => {
    expect(OPENROUTER_CHAT_COMPLETIONS_URL).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});

describe('normalizeModelIdForCatalogLookup', () => {
  it('суффикс каталога :free сохраняется — это самостоятельная модель', () => {
    // Снять его нельзя: поиск a/b нашёл бы платную запись и описал не ту
    // модель, которую оператор выбрал.
    expect(normalizeModelIdForCatalogLookup('a/b:free')).toBe('a/b:free');
  });

  it('суффикс каталога :batch сохраняется', () => {
    expect(normalizeModelIdForCatalogLookup('a/b:batch')).toBe('a/b:batch');
  });

  it.each([':nitro', ':floor', ':exacto', ':online'])('суффикс маршрутизации %s снимается', (suffix) => {
    expect(normalizeModelIdForCatalogLookup(`a/b${suffix}`)).toBe('a/b');
  });

  it('незнакомый суффикс не трогается: модель может им называться', () => {
    expect(normalizeModelIdForCatalogLookup('a/b:thinking')).toBe('a/b:thinking');
  });

  it('идентификатор без суффикса и с пробелами по краям не меняется', () => {
    expect(normalizeModelIdForCatalogLookup('  a/b  ')).toBe('a/b');
  });

  it('снимается только последний суффикс, а не всё после первого двоеточия', () => {
    expect(normalizeModelIdForCatalogLookup('a/b:free:nitro')).toBe('a/b:free');
  });
});

describe('classifyModelId', () => {
  const catalog = ['a/b:free', 'c/d', 'e/f:batch'];

  it('суффикс каталога найден — present', () => {
    expect(classifyModelId('a/b:free', catalog)).toBe('present');
  });

  it('суффикс маршрутизации найден по базовому идентификатору — present', () => {
    expect(classifyModelId('a/b:free:nitro', catalog)).toBe('present');
    expect(classifyModelId('c/d:floor', catalog)).toBe('present');
  });

  it('каталог сам перечисляет маршрутизированный идентификатор — present', () => {
    expect(classifyModelId('c/d:online', [...catalog, 'c/d:online'])).toBe('present');
  });

  it('идентификатора нет в каталоге — absent', () => {
    expect(classifyModelId('zzz/qqq:free', catalog)).toBe('absent');
  });

  it('регистр в идентификаторе или каталоге не превращает проверку в ложное «нет»', () => {
    expect(classifyModelId('A/B:FREE', catalog)).toBe('present');
    expect(classifyModelId('a/b:free', ['A/B:FREE'])).toBe('present');
  });

  it('пустой каталог — inconclusive, а не «модели нет»', () => {
    // Каталог не пришёл — сказать «не найдена» нельзя, иначе интерфейс
    // покажет ложную причину отказа.
    expect(classifyModelId('a/b:free', [])).toBe('inconclusive');
  });

  it('пустой идентификатор — inconclusive', () => {
    expect(classifyModelId('   ', catalog)).toBe('inconclusive');
  });
});
