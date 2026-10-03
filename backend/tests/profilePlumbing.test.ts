/**
 * Профиль модели, присланный браузером, должен доходить до каждого
 * AI-вызова в каждом режиме. Проверяется это по заголовку `Authorization`
 * заглушки `fetch`, а не по тексту ответа: ключ виден только в проводе, и
 * именно там ошибка «профиль прочитали, но отправили на локальную модель»
 * выдаёт себя.
 *
 * `index.ts` вызывает `await app.listen()` на уровне модуля и открывает браузер,
 * поэтому HTTP-тест для `/api/test/analyze` и `/api/compare` невозможен в
 * принципе. Проверяемая часть вынесена в чистую функцию
 * `resolveRequestAiConfig` — её и проверяем, а на передачу конфига в
 * `testAnalyze`/`fullReconciliation` в `index.ts` стоит страховка в конце файла.
 */

import { readFileSync } from 'node:fs';

import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobStatus } from '@recon/shared';

import type { Settings } from '../src/settings.js';
import { registerJobRoutes, resolveRequestAiConfig } from '../src/routes/jobs.js';
import { runPipeline } from '../src/jobs/pipeline.js';
import { createJob } from '../src/jobs/store.js';
import { aiConfigFromSettings, requestJson } from '../src/services/ai/client.js';
import type { AiConfig } from '../src/services/ai/client.js';
import { fullReconciliation } from '../src/services/ai/reconciliation.js';
import { OPENROUTER_CHAT_COMPLETIONS_URL } from '../src/services/ai/openrouter.js';
import type { DocumentData } from '../src/services/ai/testAnalyze.js';

/* ------------------------------ Окружение -------------------------------- */

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
const API_KEY = 'sk-or-v1-ZZCANARY-ZZ-0123456789abcdef-ZZ';
const OLLAMA_URL = 'http://127.0.0.1:11434';

type FetchStub = ReturnType<typeof vi.mocked<typeof fetch>>;

/**
 * Заглушка сети, которая всегда отказывает: модель недоступна, пайплайн
 * деградирует к эвристикам и доходит до конца, а мы видим все исходящие
 * запросы и заголовок каждого из них.
 */
function stubNetworkDown(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down');
    }),
  );
}

/** Заголовки каждого исходящего запроса */
function headersOf(stub: FetchStub): Record<string, string>[] {
  return stub.mock.calls.map((call) => (call[1]?.headers ?? {}) as Record<string, string>);
}

/** Адреса, куда ушли запросы */
function urlsOf(stub: FetchStub): string[] {
  return stub.mock.calls.map((call) => String(call[0]));
}

/** Пайплайн и клиент модели печатают в консоль — на успех теста это не влияет */
function withSilencedConsole<T>(run: () => Promise<T>): Promise<T> {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return run();
}

