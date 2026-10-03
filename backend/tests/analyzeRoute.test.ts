/**
 * `/api/test/analyze` — одна из трёх точек входа с AI-вызовом, и единственная,
 * где отказ удалённого шлюза до сих пор не получал названной причины: текст
 * собирался из `err.message`/`err.detail`, а оттуда слово «OpenRouter» не
 * появлялось никогда. Проверяется чистая функция `analyzeFailure`
 * (`src/routes/analyze.ts`) — хендлер лежит в `index.ts`, а тот запускает сервер
 * при импорте (GAP-27).
 *
 * Ошибка не подставляется: `testAnalyze` действительно зовёт шлюз и падает с
 * настоящим `AiUnavailableError`. Иначе тест проверял бы не формулировку, а
 * соглашение об аргументах.
 *
 * Формулировка обязана совпадать с той, что у `/api/jobs` и `/api/compare`: одна
 * строка на три маршрута, иначе README не сможет сослаться ни на одну из них.
 * Локальная модель при этом не меняется побайтно — у неё собственный текст.
 *
 * Сеть не используется: `fetch` подменяется заглушкой, адрес шлюза не трогается.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Grid } from '@recon/shared';

import { analyzeFailure } from '../src/routes/analyze.js';
import { aiConfigFromRemoteProfile, aiConfigFromSettings, type AiConfig } from '../src/services/ai/client.js';
import { testAnalyze } from '../src/services/ai/testAnalyze.js';

const REMOTE_MODEL = 'vendor/model-a:free';
const API_KEY = 'sk-or-v1-CANARY-0123456789abcdef';

function remoteConfig(): AiConfig {
  return aiConfigFromRemoteProfile({
    provider: 'openrouter',
    baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    model: REMOTE_MODEL,
    apiKey: API_KEY,
    timeoutMs: 30_000,
  });
}

function localConfig(): AiConfig {
  return aiConfigFromSettings({
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen2.5:7b-instruct',
    aiTimeoutSec: 30,
  });
}

function remoteRefusal(status: number, message: string, errorType: string): Response {
  return new Response(JSON.stringify({ error: { message, metadata: { error_type: errorType } } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Ответ локальной модели с той же ошибкой внутри 200 */
function errorInSuccessResponse(): Response {
  return new Response(
    JSON.stringify({ error: { message: 'upstream refused', metadata: { error_type: 'model_not_found' } } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Минимальная сетка: разбор уходит модели, дальше всё зависит от её ответа */
const GRID: Grid = [
  ['Акт сверки за март 2026'],
  ['Дата', 'Сумма'],
  ['05.03.2026', '15000,00'],
];

/** Настоящая ошибка маршрута: тот же путь, что в хендлере, до `analyzeFailure` */
async function failureOf(config: AiConfig): Promise<ReturnType<typeof analyzeFailure>> {
  const err = await testAnalyze(GRID, config).then(
    () => {
      throw new Error('ожидался отказ модели, а пришёл разбор');
    },
    (e: unknown) => e,
  );
  return analyzeFailure(config, err);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('analyzeFailure: отказ удалённого шлюза', () => {
  it('402 — названная причина, а не текст провайдера', async () => {
    const stub = vi.fn(async () =>
      remoteRefusal(402, 'This model requires more credits', 'payment_required'),
    );
    vi.stubGlobal('fetch', stub);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const failure = await failureOf(remoteConfig());

    expect(failure.statusCode).toBe(502);
    expect(failure.body.error).toBe(
      'На счёте OpenRouter нет средств (HTTP 402): This model requires more credits',
    );
    // Второй запрос стоил бы денег за тот же отказ
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('401 — тем же словарём, что и на двух других маршрутах', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => remoteRefusal(401, 'Invalid API key', 'authentication_error')));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const failure = await failureOf(remoteConfig());

    expect(failure.body.error).toBe('Ключ OpenRouter отклонён провайдером (HTTP 401): Invalid API key');
  });

  it('отказ без HTTP-статуса (ошибка внутри 200) — тоже названная причина', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorInSuccessResponse()));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const failure = await failureOf(remoteConfig());

    expect(failure.body.error).toBe(
      'Модель не найдена в каталоге OpenRouter: upstream refused',
    );
  });

  it('ключа оператора в теле отказа нет', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => remoteRefusal(402, `no credits for ${API_KEY}`, 'payment_required')));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const failure = await failureOf(remoteConfig());

    expect(JSON.stringify(failure.body)).not.toContain(API_KEY);
  });
});

describe('analyzeFailure: локальная модель и повторяемые отказы', () => {
  it('локальная модель: прежний текст побайтно, без упоминания шлюза', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => remoteRefusal(402, 'This model requires more credits', 'payment_required')));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const failure = await failureOf(localConfig());

    expect(failure.statusCode).toBe(502);
    expect(failure.body.error).toBe(
      'AI-анализ не удался: Модель qwen2.5:7b-instruct отклонила запрос (This model requires more credits)',
    );
  });

  it('удалённый шлюз, 429: прежний текст — запрос не отвергали', async () => {
    // 429 не terminal и не повторяется, но и не отказ: «OpenRouter отклонил запрос»
    // здесь было бы неправдой — формулировка только для нелечимых отказов.
    vi.stubGlobal('fetch', vi.fn(async () => remoteRefusal(429, 'slow down', 'rate_limit_exceeded')));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const failure = await failureOf(remoteConfig());

    expect(failure.body.error).toBe(
      'AI-анализ не удался: Ошибка запроса к модели vendor/model-a:free (slow down)',
    );
  });

  it('ошибка без полей detail и debug не ломает ответ', async () => {
    const failure = analyzeFailure(localConfig(), new Error('сбой без полей'));

    expect(failure.statusCode).toBe(502);
    expect(failure.body.error).toBe('AI-анализ не удался: сбой без полей');
    expect(failure.body.debug).toBeUndefined();
  });
});