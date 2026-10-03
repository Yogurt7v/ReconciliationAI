/**
 * Тесты AI-сервиса: клиент модели (retry/бюджет попыток/таймаут/JSON) для
 * локального Ollama и удалённого OpenRouter, конфигурация из settings.txt,
 * ассистент структуры со слиянием эвристик и деградацией, гипотезы.
 * Сеть не используется — global.fetch подменяется заглушками.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AiUnavailableError,
  aiConfigFromRemoteProfile,
  aiConfigFromSettings,
  remoteProviderCause,
  requestJson,
  type AiOllamaConfig,
  type AiRemoteConfig,
} from '../src/services/ai/client.js';
import { OPENROUTER_CHAT_COMPLETIONS_URL } from '../src/services/ai/openrouter.js';
import { assistStructure } from '../src/services/ai/structureAssist.js';
import { fullReconciliation } from '../src/services/ai/reconciliation.js';
import type { DocumentData } from '../src/services/ai/testAnalyze.js';
import { resolveStructure } from '../src/jobs/pipeline.js';
import { createJob } from '../src/jobs/store.js';
import type { Job } from '../src/jobs/store.js';
import {
  aiHypotheses,
  ruleBasedHypotheses,
  type HypothesisContext,
} from '../src/services/ai/hypotheses.js';
import type { Grid } from '@recon/shared';
import type { Settings } from '../src/settings.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Настройки для тестов: минимум, который читает aiConfigFromSettings */
const testSettings = (over: Partial<Settings> = {}): Settings => ({
  appHost: '127.0.0.1',
  appPort: 8080,
  apiBaseUrl: '',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'test-model',
  aiTimeoutSec: 30,
  logLevel: 'info',
  logFile: '',
  openBrowser: true,
  ...over,
});

/** Минимальная конфигурация клиента (OpenAI-совместимый endpoint) */
const baseConfig = (overrides: Partial<AiOllamaConfig> = {}): AiOllamaConfig => ({
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
  model: 'm',
  timeoutMs: 30_000,
  ...overrides,
});

/** Ключ-заглушка удалённого профиля */
const SECRET = 'sk-or-v1-testkey-0123456789';

/**
 * Конфигурация удалённого провайдера. Собирается фабрикой из `profile.ts`
 * и получает `baseUrl` намеренно чужой: адрес назначения задаёт сервер, и
 * фабрика обязана его переписать.
 */
const remoteConfig = (overrides: Partial<AiRemoteConfig> = {}): AiRemoteConfig => ({
  ...aiConfigFromRemoteProfile({
    provider: 'openrouter',
    baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'vendor/model:free',
    apiKey: SECRET,
    timeoutMs: 30_000,
  }),
  ...overrides,
});

/** Ответ модели с заданным JSON-полезным содержимым */
function chatOk(content: unknown, status = 200): Response {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status });
}

