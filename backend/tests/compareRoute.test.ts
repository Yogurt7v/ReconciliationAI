/**
 * `/api/compare` — третья из трёх точек входа с AI-вызовом, и единственная,
 * где отказ удалённого шлюза обрабатывался сам. Проверяется здесь потому, что
 * хендлер живёт в `index.ts`, а тот запускает сервер при импорте: ответ
 * маршрута собирает чистая функция `runCompare` (`src/routes/compare.ts`), и
 * её поведение видно целиком.
 *
 * Главное свойство — **один платный запрос на AI-вызов**. Терминальный отказ
 * (отвергнутый ключ, нет денег, нет модели) обязан стать `502` с названной
 * причиной, а не вторым одинаково отвергаемым запросом и не «успешной» карточкой
 * сравнения без единого признака отказа.
 *
 * Сеть не используется: `fetch` подменяется заглушкой.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiConfig } from '../src/services/ai/client.js';
import { aiConfigFromRemoteProfile, aiConfigFromSettings } from '../src/services/ai/client.js';
import type { DocumentData } from '../src/services/ai/testAnalyze.js';
import type { CompareOutcome, CompareRefusal, CompareResponse } from '../src/routes/compare.js';
import { runCompare } from '../src/routes/compare.js';

/**
 * Тело ответа — объединение двух форм, и сузить его здесь приходится руками:
 * `error` есть только у отказа, `aiAnalysis` — только у карточки сравнения.
 * Попытка достать то поле, которого в этой форме нет, — ошибка компиляции, а не
 * `undefined` в рантайме. Поэтому проверки ниже заодно утверждают, что отказ не
 * притворяется результатом: карточки в теле `502` нет вовсе.
 */
function asRefusal(outcome: CompareOutcome): CompareRefusal {
  expect(outcome.statusCode).toBe(502);
  if (!('error' in outcome.body)) {
    throw new Error('ожидался отказ с названной причиной, а пришла карточка сравнения');
  }
  return outcome.body;
}

function asResponse(outcome: CompareOutcome): CompareResponse {
  expect(outcome.statusCode).toBe(200);
  if ('error' in outcome.body) {
    throw new Error(`ожидалась карточка сравнения, а пришёл отказ «${outcome.body.error}»`);
  }
  return outcome.body;
}

/** Конфиги, с которыми реально звали `fullReconciliation`, по порядку вызовов */
const seenConfigs: Array<AiConfig | undefined> = [];
/** Первый вызов `fullReconciliation` в этом тесте падает вместо ответа */
let failFirstCall = false;

vi.mock('../src/services/ai/reconciliation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/ai/reconciliation.js')>();
  return {
    ...actual,
    fullReconciliation: async (
      ours: DocumentData,
      partner: DocumentData,
      config?: AiConfig,
    ) => {
      seenConfigs.push(config);
      if (failFirstCall && seenConfigs.length === 1) {
        throw new Error('внутренний сбой расчёта');
      }
      return actual.fullReconciliation(ours, partner, config);
    },
  };
});

const REMOTE_MODEL = 'vendor/model-a:free';
const API_KEY = 'sk-or-v1-CANARY-0123456789abcdef';
const REJECTED_KEY_CAUSE = 'Ключ OpenRouter отклонён провайдером (HTTP 401): Invalid API key';

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

