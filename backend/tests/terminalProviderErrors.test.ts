/**
 * Решение D4 целиком, на уровне задания: отказ провайдера, который повтор не
 * исправит, обязан уронить задание с названной причиной, а локальная модель
 * при том же отказе — продолжить и выдать отчёт по эвристикам.
 *
 * Здесь важна не столько проверка отдельных функций (они проверяются в
 * `ai.test.ts` и `structuredParse.test.ts`), сколько пара «тот же 401 в обоих
 * провайдерах» и количество ушедших запросов. Отвергнутый ключ на удалённом
 * профиле раньше давал «успешный» отчёт, посчитанный правилами, — документ
 * уходил третьей стороне, а платил за него оператор, и никакого сигнала не
 * оставалось. Ключ оператора не должен появляться ни в статусе задания, ни в
 * шагах «Логики AI», ни в отчёте.
 *
 * Сеть не используется: `fetch` подменяется заглушкой, чужой адрес назначения
 * переопределяется сервером, поэтому тесты не ходят никуда.
 */

import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Settings } from '../src/settings.js';
import { createJob, toStatus } from '../src/jobs/store.js';
import type { JobAiProfile } from '../src/jobs/store.js';
import { runPipeline } from '../src/jobs/pipeline.js';
import { aiConfigFromSettings, aiConfigFromRemoteProfile } from '../src/services/ai/client.js';
import type { AiConfig } from '../src/services/ai/client.js';

const settings: Settings = {
  appHost: '127.0.0.1',
  appPort: 8080,
  apiBaseUrl: '',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b-instruct',
  aiTimeoutSec: 30,
  logLevel: 'info',
  logFile: '',
  openBrowser: false,
};

const REMOTE_MODEL = 'vendor/model-a:free';
const API_KEY = 'sk-or-v1-CANARY-0123456789abcdef';

/**
 * Причина отказа, которую оператор читает в статусе задания, в отчёте и в
 * README. Строка названа один раз и на все три точки входа с AI-вызовом:
 * расхождение формулировок означало бы, что документация не может сослаться
 * ни на одну из них.
 */
const REJECTED_KEY_CAUSE = 'Ключ OpenRouter отклонён провайдером (HTTP 401): Invalid API key';

/** Ответ модели с корректной структурой таблицы — стадия structure проходит */
function chatOk(content: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const VALID_STRUCTURE = {
  headerRowIndex: 2,
  dataStartRowIndex: 3,
  columns: { docNumber: 0, docDate: 1, amount: 2, debit: null, credit: null },
  confidence: 0.95,
  reasoning: ['Шапка в третьей строке, колонки соответствуют словарю.'],
};

const VALID_HYPOTHESES = {
  hypotheses: [{ scope: 'general', docNumber: null, text: 'Проверить зачёт.', recommendation: null }],
};

/**
 * Отказ шлюза: `401` с классом ошибки от провайдера. Именно такой ответ модель
 * не может ни повторить, ни обойти эвристикой.
 */
function rejectedByGateway(): Response {
  return new Response(
    JSON.stringify({
      error: { message: 'Invalid API key', metadata: { error_type: 'authentication_error' } },
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

/**
 * Заглушка, которая отвечает отказом только на запрос гипотез, а на запрос
 * структуры отвечает корректным JSON. Так пайплайн доходит до последнего
 * AI-вызова — именно на нём отказ раньше оставался незамеченным.
 */
function stubGatewayRefusesHypotheses(): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0]?.content ?? '';
    return system.includes('бухгалтер-аналитик') ? rejectedByGateway() : chatOk(VALID_STRUCTURE);
  });
}

/** Заглушка, которая отвечает отказом на любой AI-вызов */
function stubGatewayRefusesEverything(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => rejectedByGateway());
}

function remoteConfig(): AiConfig {
  return aiConfigFromRemoteProfile({
    provider: 'openrouter',
    baseUrl: settings.ollamaBaseUrl,
    model: REMOTE_MODEL,
    apiKey: API_KEY,
    timeoutMs: settings.aiTimeoutSec * 1000,
  });
}