/** Ответ модели с валидным JSON-полезным содержимым */
function chatOk(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Конфиг удалённого провайдера, полученный из профиля запроса */
function remoteConfig(): AiConfig {
  const resolution = resolveRequestAiConfig({ aiModel: REMOTE_MODEL, aiApiKey: API_KEY }, settings);
  if (!resolution.ok) throw new Error(resolution.message);
  return resolution.config;
}

/** Минимальный распознанный документ для сравнения */
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

beforeEach(() => {
  stubNetworkDown();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------- Разбор профиля запроса ------------------------ */

describe('resolveRequestAiConfig', () => {
  it('без полей профиля — конфиг локальной модели ровно как из settings.txt', () => {
    expect(resolveRequestAiConfig({}, settings)).toEqual({
      ok: true,
      config: aiConfigFromSettings(settings),
    });
  });

  it('multipart-поля превращаются в конфиг OpenRouter с адресом сервера', () => {
    expect(resolveRequestAiConfig({ aiModel: REMOTE_MODEL, aiApiKey: API_KEY }, settings)).toEqual({
      ok: true,
      config: {
        provider: 'openrouter',
        baseUrl: OPENROUTER_CHAT_COMPLETIONS_URL,
        model: REMOTE_MODEL,
        apiKey: API_KEY,
        timeoutMs: settings.aiTimeoutSec * 1000,
      },
    });
  });

  it('пустая модель — названная причина, а не возврат к локальной модели', () => {
    expect(resolveRequestAiConfig({ aiModel: '   ', aiApiKey: API_KEY }, settings)).toEqual({
      ok: false,
      reason: 'model-empty',
      message: 'Укажите модель — её идентификатор из каталога OpenRouter.',
    });
  });

  it('половина профиля — ошибка: model-missing и key-missing, а не «профиля нет»', () => {
    expect(resolveRequestAiConfig({ aiApiKey: API_KEY }, settings)).toMatchObject({
      ok: false,
      reason: 'model-missing',
    });
    expect(resolveRequestAiConfig({ aiModel: REMOTE_MODEL }, settings)).toMatchObject({
      ok: false,
      reason: 'key-missing',
    });
  });

  it('не-строка вместо модели или ключа отклоняется, а не проходит как профиль', () => {
    expect(resolveRequestAiConfig({ aiModel: 42, aiApiKey: API_KEY }, settings)).toMatchObject({
      ok: false,
      reason: 'model-missing',
    });
    expect(resolveRequestAiConfig({ aiModel: REMOTE_MODEL, aiApiKey: ['k'] }, settings)).toMatchObject({
      ok: false,
      reason: 'key-missing',
    });
  });
});

/* --------------------- Быстрый режим: конфиг до провода -------------------- */

/**
 * Повторяется ровно то, что делает маршрут: разбор полей запроса и передача
 * полученного конфига в AI-клиент. Проверяется заголовок `Authorization` —
 * единственное место, где видны провайдер и ключ.
 */
describe('быстрый режим: профиль запроса доходит до модели', () => {
  it('POST /api/test/analyze и POST /api/compare уходят с Bearer <key>', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatOk({ ok: true })));
    const stub = vi.mocked(fetch);

    await requestJson(remoteConfig(), 'система', { payload: 1 });

    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENROUTER_CHAT_COMPLETIONS_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(init.body as string)).not.toHaveProperty('reasoning_effort');
  });

  it('fullReconciliation уходит в шлюз с профилем запроса, а не на локальную модель', async () => {
    const stub = vi.mocked(fetch);

    const { result } = await withSilencedConsole(() =>
      fullReconciliation(documentOf(1000), documentOf(900), remoteConfig()),
    );

    expect(stub.mock.calls.length).toBeGreaterThan(0);
    for (const headers of headersOf(stub)) {
      expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    }
    expect(urlsOf(stub).every((url) => url === OPENROUTER_CHAT_COMPLETIONS_URL)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(settings.ollamaModel);
  });
});

/* -------------------------- POST /api/jobs: HTTP -------------------------- */

const BOUNDARY = '----reconProfileTestBoundary';

type Part =
  | { kind: 'file'; name: string; filename: string; buffer: Buffer }
  | { kind: 'field'; name: string; value: string };

interface InjectResponse {
  statusCode: number;
  json<T>(): T;
}

