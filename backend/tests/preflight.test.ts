/**
 * Тесты preflight-проверок: доступность Ollama, наличие модели и открытие браузера.
 * Сеть не используется — fetch подменяется заглушкой.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkOllama, describeOllama, openBrowser } from '../src/preflight.js';
import { classifyOllamaCheck } from '../src/services/ai/ollamaStatus.js';
import type { Settings } from '../src/settings.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const settings: Pick<Settings, 'ollamaBaseUrl' | 'ollamaModel' | 'aiTimeoutSec'> = {
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5:7b-instruct',
  aiTimeoutSec: 30,
};

/** Ответ /api/tags со списком имён моделей */
function tagsResponse(models: string[], status = 200): Response {
  return new Response(
    JSON.stringify({ models: models.map((name) => ({ name, model: name })) }),
    { status },
  );
}

describe('checkOllama', () => {
  it('Ollama недоступна — network-ошибка', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const out = await checkOllama(settings);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('unreachable');
  });

  it('Ollama ответила, но неверный статус', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })));
    const out = await checkOllama(settings);
    expect(out).toMatchObject({ ok: false, reason: 'unreachable', detail: 'HTTP 502' });
  });

  it('модель найдена среди тегов', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tagsResponse(['llama3.1:8b', 'qwen2.5:7b-instruct']));
    vi.stubGlobal('fetch', fetchMock);

    const out = await checkOllama(settings);
    expect(out.ok).toBe(true);
    // Хвостовые слэши в адресе не должны давать двойной
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/tags');
  });

  it('модель не скачана — предлагаем ollama pull', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tagsResponse(['llama3.1:8b'])));

    const out = await checkOllama(settings);
    expect(out).toMatchObject({ ok: false, reason: 'model-missing', detail: 'qwen2.5:7b-instruct' });

    const text = describeOllama(out, settings);
    expect(text).toContain('ollama pull qwen2.5:7b-instruct');
    expect(text).toContain('llama3.1:8b');
  });

  it('пустой список моделей', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tagsResponse([])));

    const out = await checkOllama(settings);
    expect(out).toMatchObject({ ok: false, reason: 'model-missing' });
    expect(describeOllama(out, settings)).toContain('нет ни одной модели');
  });

  it('тег без суффикса не совпадает с запрошенной моделью', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tagsResponse(['qwen2.5:7b'])));
    expect(await checkOllama(settings)).toMatchObject({ ok: false, reason: 'model-missing' });
  });

  it('невалидный JSON трактуется как пустой список моделей', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    expect(await checkOllama(settings)).toMatchObject({ ok: false, reason: 'model-missing' });
  });

  it('описание недоступности подсказывает запустить Ollama', async () => {
    const out = await checkOllama(
      settings,
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch,
    );
    expect(describeOllama(out, settings)).toContain('ollama serve');
  });
});

/**
 * Вердикт проверяется сквозь сам checkOllama, а не на собранном вручную объекте:
 * тест на синтетике прошёл бы даже при неверно протянутом causeCode.
 */
