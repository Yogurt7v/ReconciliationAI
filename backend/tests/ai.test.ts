/**
 * Тесты AI-сервиса: клиент OpenRouter/Ollama (retry/бюджет попыток/таймаут/JSON),
 * ассистент структуры со слиянием эвристик и деградацией, гипотезы,
 * режим «только локальная модель» (REQUIRE_LOCAL_ONLY).
 * Сеть не используется — global.fetch подменяется заглушками.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AiUnavailableError,
  requestJson,
  aiConfigFromEnv,
  applyClientOverrides,
  isLocalOnly,
  looksLikeOllamaModel,
  type AiConfig,
} from '../src/services/ai/client.js';
import { assistStructure } from '../src/services/ai/structureAssist.js';
import {
  aiHypotheses,
  ruleBasedHypotheses,
  type HypothesisContext,
} from '../src/services/ai/hypotheses.js';
import type { Grid } from '@recon/shared';

/** Переменные окружения, которые тесты выставляют и обязаны убрать */
const MANAGED_ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'AI_FALLBACK_MODELS',
  'AI_PROVIDER',
  'OLLAMA_MODEL',
  'OLLAMA_BASE_URL',
  'OLLAMA_API_KEY',
  'OLLAMA_FALLBACK_MODELS',
  'REQUIRE_LOCAL_ONLY',
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of MANAGED_ENV_KEYS) delete process.env[key];
});

/** Минимальная конфигурация для тестов клиента (OpenAI-совместимый endpoint) */
const baseConfig = (overrides: Partial<AiConfig> = {}): AiConfig => ({
  apiKey: 'k',
  model: 'm',
  baseUrl: 'https://example.invalid/v1/chat/completions',
  provider: 'openrouter',
  fallbackModels: [],
  ...overrides,
});


/* -------------------------------- Клиент ---------------------------------- */

describe('requestJson', () => {
  // По умолчанию REQUIRE_LOCAL_ONLY=true — облачные вызовы заблокированы.
  // Тесты облачного режима явно его отключают.
  beforeEach(() => {
    process.env.REQUIRE_LOCAL_ONLY = 'false';
  });

  it('без ключа сразу бросает AiUnavailableError', async () => {
    await expect(
      requestJson(baseConfig({ apiKey: null }), 'sys', {}),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('парсит валидный JSON-ответ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await requestJson<{ ok: number }>(baseConfig(), 'sys', {});
    expect(out.data).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('повторяет запрос при HTTP 503 и успешно завершает', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'upstream' } }), { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '"yes"' } }] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const out = await requestJson<string>(baseConfig(), 'sys', {});
    expect(out.data).toBe('yes');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('не повторяет при HTTP 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestJson(baseConfig(), 'sys', {})).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    // 400 — невременная ошибка: смена модели не поможет, один запрос
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('бюджет попыток: основная модель 2 раза, каждая fallback — 1 (сеть недоступна)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    // Основная 'm' + 2 fallback-модели, все не отвечают
    const err = await requestJson(
      baseConfig({ fallbackModels: ['fb-one', 'fb-two'] }),
      'sys',
      {},
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 2 + 1 + 1
    expect((err as AiUnavailableError).debug?.attempts).toBe(4);
  });

  it('использует fallback-модель при сбое основной и помечает fallbackUsed', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const out = await requestJson<{ ok: number }>(
      baseConfig({ fallbackModels: ['fb-one', 'fb-two'] }),
      'sys',
      {},
    );
    expect(out.data).toEqual({ ok: 1 });
    expect(out.debug.fallbackUsed).toBe(true);
    expect(out.debug.attempts).toBe(3); // m×2 → fb-one×1
    const models = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(models[0]!.model).toBe('m');
    expect(models[2]!.model).toBe('fb-one');
  });

  it('пустая цепочка fallback отключает переключение моделей', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const err = await requestJson(baseConfig({ fallbackModels: [] }), 'sys', {}).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // только основная, с одним повтором
  });

  it('бросает ошибку на невалидном JSON в ответе модели', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) =>
            resolve(
              new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), {
                status: 200,
              }),
            ),
          ),
      ),
    );
    await expect(requestJson(baseConfig(), 'sys', {})).rejects.toThrow(/JSON/);
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
  // assistStructure() сам вызывает aiConfigFromEnv(), поэтому режим должен быть облачным.
  beforeEach(() => {
    process.env.REQUIRE_LOCAL_ONLY = 'false';
  });

  it('облачный режим без ключа — деградация к эвристике с пометкой в reasoning', async () => {
    // fetch не подменён: если бы запрос ушёл, он упал бы с сетевой ошибкой,
    // но конфиг без ключа отсекается ещё до вызова.
    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID);
    expect(aiUsed).toBe(false);
    expect(mapping.source).toBe('heuristic');
    expect(mapping.reasoning.some((r) => r.includes('OPENROUTER_API_KEY'))).toBe(true);
    // Эвристика нашла шапку и основные колонки
    expect(mapping.columns.docNumber).toBe(0);
    expect(mapping.columns.docDate).toBe(1);
    expect(mapping.columns.amount).toBe(2);
  });

  it('локальный режим без Ollama — деградация к эвристике', async () => {
    // REQUIRE_LOCAL_ONLY=true: apiKey всегда 'ollama', поэтому ветка «нет ключа»
    // недостижима и деградация происходит по недоступности провайдера.
    process.env.REQUIRE_LOCAL_ONLY = 'true';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID);
    expect(aiUsed).toBe(false);
    expect(mapping.source).toBe('heuristic');
    expect(mapping.columns.docNumber).toBe(0);
  });

  it('сливает ответ модели с эвристикой (source=ai+heuristic)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    headerRowIndex: 1,
                    dataStartRowIndex: 2,
                    columns: { docNumber: 0, docDate: 1, amount: 2, debit: null, credit: null },
                    confidence: 0.93,
                    reasoning: ['Шапка во второй строке, колонки соответствуют словарю.'],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID);
    expect(aiUsed).toBe(true);
    expect(mapping.source).toBe('ai+heuristic');
    expect(mapping.confidence).toBeGreaterThanOrEqual(0.9);
    expect(mapping.reasoning.some((r) => r.startsWith('AI:'))).toBe(true);
    expect(mapping.dataStartRowIndex).toBe(2);
  });

  it('некорректный ответ модели → эвристика с пометкой деградации', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ columns: { docNumber: -5 } }) } }],
          }),
          { status: 200 },
        ),
      ),
    );

    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID);
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
        samples: {
          amountMismatches: [
            {
              docNumber: '104',
              docDateOurs: '2026-03-01',
              docDatePartner: '2026-03-01',
              ourAmount: '15000.00',
              partnerAmount: '10000.00',
              difference: '5000.00',
              direction: 'they_owe',
              dateMismatch: false,
            },
          ],
          onlyOurs: [],
          onlyPartner: [],
        },
      }),
    );
    expect(out.some((h) => h.scope === 'doc' && h.docNumber === '104')).toBe(true);
  });

  it('совпадающие суммы и расходящиеся даты → общая гипотеза о датах', () => {
    const out = ruleBasedHypotheses(ctxWith({ summary: { ...ctxWith({}).summary, dateMismatches: 4 } }));
    expect(out.some((h) => h.text.includes('даты документов'))).toBe(true);
  });

  it('много документов только у нас → рекомендация передать контрагенту', () => {
    const out = ruleBasedHypotheses(ctxWith({ summary: { ...ctxWith({}).summary, onlyOurs: 6 } }));
    expect(out.some((h) => h.text.includes('только у нас'))).toBe(true);
  });
});

