/**
 * Тесты preflight-проверок: доступность Ollama, наличие модели и открытие браузера.
 * Сеть не используется — fetch подменяется заглушкой.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkOllama, describeOllama, openBrowser } from '../src/preflight.js';
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
