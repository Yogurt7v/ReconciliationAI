/**
 * Тесты AI-сервиса: клиент OpenRouter (retry/таймаут/JSON), ассистент
 * структуры со слиянием эвристик и деградацией, гипотезы.
 * Сеть не используется — global.fetch подменяется заглушками.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiUnavailableError, requestJson } from '../src/services/ai/client.js';
import { assistStructure } from '../src/services/ai/structureAssist.js';
import { aiHypotheses, ruleBasedHypotheses } from '../src/services/ai/hypotheses.js';
import type { Grid, HypothesisContext } from '@recon/shared';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
});

/* -------------------------------- Клиент ---------------------------------- */

describe('requestJson', () => {
  it('без ключа сразу бросает AiUnavailableError', async () => {
    await expect(
      requestJson({ apiKey: null, model: 'm' }, 'sys', {}),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('парсит валидный JSON-ответ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await requestJson<{ ok: number }>({ apiKey: 'k', model: 'm' }, 'sys', {});
    expect(out).toEqual({ ok: 1 });
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

    const out = await requestJson<string>({ apiKey: 'k', model: 'm' }, 'sys', {});
    expect(out).toBe('yes');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('не повторяет при HTTP 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestJson({ apiKey: 'k', model: 'm' }, 'sys', {})).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    await expect(requestJson({ apiKey: 'k', model: 'm' }, 'sys', {})).rejects.toThrow(/JSON/);
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
  it('без ключа — деградация к эвристике с пометкой в reasoning', async () => {
    const { mapping, aiUsed } = await assistStructure(SAMPLE_GRID);
    expect(aiUsed).toBe(false);
    expect(mapping.source).toBe('heuristic');
    expect(mapping.reasoning.some((r) => r.includes('OPENROUTER_API_KEY'))).toBe(true);
    // Эвристика нашла шапку и основные колонки
    expect(mapping.columns.docNumber).toBe(0);
    expect(mapping.columns.docDate).toBe(1);
    expect(mapping.columns.amount).toBe(2);
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

    const out = await aiHypotheses({ apiKey: 'k', model: 'm' }, ctxWith({}));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(out![0]!.docNumber).toBe('7');
    expect(out![0]!.scope).toBe('doc');
  });

  it('при ошибке сети возвращает null (деградация)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const out = await aiHypotheses({ apiKey: 'k', model: 'm' }, ctxWith({}));
    expect(out).toBeNull();
  });

  it('без ключа возвращает null', async () => {
    const out = await aiHypotheses({ apiKey: null, model: 'm' }, ctxWith({}));
    expect(out).toBeNull();
  });
});