/** Сырое тело ответа шлюза — для случаев, где нужен нестандартный вид JSON */
function rawBody(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Заголовки и тело первого (и единственного) исходящего запроса */
function sentRequest(mock: ReturnType<typeof vi.fn>): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const [url, init] = mock.mock.calls[0] as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

/* ------------------------------ Настройки --------------------------------- */

describe('aiConfigFromSettings', () => {
  it('собирает endpoint и таймаут из настроек', () => {
    const config = aiConfigFromSettings(
      testSettings({ ollamaBaseUrl: 'http://localhost:11434', ollamaModel: 'qwen2.5:7b-instruct', aiTimeoutSec: 45 }),
    );
    expect(config.baseUrl).toBe('http://localhost:11434/v1/chat/completions');
    expect(config.model).toBe('qwen2.5:7b-instruct');
    expect(config.timeoutMs).toBe(45_000);
  });

  it('не дублирует слеш при адресе с хвостовым /', () => {
    const config = aiConfigFromSettings(testSettings({ ollamaBaseUrl: 'http://localhost:11434/' }));
    expect(config.baseUrl).toBe('http://localhost:11434/v1/chat/completions');
  });
});

/* -------------------------------- Клиент ---------------------------------- */

describe('requestJson', () => {
  it('парсит валидный JSON-ответ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatOk({ ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await requestJson<{ ok: number }>(baseConfig(), 'sys', {});
    expect(out.data).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.debug.attempts).toBe(1);
  });

  it('отправляет Bearer ollama и модель из конфигурации', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatOk('{"ok":1}'));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson(baseConfig({ model: 'qwen2.5:7b' }), 'sys', {});
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ollama');
    expect(JSON.parse(init.body as string).model).toBe('qwen2.5:7b');
  });

  it('снимает markdown-обёртку ```json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chatOk('```json\n{"ok":1}\n```')));

    const out = await requestJson<{ ok: number }>(baseConfig(), 'sys', {});
    expect(out.data).toEqual({ ok: 1 });
  });

  it('повторяет запрос при HTTP 503 и успешно завершает', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'upstream' } }), { status: 503 }),
      )
      .mockResolvedValueOnce(chatOk('"yes"'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await requestJson<string>(baseConfig(), 'sys', {});
    expect(out.data).toBe('yes');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.debug.attempts).toBe(2);
  });

  it('не повторяет при HTTP 400 — смена модели бы не помогла', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const err = await requestJson(baseConfig(), 'sys', {}).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.debug?.attempts).toBe(1);
    expect(err.status).toBe(400);
  });

  it('бюджет попыток: 2 запроса, других моделей в цепочке нет', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const err = await requestJson(baseConfig(), 'sys', {}).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err.debug?.attempts).toBe(2);
    // Меняться нечему: все попытки уходят в одну и ту же модель
    const models = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(models.every((m) => m.model === 'm')).toBe(true);
  });

  it('бросает ошибку на невалидный JSON в ответе модели', async () => {
    // mockImplementation, а не mockResolvedValue: Response одноразовый,
    // повторная попытка должна получить «свежий» ответ, как от реального сервера.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(chatOk('not json'))));

    await expect(requestJson(baseConfig(), 'sys', {})).rejects.toThrow(/JSON/);
  });

  it('пустой ответ модели считается ошибкой', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(chatOk(''))));

    await expect(requestJson(baseConfig(), 'sys', {})).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });

  it('локальная модель: Bearer ollama, reasoning_effort и адрес из конфига', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatOk('{"ok":1}'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await requestJson(baseConfig({ model: 'qwen2.5:7b' }), 'sys', {});
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(sent.headers.Authorization).toBe('Bearer ollama');
    // reasoning_effort выключает разум у локальных reasoning-моделей, иначе
    // пайплайн обрывается пустым ответом по таймауту
    expect(sent.body.reasoning_effort).toBe('none');
    expect(sent.body.model).toBe('qwen2.5:7b');
    expect(out.debug.provider).toBe('ollama');
    expect(out.debug.effectiveModel).toBe('qwen2.5:7b');
  });
});

/* ---------------------- Удалённый провайдер (OpenRouter) -------------------- */

