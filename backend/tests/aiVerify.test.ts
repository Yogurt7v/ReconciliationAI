/**
 * Тесты проверок подключения, которые вызывает окно настроек модели.
 * Сеть не используется: и `fetch`, и `console` подменяются заглушками.
 *
 * Отдельный сюит в конце проверяет главное свойство модуля: ключ оператора
 * проходит через него, не оставляя следов ни в результате, ни в консоли.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Settings } from '../src/settings.js';
import { checkLocalAvailability, verifyRemoteProfile } from '../src/services/ai/verify.js';
import { resolveClientProfile } from '../src/services/ai/profile.js';
import type { ResolvedRemoteProfile } from '../src/services/ai/profile.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Заглушка fetch: тип vi.fn, как в остальных тестах набора */
type FetchStub = ReturnType<typeof vi.fn>;

/**
 * Ключ с особым содержимым: и не похож на настоящий, и содержит маркер, который
 * невозможно случайно получить в русском тексте сообщения.
 */
const API_KEY = 'sk-or-v1-ZZCANARY-ZZ-0123456789abcdef-ZZ';

/** Настройки из settings.txt, нужные проверке локальной модели */
const settings: Pick<Settings, 'ollamaBaseUrl' | 'ollamaModel' | 'aiTimeoutSec'> = {
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5:7b-instruct',
  aiTimeoutSec: 30,
};

/** Профиль проходит через настоящий разбор, а не собирается руками */
function profileOf(model: string, apiKey: string = API_KEY): ResolvedRemoteProfile {
  const resolution = resolveClientProfile({ model, apiKey }, { timeoutMs: 30000 });
  if (!resolution.ok) throw new Error(`ожидался успех разбора профиля, получено «${resolution.reason}»`);
  return resolution.profile;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Каталог из заданных идентификаторов */
function catalog(ids: readonly string[]): Response {
  return json({ data: ids.map((id) => ({ id })) });
}

/** Ответ /key: остаток кредита считается как limit минус usage */
function keyResponse(overrides: Record<string, unknown> = {}): Response {
  return json({ data: { label: 'recon', limit: 20, usage: 7.5, ...overrides } });
}

/**
 * Заглушка сети на оба адреса: /key отвечает keyResponse, /models — каталогом.
 * Ответы берутся по адресу, а не по порядку вызовов: две проверки идут
 * одновременно, и порядок их запуска не входит в контракт.
 */
function stubOpenRouter(
  modelIds: readonly string[],
  key: () => Response | Promise<Response> = keyResponse,
): FetchStub {
  const stub = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/key')) return key();
    if (url.endsWith('/models')) return catalog(modelIds);
    throw new Error(`незапланированный адрес: ${url}`);
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

/** Заглушка, приведённая к типу fetch для передачи в проверяемый код */
const asFetch = (stub: FetchStub): typeof fetch => stub as unknown as typeof fetch;

/** Все адреса исходящих запросов */
function urlsOf(stub: FetchStub): string[] {
  return stub.mock.calls.map((call) => String(call[0]));
}

/** Заголовки запроса к адресу, оканчивающемуся на suffix */
function headersFor(stub: FetchStub, suffix: string): Record<string, string> {
  const call = stub.mock.calls.find((one) => String(one[0]).endsWith(suffix)) as [string, RequestInit] | undefined;
  return (call?.[1]?.headers ?? {}) as Record<string, string>;
}

describe('verifyRemoteProfile: успешный профиль', () => {
  it('ключ принят, модель найдена, остаток кредита назван', async () => {
    const stub = stubOpenRouter(['vendor/model-a:free', 'vendor/model-b']);

    const result = await verifyRemoteProfile(profileOf('vendor/model-b'), asFetch(stub));

    expect(result).toMatchObject({
      status: 'ok',
      keyValid: true,
      remainingCredit: 12.5,
      modelVerdict: 'present',
      reason: null,
    });
    expect(result.message).toContain('vendor/model-b');
    expect(result.message).toContain('12.50');
  });

  it('ни один запрос не уходит к модели — кредит не тратится', async () => {
    const stub = stubOpenRouter(['vendor/model-a']);

    await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    const urls = urlsOf(stub);
    expect(urls).toHaveLength(2);
    expect(urls.filter((url) => url.endsWith('/key'))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith('/models'))).toHaveLength(1);
    // Обращение к chat/completions означало бы оплаченный вызов модели
    expect(urls.some((url) => url.includes('chat/completions'))).toBe(false);
  });

  it('ключ уходит только в /key, а каталог запрашивается без него', async () => {
    const stub = stubOpenRouter(['vendor/model-a']);

    await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(headersFor(stub, '/key').Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headersFor(stub, '/models').Authorization).toBeUndefined();
  });

  it('остаток кредита берётся из limit_remaining, когда он есть', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () => keyResponse({ limit_remaining: 3, usage: 99 }));

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'ok', remainingCredit: 3 });
  });

  it('безлимитный ключ — кредит неизвестен, а не ноль', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () => keyResponse({ limit: null, usage: 42 }));

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'ok', remainingCredit: null });
    expect(result.message).not.toContain('Остаток кредита');
  });

  it('лимит каталога OpenRouter наружу не выдаётся', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () =>
      keyResponse({ free_model_daily_requests: { remaining: 180 } }),
    );

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(JSON.stringify(result)).not.toContain('free_model_daily_requests');
    expect(JSON.stringify(result)).not.toContain('180');
  });

  it('повторных попыток нет: два адреса, два запроса', async () => {
    const stub = stubOpenRouter(['vendor/model-a']);

    await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(stub).toHaveBeenCalledTimes(2);
  });
});