/** xlsx-буфер пары, которую эвристика разбирает уверенно, без подтверждения */
function xlsxBuffer(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Акт сверки за март 2026'],
    [],
    ['№', 'Дата', 'Сумма', 'Назначение'],
    ['101', '05.03.2026', '15000,00', 'Оплата'],
    ['102', '06.03.2026', '4200,50', 'Отгрузка'],
  ] as unknown[][]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function newJob(aiProfile: JobAiProfile | null = null): ReturnType<typeof createJob> {
  return createJob(
    { ours: 'ours.xlsx', partner: 'partner.xlsx' },
    { ours: xlsxBuffer(), partner: xlsxBuffer() },
    false,
    aiProfile,
  );
}

/** Профиль, который `routes/jobs.ts` кладёт в задание из запроса браузера */
function remoteProfile(): JobAiProfile {
  return { provider: 'openrouter', model: REMOTE_MODEL };
}

/** Модель отвечает корректно везде, кроме гипотез — пайплайн доходит до отчёта */
function stubHypothesesSucceed(): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0]?.content ?? '';
    return system.includes('бухгалтер-аналитик')
      ? chatOk(VALID_HYPOTHESES)
      : chatOk(VALID_STRUCTURE);
  });
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------ D4: отказ удалённого провайдера ----------------- */