describe('requestJson: удалённый провайдер', () => {
  it('ключ уходит в Authorization, а не в Bearer ollama', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatOk('{"ok":1}'));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson(remoteConfig(), 'sys', {});
    const sent = sentRequest(fetchMock);
    expect(sent.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(sent.headers.Authorization).not.toBe('Bearer ollama');
  });

  it('адрес назначения берётся из openrouter.ts, а не из профиля', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatOk('{"ok":1}'));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson(remoteConfig(), 'sys', {});
    expect(sentRequest(fetchMock).url).toBe(OPENROUTER_CHAT_COMPLETIONS_URL);
  });

  it('HTTP-Referer и X-OpenRouter-Title зафиксированы литералами', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatOk('{"ok":1}'));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson(remoteConfig(), 'sys', {});
    const { headers } = sentRequest(fetchMock);
    expect(headers['HTTP-Referer']).toBe('https://recon.local');
    expect(headers['X-OpenRouter-Title']).toBe('Reconciliation AI');
    // Внутреннее имя хоста наружу не публикуется
    expect(headers['HTTP-Referer']).not.toContain('127.0.0.1');
  });

  it('в теле удалённого запроса нет reasoning_effort', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatOk('{"ok":1}'));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson(remoteConfig(), 'sys', {});
    const sent = sentRequest(fetchMock);
    expect('reasoning_effort' in sent.body).toBe(false);
    expect(sent.body.model).toBe('vendor/model:free');
  });

  it('debug.effectiveModel — модель из ответа, а не запрошенная', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        rawBody(
          {
            choices: [{ message: { content: '{"ok":1}' } }],
            model: 'vendor/other-model',
            usage: { total_tokens: 42 },
          },
          200,
        ),
      ),
    );

    const out = await requestJson<{ ok: number }>(
      remoteConfig({ model: 'vendor/model:free' }),
      'sys',
      {},
    );
    expect(out.data).toEqual({ ok: 1 });
    expect(out.debug.model).toBe('vendor/model:free');
    expect(out.debug.effectiveModel).toBe('vendor/other-model');
    expect(out.debug.provider).toBe('openrouter');
  });

  it('без model в ответе effectiveModel равен запрошенному', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chatOk('{"ok":1}')));

    const out = await requestJson(remoteConfig(), 'sys', {});
    expect(out.debug.effectiveModel).toBe('vendor/model:free');
  });

  it('ключ не попадает ни в лог, ни в текст ошибки, ни в debug', async () => {
    // Плюс верхний регистр: первый слой снимает ключ дословно, второй — по форме,
    // и для формы регистр не должен иметь значения, иначе `SK-OR-V1-…` уехал бы
    // в `debug.errorMessage`, а оттуда в «Логику AI»
    const shouted = SECRET.toUpperCase();
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')));
    // Провайдер цитирует заголовок Authorization в своём тексте ошибки
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody(
            {
              error: {
                message: `Invalid key: ${SECRET} (Bearer ${SECRET}) и ${shouted}`,
                metadata: { error_type: 'authentication_error' },
              },
            },
            401,
          ),
        ),
      ),
    );

    const err = await requestJson(remoteConfig(), 'sys', {}).catch((e) => e);
    spy.mockRestore();

    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(logs.join('\n')).not.toContain(SECRET);
    expect(JSON.stringify(err.detail)).not.toContain(SECRET);
    expect(JSON.stringify(err.message)).not.toContain(SECRET);
    expect(JSON.stringify(err.debug)).not.toContain(SECRET);
    // Повтор для верхнего регистра, а не «второй слой не сработал»: обе строки
    // обязаны быть чистыми одновременно
    expect(logs.join('\n')).not.toContain(shouted);
    expect(JSON.stringify(err.detail)).not.toContain(shouted);
    expect(JSON.stringify(err.message)).not.toContain(shouted);
    expect(JSON.stringify(err.debug)).not.toContain(shouted);
  });

  it('ключ, процитированный в произвольном регистре, — тоже не утекает', async () => {
    // Реалистичная форма — не «всё капсом», а случайный регистр внутри ключа
    const mangled = 'Sk-Or-V1-TeStKeY-0123456789';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody(
            { error: { message: `key ${mangled}`, metadata: { error_type: 'authentication_error' } } },
            401,
          ),
        ),
      ),
    );

    const err = await requestJson(remoteConfig(), 'sys', {}).catch((e) => e);

    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(JSON.stringify(err.detail)).not.toContain(mangled);
    expect(JSON.stringify(err.message)).not.toContain(mangled);
    expect(JSON.stringify(err.debug)).not.toContain(mangled);
  });
});

/* -------------------- Ошибки, которые не лечатся повтором -------------------- */