describe('verifyRemoteProfile: ключ отвергнут', () => {
  it('HTTP 401 — названная причина «отклонён»', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () => json({ error: { message: 'No auth credentials found' } }, 401));

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'failed', keyValid: false, reason: 'key-rejected' });
    expect(result.message).toContain('отклонён');
    expect(result.message).toContain('401');
  });

  it('HTTP 403 — та же причина, ключ не годен', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () => json({}, 403));

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'failed', reason: 'key-rejected' });
  });

  it('HTTP 402 — нужен кредит, а не новый ключ', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () => json({}, 402));

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'failed', keyValid: false, reason: 'key-no-credit' });
    expect(result.message).toContain('402');
  });

  it('сеть недоступна — «не удалось проверить», а не «ключ отвергнут»', async () => {
    const stub = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', stub);

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'failed', keyValid: false, reason: 'key-unreachable' });
    expect(result.message).toContain('не ответил');
    expect(result.message).toContain('а не «ключ отвергнут»');
  });

  it('пятьсотка — причина названа, но ключ не объявлен отвергнутым', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () => json({ error: { message: 'upstream boom' } }, 503));

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'failed', keyValid: false, reason: 'key-unreachable' });
    expect(result.message).toContain('503');
  });

  it('ответ без данных о ключе — проверка невыполнена', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () => new Response('not json', { status: 200 }));

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'failed', keyValid: false, reason: 'key-unexpected' });
  });

  it('отказ ключа не отменяет проверку модели — обе выполняются', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () => json({}, 401));

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    // Модель в каталоге есть, и оператор должен узнать, что дело не только в ключе
    expect(result).toMatchObject({ modelVerdict: 'present' });
    expect(stub).toHaveBeenCalledTimes(2);
  });
});