describe('runPipeline: отказ, который повтор не исправит', () => {
  it('удалённый провайдер: отказ на гипотезах роняет задание с названной причиной', async () => {
    const stub = stubGatewayRefusesHypotheses();
    vi.stubGlobal('fetch', stub);
    const job = newJob();

    await runPipeline(job.id, settings, remoteConfig());

    // Отчёт не собран: «успешный» документ на правилах выглядел бы так, будто
    // выбранная оператором модель отработала
    expect(job.stage).toBe('failed');
    expect(job.report).toBeNull();
    expect(job.reportReady).toBe(false);
    // Не «совпало с чем-то похожим», а ровно названная причина: README и
    // оператор ссылаются на эту строку дословно
    expect(job.error).toBe(REJECTED_KEY_CAUSE);

    // Причина названа в «Логике AI» вместе с провайдером и моделью
    const failedStep = job.reasoningLog.find((s) => s.stage === 'failed');
    expect(failedStep?.title).toContain('OpenRouter');
    expect(failedStep?.title).toContain(REMOTE_MODEL);
    expect(failedStep?.detail).toContain('Invalid API key');
  }, 30_000);

  it('удалённый провайдер: ровно один запрос на каждый AI-вызов', async () => {
    const stub = stubGatewayRefusesHypotheses();
    vi.stubGlobal('fetch', stub);
    const job = newJob();

    await runPipeline(job.id, settings, remoteConfig());

    // structure вызывается для обеих сторон, затем analysis. Отказ терминальный,
    // поэтому ни один из вызовов не повторяется — иначе оператор заплатил бы за
    // две одинаково отвергнутые попытки.
    expect(stub).toHaveBeenCalledTimes(3);
    for (const call of stub.mock.calls) {
      const init = call[1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    }
  }, 30_000);

  it('отказ на структуре останавливает задание до анализа', async () => {
    const stub = stubGatewayRefusesEverything();
    vi.stubGlobal('fetch', stub);
    const job = newJob();

    await runPipeline(job.id, settings, remoteConfig());

    expect(job.stage).toBe('failed');
    // Причина та же самая, что и на гипотезах: оператор чинит одну вещь, а не
    // разбирает, где именно отказало
    expect(job.error).toBe(REJECTED_KEY_CAUSE);
    // Стадия structure стоит первой: до гипотез пайплайн не доходит
    expect(stub).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('нет денег и нет модели называются своими причинами, а не «отклонил запрос»', async () => {
    const cases: Array<[Response, string]> = [
      [
        new Response(
          JSON.stringify({ error: { message: 'This model requires more credits', metadata: { error_type: 'payment_required' } } }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        ),
        'На счёте OpenRouter нет средств (HTTP 402): This model requires more credits',
      ],
      [
        new Response(
          JSON.stringify({ error: { message: 'No endpoints found for vendor/model-a:free', metadata: { error_type: 'model_not_found' } } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        ),
        'Модель не найдена в каталоге OpenRouter (HTTP 404): No endpoints found for vendor/model-a:free',
      ],
    ];

    for (const [response, cause] of cases) {
      const stub = vi.fn(async () => response.clone());
      vi.stubGlobal('fetch', stub);
      const job = newJob(remoteProfile());

      await runPipeline(job.id, settings, remoteConfig());

      expect(job.stage).toBe('failed');
      expect(job.error).toBe(cause);
      // Терминальный отказ — по-прежнему ровно один запрос, а не «попробуем ещё»
      expect(stub).toHaveBeenCalledTimes(1);
    }
  }, 60_000);

  it('ни статусе задания, ни в шагах, ни в отчёте нет ключа оператора', async () => {
    vi.stubGlobal('fetch', stubGatewayRefusesHypotheses());
    const job = newJob();

    await runPipeline(job.id, settings, remoteConfig());

    expect(JSON.stringify(job.reasoningLog)).not.toContain(API_KEY);
    expect(String(job.error)).not.toContain(API_KEY);
    expect(JSON.stringify(job.report)).not.toContain(API_KEY);
  }, 30_000);
});

/* ------------------- Какая модель ответила, а какая запрошена --------------- */

/**
 * `JobStatus.effectiveModel` обещает модель, которая **реально ответила**
 * (`shared/src/types.ts`), а `Job.aiProfile.model` — ту, что оператор выбрал.
 * Проецировать второе под именем первого — это подпись, которая врёт именно
 * там, где оператор ждёт правды: задание, умершее на первом же вызове.
 */
describe('runPipeline: какая модель ответила', () => {
  it('задание, упавшее на первом вызове, не называет модель вовсе', async () => {
    vi.stubGlobal('fetch', stubGatewayRefusesEverything());
    const job = newJob(remoteProfile());

    await runPipeline(job.id, settings, remoteConfig());

    expect(job.stage).toBe('failed');
    // Модель была запрошена…
    expect(job.aiProfile?.model).toBe(REMOTE_MODEL);
    // …но не ответила, и status обязан молчать, а не называть запрошенную
    expect(toStatus(job).effectiveModel).toBeNull();
  }, 30_000);

  it('после успешного ответа статус называет именно ответившую модель', async () => {
    vi.stubGlobal('fetch', stubHypothesesSucceed());
    const job = newJob();

    await runPipeline(job.id, settings, remoteConfig());

    expect(job.stage).toBe('done');
    expect(toStatus(job).effectiveModel).toBe(REMOTE_MODEL);
  }, 30_000);

  it('шлюз выполнил запрос другой моделью — называется та, что ответила', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const response = await chatOk(VALID_STRUCTURE);
        const body = (await response.json()) as Record<string, unknown>;
        return new Response(JSON.stringify({ ...body, model: 'routed/other-model:free' }), { status: 200 });
      }),
    );
    const job = newJob();

    await runPipeline(job.id, settings, remoteConfig());

    expect(toStatus(job).effectiveModel).toBe('routed/other-model:free');
  }, 30_000);

  it('при подмене модели шлюзом запрошенная и ответившая остаются разными строками', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const response = await chatOk(VALID_STRUCTURE);
        const body = (await response.json()) as Record<string, unknown>;
        return new Response(JSON.stringify({ ...body, model: 'routed/other-model:free' }), { status: 200 });
      }),
    );
    const job = newJob(remoteProfile());

    await runPipeline(job.id, settings, remoteConfig());

    const status = toStatus(job);
    expect(status.requestedModel).toBe(REMOTE_MODEL);
    expect(status.effectiveModel).toBe('routed/other-model:free');
    // Ключа в статусе нет: в `JobAiProfile` такого поля не существует,
    // а `toStatus` — белый список полей
    expect(JSON.stringify(status)).not.toContain(API_KEY);
  }, 30_000);

  it('локальный запуск: запрошенной модели нет, и это не пустая строка', () => {
    // Профиль не передан, и называть запуск именем локальной модели нельзя:
    // оператор её не выбирал.
    expect(toStatus(newJob()).requestedModel).toBeNull();
  });

  it('локальная модель: недоступна — статус молчит, ключа в нём нет', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const job = newJob();

    await runPipeline(job.id, settings);

    expect(toStatus(job).effectiveModel).toBeNull();
    expect(JSON.stringify(toStatus(job))).not.toContain(settings.ollamaModel);
  }, 30_000);
});