describe('aiHypotheses', () => {
  beforeEach(() => {
    process.env.REQUIRE_LOCAL_ONLY = 'false';
  });

  it('валидирует и нормализует ответ модели', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    hypotheses: [
                      { scope: 'doc', docNumber: '7', text: 'Возможен незачтённый аванс.', recommendation: 'Сверить платежи.' },
                      { scope: 'weird', text: '', recommendation: null }, // мусор — отфильтруется
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
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

  it('без ключа возвращает null', async () => {
    const out = await aiHypotheses(baseConfig({ apiKey: null }), ctxWith({}));
    expect(out).toBeNull();
  });
});

/* ------- Режим "только локальная модель" (REQUIRE_LOCAL_ONLY) ------- */

/** Типичное окружение локального режима */
const localEnv = {
  REQUIRE_LOCAL_ONLY: 'true',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct',
  OLLAMA_BASE_URL: 'http://ollama:11434',
};

describe('REQUIRE_LOCAL_ONLY — отключение других распознавателей', () => {
  it('aiConfigFromEnv всегда возвращает ollama, даже при AI_PROVIDER=openrouter', () => {
    const cfg = aiConfigFromEnv({ ...localEnv, AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-test' });
    expect(cfg.provider).toBe('ollama');
    expect(cfg.baseUrl).toContain('ollama:11434');
    expect(cfg.fallbackModels).toEqual([]);
  });

  it('applyClientOverrides игнорирует облачную модель клиента и не даёт fallback', () => {
    const base = aiConfigFromEnv(localEnv);
    const cfg = applyClientOverrides(base, { model: 'openai/gpt-4o-mini', apiKey: 'sk-x' }, localEnv);
    expect(cfg.provider).toBe('ollama');
    expect(cfg.model).toBe('qwen2.5:7b-instruct'); // клиентская облачная модель отброшена
    expect(cfg.fallbackModels).toEqual([]);
  });

  it('applyClientOverrides принимает локальную модель клиента', () => {
    const base = aiConfigFromEnv(localEnv);
    const cfg = applyClientOverrides(base, { model: 'llama3.1:8b' }, localEnv);
    expect(cfg.model).toBe('llama3.1:8b');
    expect(cfg.fallbackModels).toEqual([]);
  });

  it('requestJson блокирует облачный конфиг без единого HTTP-запроса', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cloudCfg: AiConfig = {
      apiKey: 'sk-test',
      model: 'openai/gpt-4o-mini',
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      provider: 'openrouter',
      fallbackModels: [],
    };
    await expect(requestJson(cloudCfg, 'sys', {})).rejects.toThrow(/только локальную модель/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('при REQUIRE_LOCAL_ONLY=false поведение возвращается к прежнему (env-конфиг openrouter)', () => {
    const cfg = aiConfigFromEnv({ REQUIRE_LOCAL_ONLY: 'false', OPENROUTER_API_KEY: 'sk-test' });
    expect(cfg.provider).toBe('openrouter');
    expect(cfg.fallbackModels.length).toBeGreaterThan(0);
  });

  it('локальный режим игнорирует OLLAMA_FALLBACK_MODELS', () => {
    const cfg = aiConfigFromEnv({ ...localEnv, OLLAMA_FALLBACK_MODELS: 'a:1,b:2' });
    expect(cfg.fallbackModels).toEqual([]);
  });

  it('isLocalOnly определяет флаг /api/health, а не наличие fallback', () => {
    // Регресс: флаг health вычислялся как provider==='ollama' && fallback пуст,
    // из-за чего при REQUIRE_LOCAL_ONLY=false + AI_PROVIDER=ollama фронтенд
    // ошибочно скрывал ключ OpenRouter и запрещал облачные модели.
    const cloudOllama = {
      REQUIRE_LOCAL_ONLY: 'false',
      AI_PROVIDER: 'ollama',
      OLLAMA_MODEL: 'qwen2.5:7b-instruct',
    };
    const cfg = aiConfigFromEnv(cloudOllama);
    expect(cfg.provider).toBe('ollama');
    expect(cfg.fallbackModels).toEqual([]);              // выглядит как «локально»
    expect(isLocalOnly(cloudOllama)).toBe(false);         // но локальный режим выключен

    expect(isLocalOnly(localEnv)).toBe(true);
    // REQUIRE_LOCAL_ONLY не задан => по умолчанию включён (true)
    expect(isLocalOnly({})).toBe(true);
  });

  it('в облачном режиме OLLAMA_FALLBACK_MODELS включает локальную цепочку', () => {
    const cfg = applyClientOverrides(
      aiConfigFromEnv({ REQUIRE_LOCAL_ONLY: 'false', OPENROUTER_API_KEY: 'sk' }),
      { model: 'qwen2.5:7b-instruct' },
      { REQUIRE_LOCAL_ONLY: 'false', OPENROUTER_API_KEY: 'sk', OLLAMA_FALLBACK_MODELS: 'qwen2.5:3b' },
    );
    expect(cfg.provider).toBe('ollama');
    expect(cfg.fallbackModels).toEqual(['qwen2.5:3b']);
  });

  it('облачная цепочка настраивается через AI_FALLBACK_MODELS', () => {
    const cfg = aiConfigFromEnv({ REQUIRE_LOCAL_ONLY: 'false', AI_FALLBACK_MODELS: 'fb-a,fb-b' });
    expect(cfg.provider).toBe('openrouter');
    expect(cfg.fallbackModels).toEqual(['fb-a', 'fb-b']);
  });

  it('пустая AI_FALLBACK_MODELS отключает облачную цепочку', () => {
    const cfg = aiConfigFromEnv({ REQUIRE_LOCAL_ONLY: 'false', AI_FALLBACK_MODELS: '' });
    expect(cfg.fallbackModels).toEqual([]);
  });
});

/* --------------------------- Распознавание Ollama-моделей ---------------- */

describe('looksLikeOllamaModel', () => {
  const cloudEnv = { REQUIRE_LOCAL_ONLY: 'false' };

  it('облачные ID содержат "/" и не считаются локальными', () => {
    expect(looksLikeOllamaModel('openai/gpt-4o-mini', cloudEnv)).toBe(false);
    expect(looksLikeOllamaModel('meta-llama/llama-3-70b-instruct', cloudEnv)).toBe(false);
  });

  it('тег версии и префикс ollama/ считаются локальными', () => {
    expect(looksLikeOllamaModel('qwen2.5:7b-instruct', cloudEnv)).toBe(true);
    expect(looksLikeOllamaModel('ollama/mistral', cloudEnv)).toBe(true);
  });

  it('в облачном режиме имя без тега локальным не считается', () => {
    expect(looksLikeOllamaModel('llama3.1', cloudEnv)).toBe(false);
  });

  it('в локальном режиме любое имя без "/" считается локальным', () => {
    // Раньше «llama3.1» (валидное имя Ollama без тега) молча отбрасывалось
    expect(looksLikeOllamaModel('llama3.1', localEnv)).toBe(true);
    expect(looksLikeOllamaModel('openai/gpt-4o-mini', localEnv)).toBe(false);
  });

  it('в облачном режиме совпадение с OLLAMA_MODEL считается локальным', () => {
    expect(looksLikeOllamaModel('mistral', { ...cloudEnv, OLLAMA_MODEL: 'mistral' })).toBe(true);
  });
});