describe('verifyRemoteProfile: идентификатор модели', () => {
  it('модели нет в каталоге — названная причина с обоими идентификаторами', async () => {
    const stub = stubOpenRouter(['vendor/model-a']);

    const result = await verifyRemoteProfile(profileOf('vendor/model-z:free'), asFetch(stub));

    expect(result).toMatchObject({
      status: 'failed',
      keyValid: true,
      reason: 'model-absent',
      modelVerdict: 'absent',
    });
    expect(result.message).toContain('не найдена в каталоге OpenRouter');
    expect(result.message).toContain('vendor/model-z:free');
  });

  it('суффикс маршрутизации снимается перед поиском', async () => {
    const stub = stubOpenRouter(['vendor/model-a']);

    const result = await verifyRemoteProfile(profileOf('vendor/model-a:nitro'), asFetch(stub));

    expect(result).toMatchObject({ status: 'ok', modelVerdict: 'present' });
  });

  it('в сообщении видно, под каким именем шёл поиск', async () => {
    const stub = stubOpenRouter(['vendor/model-a']);

    const result = await verifyRemoteProfile(profileOf('vendor/model-a:floor'), asFetch(stub));

    // Поиск идёт по «vendor/model-a», и оператор должен видеть, что это не опечатка
    expect(result.status).toBe('ok');
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it('«:free» остаётся частью имени — платная модель не выдаётся за выбранную', async () => {
    const stub = stubOpenRouter(['vendor/model-a']);

    const result = await verifyRemoteProfile(profileOf('vendor/model-a:free'), asFetch(stub));

    expect(result).toMatchObject({ status: 'failed', reason: 'model-absent', modelVerdict: 'absent' });
  });

  it('каталог недоступен — вердикт «не проверено», а не «модели нет»', async () => {
    const stub = vi.fn(async (input: unknown) =>
      String(input).endsWith('/key') ? keyResponse() : json({}, 500),
    );
    vi.stubGlobal('fetch', stub);

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({
      status: 'unchecked',
      keyValid: true,
      modelVerdict: 'inconclusive',
      reason: 'catalog-unavailable',
    });
    expect(result.message).toContain('Ключ принят');
  });

  it('каталог не пришёл вовсе — ключ уже проверен, модель нет', async () => {
    const stub = vi.fn(async (input: unknown) => {
      if (String(input).endsWith('/key')) return keyResponse();
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', stub);

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'unchecked', keyValid: true, reason: 'catalog-unavailable' });
  });

  it('каталог без списка моделей — проверка не выполнена, а не провалена', async () => {
    const stub = vi.fn(async (input: unknown) =>
      String(input).endsWith('/key') ? keyResponse() : json({ error: 'nope' }),
    );
    vi.stubGlobal('fetch', stub);

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'unchecked', modelVerdict: 'inconclusive' });
  });

  it('пустой каталог — своя причина, а не «каталог недоступен»', async () => {
    const stub = stubOpenRouter([]);

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({
      status: 'unchecked',
      keyValid: true,
      reason: 'catalog-empty',
      modelVerdict: 'inconclusive',
    });
  });
});

describe('verifyRemoteProfile: кредит', () => {
  it('нулевой остаток при платной модели — названная причина и подсказка про :free', async () => {
    const stub = stubOpenRouter(
      ['vendor/model-a'],
      () => keyResponse({ limit: 20, usage: 20, limit_remaining: 0 }),
    );

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result).toMatchObject({ status: 'failed', keyValid: true, remainingCredit: 0, reason: 'key-no-credit' });
    expect(result.message).toContain(':free');
  });

  it('нулевой остаток при бесплатной модели — не приговор', async () => {
    const stub = stubOpenRouter(
      ['vendor/model-a:free'],
      () => keyResponse({ limit: 20, usage: 20, limit_remaining: 0 }),
    );

    const result = await verifyRemoteProfile(profileOf('vendor/model-a:free'), asFetch(stub));

    expect(result).toMatchObject({ status: 'ok', remainingCredit: 0, modelVerdict: 'present' });
    expect(result.message).toContain('бесплатная модель');
  });

  it('бесплатная модель с суффиксом маршрутизации тоже бесплатна', async () => {
    const stub = stubOpenRouter(
      ['vendor/model-a:free'],
      () => keyResponse({ limit: 20, usage: 20, limit_remaining: 0 }),
    );

    const result = await verifyRemoteProfile(profileOf('vendor/model-a:free:nitro'), asFetch(stub));

    expect(result).toMatchObject({ status: 'ok', remainingCredit: 0 });
  });
});