/** Отказ шлюза, который повтор не исправит */
function rejectedByGateway(): Response {
  return new Response(
    JSON.stringify({ error: { message: 'Invalid API key', metadata: { error_type: 'authentication_error' } } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

/** Отказ, который повтор исправляет: маршрут обязан деградировать к правилам */
function throttledByGateway(): Response {
  return new Response(
    JSON.stringify({ error: { message: 'slow down', metadata: { error_type: 'rate_limit_exceeded' } } }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  );
}

function stubAnswering(response: Response): ReturnType<typeof vi.fn> {
  return vi.fn(async () => response.clone());
}

/** Ответ модели с корректным AI-анализом — успешный путь */
function chatAnalysis(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ analysis: 'Всё сходится.', risks: [] }) } }],
      usage: { total_tokens: 512 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

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

/**
 * Состояние модуля, а не `beforeEach`: заглушка объявлена через `vi.mock`,
 * и её замыкание поднимается один раз на весь файл. Обнулять надо перед каждым
 * тестом — иначе счётчик конфигов копится от предыдущих, и «ровно два вызова»
 * начинает проверять чужой тест.
 */
beforeEach(() => {
  seenConfigs.length = 0;
  failFirstCall = false;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runCompare: отказ, который повтор не исправит', () => {
  it('удалённый провайдер: 502 с названной причиной и ровно один запрос', async () => {
    const stub = stubAnswering(rejectedByGateway());
    vi.stubGlobal('fetch', stub);

    const outcome = await runCompare(documentOf(1000), documentOf(900), remoteConfig());

    expect(asRefusal(outcome).error).toBe(REJECTED_KEY_CAUSE);
    // Отказ не притворяется результатом: карточки сравнения в теле нет
    expect(outcome.body).not.toHaveProperty('summary');
    // Вторая попытка стоила бы оператору денег за тот же отказ
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('локальная модель при том же 401 деградирует, как прежде', async () => {
    const stub = stubAnswering(rejectedByGateway());
    vi.stubGlobal('fetch', stub);

    const outcome = await runCompare(documentOf(1000), documentOf(900), localConfig());

    expect(outcome.statusCode).toBe(200);
    expect(stub).toHaveBeenCalledTimes(1);
  });
});

describe('runCompare: отказ, который повтор исправляет', () => {
  it('удалённый 429 → карточка остаётся, ни одного повторного запроса в шлюз', async () => {
    const stub = stubAnswering(throttledByGateway());
    vi.stubGlobal('fetch', stub);

    const outcome = await runCompare(documentOf(1000), documentOf(900), remoteConfig());

    const body = asResponse(outcome);
    expect(body.aiAnalysis).toBe('AI-анализ недоступен.');
    // Повтор 429 отработал внутри клиента, и всё же запрос ровно один
    expect(stub).toHaveBeenCalledTimes(1);
    // Причина отказа остаётся видимой в диагностике карточки
    expect(body.debug.errorMessage).toContain('slow down');
  });

  it('в теле ответа нет ключа оператора ни в одной ветке отказа', async () => {
    vi.stubGlobal('fetch', stubAnswering(rejectedByGateway()));

    const outcome = await runCompare(documentOf(1000), documentOf(900), remoteConfig());

    expect(JSON.stringify(outcome.body)).not.toContain(API_KEY);
  });
});

/**
 * Запасной расчёт в `catch` сетью недостижим: `fullReconciliation` глотает любой
 * отказ сам, и наружу отдаёт только терминальный отказ удалённого провайдера —
 * а тот уходит в `502` выше. Поэтому проверяется он подменой самой функции:
 * первый вызов падает, и важно, **с каким конфигом** придёт второй.
 */
describe('runCompare: запасной расчёт в catch', () => {
  it('идёт без конфига — иначе он снова соединился бы с платным шлюзом', async () => {
    failFirstCall = true;
    const stub = stubAnswering(chatAnalysis());
    vi.stubGlobal('fetch', stub);

    const outcome = await runCompare(documentOf(1000), documentOf(900), remoteConfig());

    expect(seenConfigs).toHaveLength(2);
    expect(seenConfigs[0]).toEqual(remoteConfig());
    // Второй вызов — расчёт правилами, и `aiAnalysis` прямо называет это
    expect(seenConfigs[1]).toBeUndefined();
    const body = asResponse(outcome);
    expect(body.aiAnalysis).toBe('AI-анализ отключен.');
    expect(body.debug.errorMessage).toContain('внутренний сбой');
    // Ни одного обращения к шлюзу: правила модель не зовут
    expect(stub).not.toHaveBeenCalled();
  });
});