describe('requestJson: терминальные ошибки', () => {
  it('200 с error — ошибка провайдера, а не «невалидный JSON», и без второго запроса', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody(
          { error: { message: 'This model requires more credits', metadata: { error_type: 'payment_required' } } },
          200,
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await requestJson(remoteConfig(), 'sys', {}).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.message).toContain('OpenRouter');
    expect(err.message).not.toMatch(/валидным JSON/);
    expect(err.terminal).toBe(true);
    expect(err.errorType).toBe('payment_required');
    // Причина провайдера не теряется за общим текстом про JSON
    expect(err.debug?.errorMessage).toContain('requires more credits');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('200 с choices[0].error — то же самое', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody(
          {
            choices: [
              { error: { message: 'upstream refused', metadata: { error_type: 'model_not_found' } } },
            ],
          },
          200,
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await requestJson(remoteConfig(), 'sys', {}).catch((e) => e);
    expect(err.message).toContain('OpenRouter');
    expect(err.terminal).toBe(true);
    expect(err.debug?.errorMessage).toContain('upstream refused');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('finish_reason=error без error — тоже терминальная', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(rawBody({ choices: [{ message: { content: null }, finish_reason: 'error' }] }, 200)),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await requestJson(remoteConfig(), 'sys', {}).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.terminal).toBe(true);
    expect(err.message).not.toMatch(/валидным JSON|Пустой ответ/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('локальная модель: тот же 200 с ошибкой — повтор остаётся, как до шлюза', async () => {
    // Гейт «внутри 200 спрятана ошибка» платный только для шлюза: на локальной
    // модели он забирал бесплатный повтор, который до появления шлюза штатно
    // закрывал разовый сбой.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody({ error: { message: 'upstream refused', metadata: { error_type: 'model_not_found' } } }, 200),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await requestJson(baseConfig(), 'sys', {}).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.message).toBe('Пустой ответ модели');
    expect(err.errorType).toBeUndefined();
    expect(err.terminal).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('402 с payment_required — терминальная, 429 — нет', async () => {
    const payment = vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody({ error: { message: 'no credits', metadata: { error_type: 'payment_required' } } }, 402),
      ),
    );
    vi.stubGlobal('fetch', payment);
    const paid = await requestJson(remoteConfig(), 'sys', {}).catch((e) => e);
    expect(paid.terminal).toBe(true);
    expect(payment).toHaveBeenCalledTimes(1);

    const limited = vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody({ error: { message: 'slow down', metadata: { error_type: 'rate_limit_exceeded' } } }, 429),
      ),
    );
    vi.stubGlobal('fetch', limited);
    const throttled = await requestJson(remoteConfig(), 'sys', {}).catch((e) => e);
    expect(throttled).toBeInstanceOf(AiUnavailableError);
    expect(throttled.terminal).toBe(false);
  });

  it('локальная сеть: две попытки, терминальной ошибки нет', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const err = await requestJson(baseConfig(), 'sys', {}).catch((e) => e);
    expect(err.terminal).toBe(false);
    expect(err.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* --------------------- Пустой «успешный» ответ шлюза ---------------------- */

/**
 * `200` с пустым телом — настоящий ответ OpenRouter (`choices: []` либо
 * `message.content: null`), а не сбой сети: запрос принят и посчитан, поэтому
 * вторая попытка стоит денег и не принесёт содержания.
 *
 * Гейт по провайдеру здесь обязателен. Локальный повтор бесплатен и закрывает
 * разовый сбой Ollama, поэтому её пустой ответ деградирует ровно как прежде.
 */
describe('requestJson: пустой ответ модели', () => {
  const emptyResponses: Array<[string, unknown]> = [
    ['choices: []', { choices: [] }],
    ['content: null', { choices: [{ message: { content: null } }] }],
  ];

  for (const [name, body] of emptyResponses) {
    it(`удалённый провайдер: ${name} — один запрос, повтор не тратит кредит`, async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(rawBody(body, 200)));
      vi.stubGlobal('fetch', fetchMock);

      const err = await requestJson(remoteConfig(), 'sys', {}).catch((e) => e);
      expect(err).toBeInstanceOf(AiUnavailableError);
      expect(err.message).toContain('Пустой ответ модели');
      expect(err.terminal).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  it('локальная модель: тот же пустой ответ по-прежнему повторяется один раз', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(rawBody({ choices: [{ message: { content: null } }] }, 200)),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await requestJson(baseConfig(), 'sys', {}).catch((e) => e);
    expect(err.terminal).toBe(false);
    expect(err.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* ----------------------- Расход токенов в диагностике --------------------- */

describe('requestJson: usage.total_tokens', () => {
  it('попадает в диагностику — это и есть ответ на «сколько стоил запуск»', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody({ choices: [{ message: { content: '{"ok":1}' } }], usage: { total_tokens: 1234 } }, 200),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { debug } = await requestJson<{ ok: number }>(remoteConfig(), 'sys', {});
    expect(debug.totalTokens).toBe(1234);
  });

  it('ответ без usage даёт null, а не 0: «не сообщил» и «ноль» — разное', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(rawBody({ choices: [{ message: { content: '{"ok":1}' } }] }, 200))));

    const { debug } = await requestJson<{ ok: number }>(remoteConfig(), 'sys', {});
    expect(debug.totalTokens).toBeNull();
  });

  it('локальная модель: usage приходит из того же OpenAI-совместимого ответа', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody({ choices: [{ message: { content: '{"ok":1}' } }], usage: { total_tokens: 77 } }, 200),
        ),
      ),
    );

    const { debug } = await requestJson<{ ok: number }>(baseConfig(), 'sys', {});
    expect(debug.totalTokens).toBe(77);
  });
});

/* ---------------------------- Структура таблицы --------------------------- */

const SAMPLE_GRID: Grid = [
  ['АКТ СВЕРКИ', null, null, null],
  ['№', 'Дата', 'Сумма', 'Назначение'],
  ['1', '05.03.2026', '1000.00', 'Оплата'],
  ['2', '06.03.2026', '2000.00', 'Отгрузка'],
];

describe('assistStructure', () => {
  it('Ollama недоступен — деградация к эвристике', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const { mapping, aiUsed, terminalError } = await assistStructure(SAMPLE_GRID, baseConfig());
    expect(aiUsed).toBe(false);
    expect(mapping.source).toBe('heuristic');
    expect(mapping.reasoning.some((r) => r.includes('Сервис AI недоступен'))).toBe(true);
    // Локальная модель не заполняет канал терминальной ошибки: пайплайн деградирует
    expect(terminalError).toBeUndefined();
    // Эвристика всё равно нашла шапку и основные колонки
    expect(mapping.columns.docNumber).toBe(0);
    expect(mapping.columns.docDate).toBe(1);
    expect(mapping.columns.amount).toBe(2);
  });

  it('сливает ответ модели с эвристикой (source=ai+heuristic)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chatOk({
          headerRowIndex: 1,
          dataStartRowIndex: 2,
          columns: { docNumber: 0, docDate: 1, amount: 2, debit: null, credit: null },
          confidence: 0.93,
          reasoning: ['Шапка во второй строке, колонки соответствуют словарю.'],
        }),
      ),
    );

    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID, baseConfig());
    expect(aiUsed).toBe(true);
    expect(mapping.source).toBe('ai+heuristic');
    expect(mapping.confidence).toBeGreaterThanOrEqual(0.9);
    expect(mapping.reasoning.some((r) => r.startsWith('AI:'))).toBe(true);
    expect(mapping.dataStartRowIndex).toBe(2);
  });

  it('некорректный ответ модели → эвристика с пометкой деградации', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chatOk({ columns: { docNumber: -5 } })));

    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID, baseConfig());
    expect(aiUsed).toBe(true);
    expect(mapping.source).toBe('heuristic');
    expect(mapping.reasoning.some((r) => r.includes('некорректную структуру'))).toBe(true);
  });
});