describe('classifyOllamaCheck', () => {
  it('модель скачана — ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tagsResponse(['qwen2.5:7b-instruct'])));
    expect(classifyOllamaCheck(await checkOllama(settings))).toBe('ready');
  });

  it('Ollama отвечает, но модель не скачана — model-missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tagsResponse(['llama3.1:8b'])));
    expect(classifyOllamaCheck(await checkOllama(settings))).toBe('model-missing');
  });

  it('отказ соединения (ECONNREFUSED) — not-listening', async () => {
    const fetchImpl = vi.fn().mockRejectedValue({ cause: { code: 'ECONNREFUSED' } }) as unknown as typeof fetch;

    const out = await checkOllama(settings, fetchImpl);
    // Причина обязана доехать до результата проверки — ради неё всё и затевалось
    expect(out).toMatchObject({ ok: false, reason: 'unreachable', causeCode: 'ECONNREFUSED' });
    expect(classifyOllamaCheck(out)).toBe('not-listening');
  });

  it('сбой DNS (ENOTFOUND) — not-listening', async () => {
    const fetchImpl = vi.fn().mockRejectedValue({ cause: { code: 'ENOTFOUND' } }) as unknown as typeof fetch;
    expect(classifyOllamaCheck(await checkOllama(settings, fetchImpl))).toBe('not-listening');
  });

  it('localhost: AggregateError с кодом на самом агрегате — not-listening', async () => {
    // Так выглядит отказ на Node 24: localhost резолвится и в IPv6, и в IPv4
    const aggregate = Object.assign(new AggregateError([]), { code: 'ECONNREFUSED' });
    const fetchImpl = vi.fn().mockRejectedValue({ cause: aggregate }) as unknown as typeof fetch;
    expect(classifyOllamaCheck(await checkOllama(settings, fetchImpl))).toBe('not-listening');
  });

  it('localhost: AggregateError без своего кода берёт errors[0] — not-listening', async () => {
    const aggregate = new AggregateError([
      Object.assign(new Error('connect ECONNREFUSED ::1:11434'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }),
    ]);
    const fetchImpl = vi.fn().mockRejectedValue({ cause: aggregate }) as unknown as typeof fetch;
    expect(classifyOllamaCheck(await checkOllama(settings, fetchImpl))).toBe('not-listening');
  });

  it('отмена проверки по таймауту (AbortError) — unresponsive', async () => {
    const fetchImpl = vi.fn().mockRejectedValue({ name: 'AbortError' }) as unknown as typeof fetch;

    const out = await checkOllama(settings, fetchImpl);
    expect(out).toMatchObject({ ok: false, reason: 'unreachable' });
    expect('causeCode' in out ? out.causeCode : undefined).toBeUndefined();
    expect(classifyOllamaCheck(out)).toBe('unresponsive');
  });

  it('Ollama ответила неверным статусом — unresponsive, а не «не запущена»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })));

    const out = await checkOllama(settings);
    expect(out).toMatchObject({ ok: false, reason: 'unreachable', detail: 'HTTP 502' });
    expect(classifyOllamaCheck(out)).toBe('unresponsive');
  });

  it('причина без кода — unresponsive даже когда текст похож на отказ', async () => {
    // Текст ошибки разбирать нельзя: тот же ECONNREFUSED без cause — это не отказ
    const fetchImpl = vi.fn().mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:11434'),
    ) as unknown as typeof fetch;
    expect(classifyOllamaCheck(await checkOllama(settings, fetchImpl))).toBe('unresponsive');
  });

  it('«fetch failed» без причины — unresponsive, а не «не запущена»', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    expect(classifyOllamaCheck(await checkOllama(settings, fetchImpl))).toBe('unresponsive');
  });

  it('неизвестный код причины — unresponsive', async () => {
    const fetchImpl = vi.fn().mockRejectedValue({ cause: { code: 'EHOSTUNREACH' } }) as unknown as typeof fetch;
    expect(classifyOllamaCheck(await checkOllama(settings, fetchImpl))).toBe('unresponsive');
  });
});

describe('openBrowser', () => {
  it('на Windows зовёт cmd start', () => {
    const spawn = vi.fn().mockReturnValue({ on: vi.fn(), unref: vi.fn() });
    vi.doMock('node:child_process', () => ({ spawn }));
    expect(() => openBrowser('http://localhost:8080', 'win32')).not.toThrow();
    vi.doUnmock('node:child_process');
  });

  it('ошибка запуска не пробрасывается наружу', () => {
    const spawn = vi.fn().mockImplementation(() => {
      throw new Error('ENOENT');
    });
    vi.doMock('node:child_process', () => ({ spawn }));
    expect(() => openBrowser('http://localhost:8080', 'linux')).not.toThrow();
    vi.doUnmock('node:child_process');
  });
});
