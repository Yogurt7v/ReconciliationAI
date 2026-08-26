/**
 * Тесты AI-парсинга двухсторонних актов сверки.
 * Сеть не используется — global.fetch подменяется заглушками.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { looksTwoSided, parseTwoSidedPdf } from '../src/services/ai/structuredParse.js';
import type { AiConfig } from '../src/services/ai/client.js';

const CFG: AiConfig = { apiKey: 'test-key', model: 'm' };

function mockFetchJson(response: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }),
      { status: 200 },
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/*                          looksTwoSided (эвристика)                         */
/* -------------------------------------------------------------------------- */

describe('looksTwoSided', () => {
  it('два набора дебет/кредит → двухсторонний', () => {
    const text = `
      Шапка: № Дата Документ Дебет Кредит Дебет Кредит
      1 01.03.2026 Оплата 1000 null null null
    `;
    expect(looksTwoSided(text)).toBe(true);
  });

  it('два «По данным» → двухсторонний', () => {
    const text = `
      Акт сверки
      По данным ООО Ромашка
      По данных ООО Солнце
    `;
    expect(looksTwoSided(text)).toBe(true);
  });

  it('сальдо + двойные дебет → двухсторонний', () => {
    const text = `
      Таблица: Дата Документ Дебет Кредит Дебет Кредит
      Сальдо на начало периода 5000
    `;
    expect(looksTwoSided(text)).toBe(true);
  });

  it('одна сторона → не двухсторонний', () => {
    const text = `
      Акт сверки
      № Дата Сумма Назначение
      1 05.03.2026 1000 Оплата
    `;
    expect(looksTwoSided(text)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                          parseTwoSidedPdf                                  */
/* -------------------------------------------------------------------------- */

const VALID_RESPONSE = {
  act_number: '494',
  period: { start: '01.03.2026', end: '01.08.2026' },
  party_1: { name: 'ООО ЛЕНМЕТРОСТРОЙ', inn: '7841085365' },
  party_2: { name: 'ООО РОПНЕТ', inn: '7743203606' },
  table: {
    rows: [
      {
        date: '20.04.2026',
        document: 'Оплата 513 от 17.04.2026',
        party_1_debit: 3066.67,
        party_1_credit: null,
        party_2_debit: null,
        party_2_credit: null,
      },
      {
        date: '29.04.2026',
        document: 'Оплата 602 от 29.04.2026',
        party_1_debit: null,
        party_1_credit: null,
        party_2_debit: 4000.01,
        party_2_credit: null,
      },
      {
        date: '30.04.2026',
        document: 'Приход 673 от 30.04.2026',
        party_1_debit: null,
        party_1_credit: 3066.67,
        party_2_debit: null,
        party_2_credit: null,
      },
    ],
    opening_balance: { party_1: 0, party_2: null },
    turnovers: {
      party_1_debit: 3066.67,
      party_1_credit: 3066.67,
      party_2_debit: 4000.01,
      party_2_credit: 0,
    },
    closing_balance: { party_1: 0, party_2: 4000.01 },
  },
  text_summary: 'Задолженность 4000.01',
};

describe('parseTwoSidedPdf', () => {
  it('без ключа → null', async () => {
    const result = await parseTwoSidedPdf({ apiKey: null, model: 'm' }, 'текст', 'file.pdf');
    expect(result).toBeNull();
  });

  it('с пустым текстом → null', async () => {
    const result = await parseTwoSidedPdf(CFG, '   ', 'file.pdf');
    expect(result).toBeNull();
  });

  it('успешный парсинг → два ParsedSide', async () => {
    vi.stubGlobal('fetch', mockFetchJson(VALID_RESPONSE));

    const result = await parseTwoSidedPdf(CFG, 'текст акта', 'act.pdf');
    expect(result).not.toBeNull();
    expect(result!.ours).toBeDefined();
    expect(result!.partner).toBeDefined();
    expect(result!.raw).toEqual(VALID_RESPONSE);

    expect(result!.ours.meta.kind).toBe('ai-structured');
    expect(result!.ours.meta.fileName).toBe('act.pdf');
    expect(result!.ours.rows.length).toBe(3); // все 3 строки имеют документ
    expect(result!.partner.rows.length).toBe(3); // все 3 строки имеют документ, но 2 без сумм

    expect(result!.ours.rows[0]!.docNumber).toBe('Оплата 513 от 17.04.2026');
    expect(result!.ours.rows[0]!.docDate).toBe('2026-04-20');
    expect(result!.ours.rows[0]!.amount).toBe('3066.67');

    // partner строка с суммой — вторая (party_2_debit)
    const partnerWithAmount = result!.partner.rows.find((r) => r.amount !== null);
    expect(partnerWithAmount).toBeDefined();
    expect(partnerWithAmount!.docNumber).toBe('Оплата 602 от 29.04.2026');
    expect(partnerWithAmount!.amount).toBe('4000.01');
  });

  it('некорректный ответ AI (нет table) → null', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ act_number: '1' }));

    const result = await parseTwoSidedPdf(CFG, 'текст', 'f.pdf');
    expect(result).toBeNull();
  });

  it('пустая таблица → null', async () => {
    vi.stubGlobal('fetch', mockFetchJson({
      ...VALID_RESPONSE,
      table: { rows: [], opening_balance: null, turnovers: null, closing_balance: null },
    }));

    const result = await parseTwoSidedPdf(CFG, 'текст', 'f.pdf');
    expect(result).toBeNull();
  });

  it('ошибка сети → null (деградация)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    const result = await parseTwoSidedPdf(CFG, 'текст', 'f.pdf');
    expect(result).toBeNull();
  });

  it('строки без данных пропускаются', async () => {
    vi.stubGlobal('fetch', mockFetchJson({
      ...VALID_RESPONSE,
      table: {
        ...VALID_RESPONSE.table,
        rows: [
          { date: null, document: null, party_1_debit: null, party_1_credit: null, party_2_debit: null, party_2_credit: null },
          { date: '01.05.2026', document: 'Док 1', party_1_debit: 100, party_1_credit: null, party_2_debit: null, party_2_credit: null },
        ],
      },
    }));

    const result = await parseTwoSidedPdf(CFG, 'текст', 'f.pdf');
    expect(result).not.toBeNull();
    expect(result!.ours.rows.length).toBe(1);
    expect(result!.ours.meta.rowsSkipped).toBe(1);
  });
});