/* ------------- Какая модель обслужила стадию определения структуры ------------- */

describe('assistStructure: конфигурация провайдера', () => {
  const validStructure = {
    headerRowIndex: 1,
    dataStartRowIndex: 2,
    columns: { docNumber: 0, docDate: 1, amount: 2, debit: null, credit: null },
    confidence: 0.93,
    reasoning: ['Шапка во второй строке.'],
  };

  it('удалённый конфиг: запрос уходит в шлюз с ключом оператора, а не в Bearer ollama', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatOk(validStructure));
    vi.stubGlobal('fetch', fetchMock);

    const { aiUsed, terminalError } = await assistStructure(SAMPLE_GRID, remoteConfig());
    expect(aiUsed).toBe(true);
    expect(terminalError).toBeUndefined();

    // Признак провайдера проверяем по заголовку исходящего запроса, а не по
    // тексту ответа: иначе тест прошёл бы и на локальной модели
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(OPENROUTER_CHAT_COMPLETIONS_URL);
    expect(sent.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(sent.headers.Authorization).not.toBe('Bearer ollama');
  });

  it('локальный конфиг: адрес и Bearer ollama прежние', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatOk(validStructure));
    vi.stubGlobal('fetch', fetchMock);

    await assistStructure(SAMPLE_GRID, baseConfig());
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(sent.headers.Authorization).toBe('Bearer ollama');
  });
});

/* --------- Нелечимый отказ: удалённый падает, локальный деградирует ---------- */

describe('assistStructure: терминальная ошибка', () => {
  const unauthorized = () =>
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody(
          { error: { message: 'Invalid API key', metadata: { error_type: 'authentication_error' } } },
          401,
        ),
      ),
    );

  it('удалённый провайдер: 401 попадает в terminalError, деградация не остаётся молчаливой', async () => {
    vi.stubGlobal('fetch', unauthorized());

    const { terminalError } = await assistStructure(SAMPLE_GRID, remoteConfig());
    // `errorType` входит в объект не для красоты: именно по нему пайплайн
    // называет причину («Ключ отклонён», «нет денег», «нет модели»), а сам
    // статус 401 различить эти три случая не позволяет
    expect(terminalError).toEqual({
      status: 401,
      message: 'Invalid API key',
      errorType: 'authentication_error',
    });
  });

  it('удалённый провайдер: 200 с ошибкой без статуса — status=null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody(
            { error: { message: 'no credits', metadata: { error_type: 'payment_required' } } },
            200,
          ),
        ),
      ),
    );

    const { terminalError } = await assistStructure(SAMPLE_GRID, remoteConfig());
    // Статуса нет вовсе, поэтому единственное, что различает «нет денег» от
    // остальных нелечимых отказов, — класс ошибки от провайдера
    expect(terminalError).toEqual({
      status: null,
      message: 'no credits',
      errorType: 'payment_required',
    });
  });

  it('удалённый провайдер: таймаут/429 — не терминальная ошибка, деградация как прежде', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody(
            { error: { message: 'slow down', metadata: { error_type: 'rate_limit_exceeded' } } },
            429,
          ),
        ),
      ),
    );

    const { mapping, aiUsed, terminalError } = await assistStructure(SAMPLE_GRID, remoteConfig());
    expect(terminalError).toBeUndefined();
    expect(aiUsed).toBe(false);
    expect(mapping.source).toBe('heuristic');
    expect(mapping.reasoning.some((r) => r.includes('Сервис AI недоступен'))).toBe(true);
  });

  it('локальная модель: тот же 401 не терминальный — эвристика, поведение не меняется', async () => {
    vi.stubGlobal('fetch', unauthorized());

    const { mapping, aiUsed, terminalError } = await assistStructure(SAMPLE_GRID, baseConfig());
    expect(terminalError).toBeUndefined();
    expect(aiUsed).toBe(false);
    expect(mapping.source).toBe('heuristic');
    expect(mapping.reasoning.some((r) => r.includes('Сервис AI недоступен'))).toBe(true);
    // Локальный путь деградирует, а не падает: задание, которое раньше
    // завершалось эвристиками, должно завершаться так же
    expect(mapping.columns.amount).toBe(2);
  });

  it('ключ оператора не попадает ни в terminalError, ни в reasoning', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody(
          {
            error: {
              message: `Invalid key: ${SECRET}`,
              metadata: { error_type: 'authentication_error' },
            },
          },
          401,
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { mapping, terminalError } = await assistStructure(SAMPLE_GRID, remoteConfig());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(terminalError)).not.toContain(SECRET);
    expect(mapping.reasoning.join(' ')).not.toContain(SECRET);
  });
});

