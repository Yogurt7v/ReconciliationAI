/**
 * Тесты AI-сервиса: клиент локальной модели Ollama (retry/бюджет попыток/
 * таймаут/JSON), конфигурация из settings.txt, ассистент структуры со слиянием
 * эвристик и деградацией, гипотезы.
 * Сеть не используется — global.fetch подменяется заглушками.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AiUnavailableError,
  aiConfigFromSettings,
  requestJson,
  type AiConfig,
} from '../src/services/ai/client.js';
import { assistStructure } from '../src/services/ai/structureAssist.js';
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
const baseConfig = (overrides: Partial<AiConfig> = {}): AiConfig => ({
  baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
  model: 'm',
  timeoutMs: 30_000,
  ...overrides,
});

/** Ответ модели с заданным JSON-полезным содержимым */
function chatOk(content: unknown, status = 200): Response {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status });
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

    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID, testSettings());
    expect(aiUsed).toBe(false);
    expect(mapping.source).toBe('heuristic');
    expect(mapping.reasoning.some((r) => r.includes('Сервис AI недоступен'))).toBe(true);
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

    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID, testSettings());
    expect(aiUsed).toBe(true);
    expect(mapping.source).toBe('ai+heuristic');
    expect(mapping.confidence).toBeGreaterThanOrEqual(0.9);
    expect(mapping.reasoning.some((r) => r.startsWith('AI:'))).toBe(true);
    expect(mapping.dataStartRowIndex).toBe(2);
  });

  it('некорректный ответ модели → эвристика с пометкой деградации', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chatOk({ columns: { docNumber: -5 } })));

    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID, testSettings());
    expect(aiUsed).toBe(true);
    expect(mapping.source).toBe('heuristic');
    expect(mapping.reasoning.some((r) => r.includes('некорректную структуру'))).toBe(true);
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