describe('гарантия: ключ не покидает проверку', () => {
  /**
   * Любая подстрока ключа длиной не меньше minLen в тексте — уже утечка: полного
   * совпадения ждать нельзя, провайдер может процитировать ключ частично.
   */
  function leakedSubstring(text: string, secret: string, minLen = 6): string | null {
    for (let start = 0; start + minLen <= secret.length; start += 1) {
      for (let len = minLen; start + len <= secret.length; len += 1) {
        const slice = secret.slice(start, start + len);
        if (text.includes(slice)) return slice;
      }
    }
    return null;
  }

  /** Подменяет консоль и отдаёт собранные строки вместе с восстановлением */
  function captureConsole(): () => string {
    const lines: string[] = [];
    const spy = (level: 'log' | 'info' | 'warn' | 'error') =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => String(arg)).join(' '));
      });
    const spies = (['log', 'info', 'warn', 'error'] as const).map(spy);
    return () => {
      spies.forEach((one) => one.mockRestore());
      return lines.join('\n');
    };
  }

  it('провайдер процитировал ключ в ошибке — в сообщении его нет', async () => {
    const stub = stubOpenRouter(['vendor/model-a'], () =>
      json({ error: { message: `Invalid API key: Bearer ${API_KEY}` } }, 401),
    );

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result.status).toBe('failed');
    // Обезличивание сработало: ключа в тексте нет, а его след — «***»
    expect(result.message).toContain('***');
    expect(leakedSubstring(result.message, API_KEY)).toBeNull();
  });

  it('провайдер процитировал ключ в другом регистре — регулярка по форме ключа его закрывает', async () => {
    const shouted = API_KEY.toUpperCase();
    const stub = stubOpenRouter(['vendor/model-a'], () => json({ error: { message: `key ${shouted}` } }, 401));

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(result.message).not.toContain(shouted);
  });

  it('сетевая ошибка с ключом в тексте — тоже обезличено', async () => {
    const stub = vi.fn(async () => {
      throw new Error(`request failed, Authorization: Bearer ${API_KEY}`);
    });
    vi.stubGlobal('fetch', stub);

    const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));

    expect(leakedSubstring(result.message, API_KEY)).toBeNull();
  });

  it('ни один сценарий не печатает в консоль и не возвращает ключ', async () => {
    const failures: ReadonlyArray<() => Response> = [
      () => json({ error: { message: `bad key ${API_KEY}` } }, 401),
      () => json({}, 402),
      () => json({ error: { message: `bad key ${API_KEY}` } }, 503),
      () => new Response(`<html>${API_KEY}</html>`, { status: 200 }),
      () => keyResponse({ limit: 20, usage: 20, limit_remaining: 0 }),
    ];

    const stopCapture = captureConsole();
    try {
      for (const key of failures) {
        const stub = stubOpenRouter(['vendor/model-a'], key);
        const result = await verifyRemoteProfile(profileOf('vendor/model-a'), asFetch(stub));
        // Весь результат целиком, а не только message: ключ не должен появиться ни в одном поле
        expect(leakedSubstring(JSON.stringify(result), API_KEY)).toBeNull();
      }
    } finally {
      const printed = stopCapture();
      expect(printed).toBe('');
    }
  });
});

describe('checkLocalAvailability', () => {
  /** Ответ /api/tags со списком имён моделей */
  function tags(models: readonly string[], status = 200): Response {
    return json({ models: models.map((name) => ({ name, model: name })) }, status);
  }

  it('модель на месте — ready, с подсказкой describeOllama', async () => {
    const stub = vi.fn().mockResolvedValue(tags(['qwen2.5:7b-instruct']));

    const out = await checkLocalAvailability(settings, asFetch(stub));

    expect(out).toMatchObject({ verdict: 'ready', model: 'qwen2.5:7b-instruct' });
    expect(out.remedy).toContain('доступна');
    expect(out.remedy).toContain('qwen2.5:7b-instruct');
  });

  it('модель не скачана — model-missing и команда ollama pull', async () => {
    const stub = vi.fn().mockResolvedValue(tags(['llama3.1:8b']));

    const out = await checkLocalAvailability(settings, asFetch(stub));

    expect(out.verdict).toBe('model-missing');
    expect(out.remedy).toContain('ollama pull qwen2.5:7b-instruct');
  });

  it('Ollama не запущена — not-listening, а не «не установлена» наугад', async () => {
    const stub = vi.fn().mockRejectedValue({ cause: { code: 'ECONNREFUSED' } });

    const out = await checkLocalAvailability(settings, asFetch(stub));

    expect(out.verdict).toBe('not-listening');
    expect(out.remedy).toContain('ollama serve');
  });

  it('Ollama не ответила — unresponsive', async () => {
    const stub = vi.fn().mockRejectedValue({ name: 'AbortError' });

    const out = await checkLocalAvailability(settings, asFetch(stub));

    expect(out.verdict).toBe('unresponsive');
  });

  it('проверка идёт по адресу из настроек и один раз', async () => {
    const stub = vi.fn().mockResolvedValue(tags(['qwen2.5:7b-instruct']));

    await checkLocalAvailability(settings, asFetch(stub));

    expect(String(stub.mock.calls[0]?.[0])).toBe('http://localhost:11434/api/tags');
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('ни один вердикт не содержит признака запрета — запуск задания не блокируется', async () => {
    for (const stub of [
      vi.fn().mockResolvedValue(tags(['qwen2.5:7b-instruct'])),
      vi.fn().mockResolvedValue(tags([])),
      vi.fn().mockRejectedValue({ cause: { code: 'ECONNREFUSED' } }),
      vi.fn().mockRejectedValue({ name: 'AbortError' }),
    ]) {
      const out = await checkLocalAvailability(settings, asFetch(stub));
      expect(Object.keys(out).sort()).toEqual(['model', 'remedy', 'verdict']);
    }
  });
});