/* ---------- Что именно говорит шаг: отказ или подстановка правил ----------- */

/**
 * Живой прогон: на фиктивный ключ пришёл `403` с нечитаемым телом, и шаг
 * «Логики AI» сказал «используется эвристика» — про отказ, который сейчас
 * прервёт запуск. Обещание подстановки ложно по построению: пайплайн бросает
 * ошибку сразу после стадии, расчёта по правилам не будет.
 *
 * Тройка ниже — охрана границы: терминальный отказ называет прерывание, а обе
 * лечимые ситуации (локальная модель и 429) сохраняют прежний текст побайтно.
 */
describe('assistStructure: текст шага при отказе', () => {
  /** Ответ шлюза без читаемого тела — так пришёл живой 403 */
  const refused403 = (): Response => new Response('', { status: 403 });

  it('удалённый провайдер, нелечимый 403: шаг называет прерывание, а не подстановку', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(refused403())));

    const { mapping, terminalError } = await assistStructure(SAMPLE_GRID, remoteConfig());

    expect(terminalError?.status).toBe(403);
    const step = mapping.reasoning.find((r) => r.startsWith('⚠'));
    // Ключ, который отвергнут, больше не заработает: оператор должен читать
    // именно это, а не обещание посчитать правилами
    expect(step).toBe(
      '⚠ Отказ удалённого провайдера (HTTP 403) — запуск прерывается, эвристика не подставляется.',
    );
    expect(step).not.toContain('используется эвристика');
    // Маппинг остаётся эвристическим: он диагностический, а не результат
    expect(mapping.source).toBe('heuristic');
  });

  it('локальная модель при том же 403: текст деградации побайтно прежний', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(refused403())));

    const { mapping, terminalError } = await assistStructure(SAMPLE_GRID, baseConfig());

    expect(terminalError).toBeUndefined();
    expect(mapping.reasoning).toContain(
      '⚠ Сервис AI недоступен (HTTP 403) — используется эвристика.',
    );
  });

  it('удалённый провайдер, 429: перегрузка деградирует, текст прежний', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody(
            { error: { message: 'slow down', metadata: { error_type: 'rate_limit_exceeded' } } },
            429,
          ),
        ),
      ),
    );

    const { mapping, terminalError } = await assistStructure(SAMPLE_GRID, remoteConfig());

    // 429 повтор исправляет, поэтому это не отказ, а недоступность модели
    expect(terminalError).toBeUndefined();
    expect(mapping.reasoning).toContain(
      '⚠ Сервис AI недоступен (slow down) — используется эвристика.',
    );
  });
});

/* -------------------------- Причина отказа шлюзом ------------------------- */

/**
 * Живой 403 без тела ошибки дал «(HTTP 403): HTTP 403»: клиент подставил в
 * деталь сам статус, когда разобрать тело не удалось. Причина должна называть
 * статус один раз, а пояснение провайдера — оставаться, иначе оператор
 * потеряет единственное, что отличает один отказ от другого.
 */
describe('remoteProviderCause', () => {
  it('деталь, повторяющая статус, не печатает его второй раз', () => {
    const cause = remoteProviderCause({ status: 403, detail: 'HTTP 403' });

    expect(cause).toBe('Провайдер не разрешил запрос этому ключу (HTTP 403)');
    expect(cause.match(/403/g)).toHaveLength(1);
  });

  it('пояснение провайдера остаётся вместе со статусом', () => {
    const cause = remoteProviderCause({ status: 403, detail: 'Invalid API key' });

    expect(cause).toBe(
      'Провайдер не разрешил запрос этому ключу (HTTP 403): Invalid API key',
    );
  });
});