/** Тело multipart-запроса: файлы и текстовые поля в одном запросе */
function multipartBody(parts: Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      part.kind === 'file'
        ? `form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: application/octet-stream`
        : `form-data; name="${part.name}"`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n\r\n`, 'utf8'));
    chunks.push(part.kind === 'file' ? part.buffer : Buffer.from(part.value, 'utf8'));
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
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

/** Приложение с настоящими маршрутами пайплайна */
async function jobsApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { files: 2 } });
  await registerJobRoutes(app, settings);
  return app;
}

/** Задание из пары файлов с указанными полями профиля */
function postJobs(app: FastifyInstance, fields: Part[]): Promise<InjectResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/jobs',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipartBody([
      { kind: 'file', name: 'ours', filename: 'ours.xlsx', buffer: xlsxBuffer() },
      { kind: 'file', name: 'partner', filename: 'partner.xlsx', buffer: xlsxBuffer() },
      ...fields,
    ]),
  });
}

/** Финальная стадия задания — опрос идёт тем же маршрутом, что и у фронта */
async function waitForFinalStage(app: FastifyInstance, id: string): Promise<JobStatus> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const status = (await app.inject({ method: 'GET', url: `/api/jobs/${id}` })).json<JobStatus>();
    if (['done', 'failed', 'cancelled'].includes(status.stage)) return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('задание не завершилось за отведённое время');
}

describe('POST /api/jobs: профиль доходит до пайплайна', () => {
  it('удалённый профиль: все вызовы с Bearer <key>, и статус молчит, пока не ответила модель', async () => {
    const stub = vi.mocked(fetch);
    const app = await jobsApp();

    const response = await withSilencedConsole(() =>
      postJobs(app, [
        { kind: 'field', name: 'aiModel', value: REMOTE_MODEL },
        { kind: 'field', name: 'aiApiKey', value: API_KEY },
      ]),
    );

    expect(response.statusCode).toBe(202);
    const created = response.json<JobStatus>();
    // Только что создано: модель ещё ни разу не ответила, и называть запрошенную
    // значило бы подписать запуск именем, которое ничего не обработало
    expect(created.effectiveModel).toBeNull();

    const final = await waitForFinalStage(app, created.id);
    expect(final.stage).toBe('done');
    // Задание дошло до конца на правилах (сеть недоступна), поэтому ответившей
    // модели по-прежнему нет — и status обязан молчать, а не подставить
    // запрошенный идентификатор. Запрошенный при этом остаётся названным в
    // «Логике AI»: не ответила — не значит не выбрана.
    expect(final.effectiveModel).toBeNull();
    expect(final.reasoningLog.some((s) => s.title.includes(REMOTE_MODEL))).toBe(true);

    // Ни одного обращения к локальной модели на удалённом профиле.
    expect(stub.mock.calls.length).toBeGreaterThan(0);
    for (const headers of headersOf(stub)) {
      expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    }
    expect(urlsOf(stub).every((url) => url === OPENROUTER_CHAT_COMPLETIONS_URL)).toBe(true);
    expect(JSON.stringify(final)).not.toContain(API_KEY);

    await app.close();
  });

  it('профиль без ключа → 400 с названной причиной, и ни одного запроса наружу', async () => {
    const stub = vi.mocked(fetch);
    const app = await jobsApp();

    const response = await postJobs(app, [{ kind: 'field', name: 'aiModel', value: REMOTE_MODEL }]);

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string; reason: string }>()).toEqual({
      error: 'Не удалось прочитать API-ключ — введите его заново.',
      reason: 'key-missing',
    });
    expect(stub).not.toHaveBeenCalled();

    await app.close();
  });

  it('без полей профиля запрос побайтно прежний: локальная модель из settings.txt', async () => {
    const stub = vi.mocked(fetch);
    const app = await jobsApp();

    const response = await withSilencedConsole(() => postJobs(app, []));
    expect(response.statusCode).toBe(202);
    const created = response.json<JobStatus>();
    // Локальный запуск точно так же не отвечает моделью: идентификатор известен
    // заранее, но подписываться им, пока никто не ответил, нельзя
    expect(created.effectiveModel).toBeNull();

    const final = await waitForFinalStage(app, created.id);
    expect(final.stage).toBe('done');

    expect(stub.mock.calls.length).toBeGreaterThan(0);
    for (const headers of headersOf(stub)) {
      expect(headers.Authorization).toBe('Bearer ollama');
    }
    expect(urlsOf(stub).every((url) => url.startsWith(OLLAMA_URL))).toBe(true);

    await app.close();
  });
});

/* ------------------------- runPipeline: третий аргумент ------------------- */

describe('runPipeline: модель запуска', () => {
  it('переданный конфиг достаёт до structure и до analysis', async () => {
    const stub = vi.mocked(fetch);
    const job = createJob(
      { ours: 'ours.xlsx', partner: 'partner.xlsx' },
      { ours: xlsxBuffer(), partner: xlsxBuffer() },
    );

    await withSilencedConsole(() => runPipeline(job.id, settings, remoteConfig()));

    expect(job.stage).toBe('done');
    const urls = urlsOf(stub);
    // structure вызывается для обеих сторон, analysis — последним вызовом.
    expect(urls.length).toBeGreaterThanOrEqual(3);
    expect(urls.every((url) => url === OPENROUTER_CHAT_COMPLETIONS_URL)).toBe(true);
    for (const headers of headersOf(stub)) {
      expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    }
  });

  it('двух-аргументный вызов остаётся локальным — третий параметр опционален', async () => {
    const stub = vi.mocked(fetch);
    const job = createJob(
      { ours: 'ours.xlsx', partner: 'partner.xlsx' },
      { ours: xlsxBuffer(), partner: xlsxBuffer() },
    );

    await withSilencedConsole(() => runPipeline(job.id, settings));

    expect(job.stage).toBe('done');
    expect(urlsOf(stub).every((url) => url.startsWith(OLLAMA_URL))).toBe(true);
    expect(headersOf(stub).every((headers) => headers.Authorization === 'Bearer ollama')).toBe(true);
  });
});

/* ------------------- Страховка: /api/compare в index.ts -------------------- */

/**
 * Единственное, что можно проверить в `index.ts`: модуль запускает сервер и
 * открывает браузер при импорте, поэтому ни один HTTP-вызов оттуда недостижим
 * из теста. Проверяется исходник хендлеров — не ради текста, а ради трёх
 * свойств, которые иначе не видит ни один тест:
 *
 *  - все три маршрута читают профиль запроса, а не общий конфиг процесса;
 *  - `/api/compare` **делегирует** `runCompare` и не зовёт `fullReconciliation`
 *    сам: пока маршрут содержал свой `catch` с повторным вызовом, он слал
 *    вторую одинаково отвергаемую платную попытку, и никакой тест этого не
 *    видел — именно поэтому логика вынесена в отдельный модуль;
 *  - имена полей профиля одинаковы во всех трёх маршрутах. Разъезд означал бы,
 *    что один из них молча ушёл бы на локальную модель.
 */
/**
 * Срез одного хендлера в исходнике.
 *
 * Проверка по всему `index.ts` прошла бы и тогда, когда нужное имя поля осталось
 * только в одном маршруте из трёх, — а смысл проверки в том, что маршруты
 * называют поля одинаково. Границы проверяются явно: `indexOf` вернул бы -1, и
 * срез молча оказался бы почти пустым.
 */
function handlerOf(source: string, route: string, endMarker: string): string {
  const from = source.indexOf(route);
  const to = source.indexOf(endMarker, from + route.length);
  expect(from, `маршрут ${route} не найден`).toBeGreaterThan(-1);
  expect(to, `конец ${route} не найден`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('index.ts: /api/compare и имена полей профиля', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const jobsSource = readFileSync(new URL('../src/routes/jobs.ts', import.meta.url), 'utf8');
  const ANALYZE = "app.post('/api/test/analyze'";
  const COMPARE = "app.post('/api/compare'";
  const JOBS = "app.post('/api/jobs'";

  it('хендлер читает профиль запроса, а не общий конфиг процесса', () => {
    const compareHandler = handlerOf(source, COMPARE, '/* ------------------------------ Пайплайн сверки');
    expect(compareHandler).toContain('resolveRequestAiConfig');
    expect(compareHandler).not.toMatch(/\baiConfig\b/);
    expect(compareHandler).not.toContain('ollamaModel');
  });

  it('сверку собирает runCompare, а не сам маршрут: своего catch с повтором в нём нет', () => {
    const compareHandler = handlerOf(source, COMPARE, '/* ------------------------------ Пайплайн сверки');
    expect(compareHandler).toContain('runCompare(ours, partner, ai.config)');
    expect(compareHandler).not.toContain('fullReconciliation');
  });

  it('все три маршрута читают поля профиля под одними именами', () => {
    // Проверяется чтение имени: multipart-маршруты берут его из `part.fieldname`,
    // `/api/compare` — из тела. Прежняя проверка искала литерал `'aiApiKey'` во
    // всём `index.ts`, держалась на соседнем маршруте и пропускала переименование
    // поля в одном из трёх. Оба имени проверяются отдельно: alternation прошла бы
    // по одному уцелевшим.
    const cases: ReadonlyArray<readonly [string, string, RegExp, RegExp]> = [
      [
        '/api/test/analyze',
        handlerOf(source, ANALYZE, '/* ---------------------------------- Здоровье'),
        /part\.fieldname === 'aiModel'/,
        /part\.fieldname === 'aiApiKey'/,
      ],
      [
        '/api/jobs',
        handlerOf(jobsSource, JOBS, '/* ------------------------------ Статус'),
        /part\.fieldname === 'aiModel'/,
        /part\.fieldname === 'aiApiKey'/,
      ],
      [
        '/api/compare',
        handlerOf(source, COMPARE, '/* ------------------------------ Пайплайн сверки'),
        /body\.aiModel/,
        /body\.aiApiKey/,
      ],
    ];

    for (const [name, handler, modelField, keyField] of cases) {
      expect(handler, `${name}: имя модели`).toMatch(modelField);
      expect(handler, `${name}: имя ключа`).toMatch(keyField);
    }
  });

  it('быстрый разбор отдаёт названную причину отказа шлюза, а не текст провайдера', () => {
    // Сборку ответа этой точки входа нечем проверить иначе — проверяется делегирование
    const analyzeHandler = handlerOf(source, ANALYZE, '/* ---------------------------------- Здоровье');
    expect(analyzeHandler).toContain('analyzeFailure(ai.config, err)');
    expect(analyzeHandler).not.toContain('fullMessage');
  });
});