/* ------------- Тот же отказ на локальной модели: поведение прежнее -------- */

describe('runPipeline: локальная модель при том же отказе', () => {
  it('401 локально деградирует: задание доходит до done с отчётом', async () => {
    vi.stubGlobal('fetch', stubGatewayRefusesEverything());
    const job = newJob();

    await runPipeline(job.id, settings);

    expect(job.stage).toBe('done');
    expect(job.reportReady).toBe(true);
    expect(job.error).toBeNull();
    expect(job.report).not.toBeNull();
    // Гипотезы — из правил, и в «Логике AI» это сказано прямо
    expect(job.report!.aiLogic.at(-1)!.title).toContain('по правилам');
  }, 30_000);

  it('локальный отчёт не получает подписи о провайдере', async () => {
    vi.stubGlobal('fetch', stubGatewayRefusesEverything());
    const job = newJob();

    await runPipeline(job.id, settings);

    const report = job.report!;
    expect('model' in report).toBe(false);
    expect('provider' in report).toBe(false);
    // Название удалённого провайдера в локальном отчёте не появляется
    expect(JSON.stringify(report)).not.toContain('OpenRouter');
  }, 30_000);

  it('локальный запуск не получает шага о недоступности удалённой модели', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const job = newJob();

    await runPipeline(job.id, settings);

    // Шаг деградации гипотез добавляется только удалённому провайдеру: локальный
    // отчёт не должен упоминать шлюз, чьей модели в этом запуске не было
    const remote = job.report!.aiLogic.filter((s) => s.title.includes('OpenRouter'));
    expect(remote).toHaveLength(0);
  }, 30_000);
});

/* ------------------- Подпись о провайдере в успешном отчёте ---------------- */

describe('runPipeline: отчёт называет удалённую модель', () => {
  it('удалённый запуск: в отчёте есть model и provider', async () => {
    vi.stubGlobal('fetch', stubHypothesesSucceed());
    const job = newJob();

    await runPipeline(job.id, settings, remoteConfig());

    expect(job.stage).toBe('done');
    expect(job.report!.provider).toBe('openrouter');
    expect(job.report!.model).toBe(REMOTE_MODEL);
    // Гипотезы от модели, а не по правилам — подпись о модели не вводит в заблуждение
    expect(job.report!.aiLogic.at(-1)!.title).toContain('Модель предложила гипотезы');
  }, 30_000);

  it('удалённый запуск с деградацией: подпись есть, но видно, что считало правило', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const job = newJob();

    await runPipeline(job.id, settings, remoteConfig());

    expect(job.stage).toBe('done');
    expect(job.report!.provider).toBe('openrouter');
    // Шаг деградации назван прямо и указывает, какая модель не ответила
    const degraded = job.report!.aiLogic.filter((s) => s.title.includes(REMOTE_MODEL));
    expect(degraded).toHaveLength(1);
    expect(degraded[0]!.title).toContain('OpenRouter');
  }, 30_000);
});