/* --------- Терминальная ошибка доходит до пайплайна, а не гаснет в стадии ----- */

describe('resolveStructure: распространение терминальной ошибки', () => {
  /** Задание с уже разобранным источником — стадии до structure тут не нужны */
  function jobWithGrid(): Job {
    const job = createJob(
      { ours: 'o.xlsx', partner: 'p.xlsx' },
      { ours: Buffer.alloc(0), partner: Buffer.alloc(0) },
    );
    job.sources.ours = { grid: SAMPLE_GRID, kind: 'excel', fileName: 'o.xlsx' };
    return job;
  }

  it('удалённый провайдер: 401 прерывает стадию, пайплайн увидит ошибку и поставит failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody(
            { error: { message: 'Invalid API key', metadata: { error_type: 'authentication_error' } } },
            401,
          ),
        ),
      ),
    );
    const job = jobWithGrid();

    // Стадия бросает — её ловит общий catch пайплайна, который и ставит failed.
    // Проверяем именно бросок: без него отчёт собрался бы на эвристиках и
    // выглядел бы успешным запуском на выбранной оператором модели. Причина
    // названа дословно, а не «хоть что-нибудь похожее»: оператор чинит ключ, и
    // README ссылается на эту строку.
    await expect(resolveStructure(job, 'ours', remoteConfig())).rejects.toThrow(
      'Ключ OpenRouter отклонён провайдером (HTTP 401): Invalid API key',
    );

    // Маппинг и шаг рассуждения остаются: причина видна в «Логике AI»
    expect(job.mappings.ours?.source).toBe('heuristic');
    expect(job.reasoningLog.some((s) => s.stage === 'structure')).toBe(true);
  });

  it('локальная модель: тот же 401 не прерывает стадию', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody(
            { error: { message: 'Invalid API key', metadata: { error_type: 'authentication_error' } } },
            401,
          ),
        ),
      ),
    );
    const job = jobWithGrid();

    await expect(resolveStructure(job, 'ours', baseConfig())).resolves.toBeUndefined();
    expect(job.mappings.ours?.source).toBe('heuristic');
    expect(job.error).toBeNull();
  });
});

/* -------------------------------- Гипотезы -------------------------------- */

function ctxWith(partial: Partial<HypothesisContext>): HypothesisContext {
  return {
    summary: {
      ourTotal: 0,
      partnerTotal: 0,
      matched: 0,
      onlyOurs: 0,
      onlyPartner: 0,
      amountMismatches: 0,
      dateMismatches: 0,
      balanceIssues: 0,
    },
    balanceIssues: [],
    assumptions: [],
    samples: { amountMismatches: [], onlyOurs: [], onlyPartner: [] },
    ...partial,
  };
}

describe('ruleBasedHypotheses', () => {
  it('круглая разница сумм → гипотеза о частичной оплате', () => {
    const out = ruleBasedHypotheses(
      ctxWith({
        summary: {
          ourTotal: 1,
          partnerTotal: 1,
          matched: 0,
          onlyOurs: 0,
          onlyPartner: 0,
          amountMismatches: 1,
          dateMismatches: 0,
          balanceIssues: 0,
        },
        samples: {
          amountMismatches: [
            {
              docNumber: '1',
              docDateOurs: '05.03.2026',
              docDatePartner: '05.03.2026',
              ourAmount: '1000.00',
              partnerAmount: '900.00',
              difference: '100.00',
              direction: 'they_owe',
              dateMismatch: false,
            },
          ],
          onlyOurs: [],
          onlyPartner: [],
        },
      }),
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it('совпадающие суммы и расходящиеся даты → общая гипотеза о датах', () => {
    const out = ruleBasedHypotheses(
      ctxWith({
        summary: {
          ourTotal: 1,
          partnerTotal: 1,
          matched: 0,
          onlyOurs: 0,
          onlyPartner: 0,
          amountMismatches: 0,
          dateMismatches: 1,
          balanceIssues: 0,
        },
        samples: { amountMismatches: [], onlyOurs: [], onlyPartner: [] },
      }),
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it('много документов только у нас → рекомендация передать контрагенту', () => {
    const out = ruleBasedHypotheses(
      ctxWith({
        summary: {
          ourTotal: 9,
          partnerTotal: 0,
          matched: 0,
          onlyOurs: 9,
          onlyPartner: 0,
          amountMismatches: 0,
          dateMismatches: 0,
          balanceIssues: 0,
        },
        samples: { amountMismatches: [], onlyOurs: [], onlyPartner: [] },
      }),
    );
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('aiHypotheses', () => {
  it('валидирует и нормализует ответ модели', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chatOk({
          hypotheses: [
            {
              scope: 'doc',
              docNumber: '7',
              text: 'Возможен незачтённый аванс.',
              recommendation: 'Сверить платежи.',
            },
            { scope: 'weird', text: '', recommendation: null }, // мусор — отфильтруется
          ],
        }),
      ),
    );

    const out = await aiHypotheses(baseConfig(), ctxWith({}));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(out![0]!.docNumber).toBe('7');
    expect(out![0]!.scope).toBe('doc');
  });

  it('при ошибке сети возвращает null (деградация)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const out = await aiHypotheses(baseConfig(), ctxWith({}));
    expect(out).toBeNull();
  });
});

/* --------- Отказ провайдера: гипотезы гаснут в самом конце пайплайна -------- */

describe('aiHypotheses: терминальная ошибка', () => {
  const unauthorized = () =>
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody(
          { error: { message: 'Invalid API key', metadata: { error_type: 'authentication_error' } } },
          401,
        ),
      ),
    );

  it('удалённый провайдер: 401 пробрасывается, а не превращается в null', async () => {
    const fetchMock = unauthorized();
    vi.stubGlobal('fetch', fetchMock);

    // Этот вызов — последний в пайплайне. null здесь означал бы «отчёт готов»,
    // гипотезы по правилам и полное впечатление, что модель отработала.
    await expect(aiHypotheses(remoteConfig(), ctxWith({}))).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('удалённый провайдер: 200 с ошибкой без статуса — тоже пробрасывается', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody({ error: { message: 'no credits', metadata: { error_type: 'payment_required' } } }, 200),
        ),
      ),
    );

    await expect(aiHypotheses(remoteConfig(), ctxWith({}))).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });

  it('удалённый провайдер: таймаут/429 → null, деградация как прежде', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody({ error: { message: 'slow down', metadata: { error_type: 'rate_limit_exceeded' } } }, 429),
        ),
      ),
    );

    expect(await aiHypotheses(remoteConfig(), ctxWith({}))).toBeNull();
  });

  it('локальная модель: тот же 401 → null, поведение не меняется', async () => {
    vi.stubGlobal('fetch', unauthorized());

    expect(await aiHypotheses(baseConfig(), ctxWith({}))).toBeNull();
  });

  it('в пробрасываемой ошибке нет ключа оператора', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody(
            {
              error: {
                message: `Invalid key: ${SECRET}`,
                metadata: { error_type: 'authentication_error' },
              },
            },
            401,
          ),
        ),
      ),
    );

    const err = await aiHypotheses(remoteConfig(), ctxWith({})).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(JSON.stringify(err.message)).not.toContain(SECRET);
    expect(JSON.stringify(err.detail)).not.toContain(SECRET);
  });
});

/* --------------------- Быстрый режим: fullReconciliation ------------------- */

/** Минимальный распознанный документ для сравнения в быстром режиме */
function documentOf(amount: number): DocumentData {
  return {
    totalRows: 1,
    openingBalance: 0,
    closingBalance: amount,
    turnoverDebit: amount,
    turnoverCredit: null,
    contracts: [
      {
        name: 'Договор №1',
        openingBalance: 0,
        closingBalance: amount,
        turnoverDebit: amount,
        turnoverCredit: null,
        transactions: [{ date: '05.03.2026', document: '101', debit: amount, credit: null }],
      },
    ],
  };
}

describe('fullReconciliation: терминальная ошибка', () => {
  const unauthorized = () =>
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        rawBody(
          { error: { message: 'Invalid API key', metadata: { error_type: 'authentication_error' } } },
          401,
        ),
      ),
    );

  it('удалённый провайдер: 401 пробрасывается вместо «AI-анализ недоступен»', async () => {
    const fetchMock = unauthorized();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fullReconciliation(documentOf(1000), documentOf(900), remoteConfig()),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('удалённый провайдер: 429 → деградация, «AI-анализ недоступен»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          rawBody({ error: { message: 'slow down', metadata: { error_type: 'rate_limit_exceeded' } } }, 429),
        ),
      ),
    );

    const { result } = await fullReconciliation(documentOf(1000), documentOf(900), remoteConfig());
    expect(result.aiAnalysis).toBe('AI-анализ недоступен.');
  });

  it('локальная модель: тот же 401 деградирует, отчёт остаётся', async () => {
    vi.stubGlobal('fetch', unauthorized());

    const { result } = await fullReconciliation(documentOf(1000), documentOf(900), baseConfig());
    expect(result.aiAnalysis).toBe('AI-анализ недоступен.');
  });
});
