import { describe, expect, it } from 'vitest';

import { normalizeDocNumber, parseMoney } from '@recon/shared';
import type { ParsedRow, ParsedSide } from '@recon/shared';

import { reconcileSides } from '../src/services/reconcile.js';

let rowSeq = 0;
function row(partial: Partial<ParsedRow> & { amount?: string }): ParsedRow {
  const docNumber = partial.docNumber ?? null;
  rowSeq += 1;
  return {
    rowIndex: partial.rowIndex ?? rowSeq,
    docNumber,
    // В реальном пайплайне номер нормализуется на этапе извлечения
    docNumberNorm: normalizeDocNumber(docNumber),
    docDate: partial.docDate ?? null,
    amount: partial.amount != null ? parseMoney(partial.amount) : null,
    debit: partial.debit ?? null,
    credit: partial.credit ?? null,
  };
}

function side(rows: ParsedRow[]): ParsedSide {
  return {
    role: 'ours',
    meta: {
      fileName: 'test.xlsx',
      kind: 'excel',
      sheetName: null,
      pages: null,
      rowsExtracted: rows.length,
      rowsSkipped: 0,
    },
    rows,
    openingBalance: null,
    closingBalance: null,
    turnoverDebit: null,
    turnoverCredit: null,
    assumptions: [],
  };
}

describe('reconcileSides', () => {
  it('полное совпадение — расхождений нет', () => {
    const ours = side([
      row({ docNumber: '1', docDate: '2026-01-10', amount: '100.00' }),
      row({ docNumber: '2', docDate: '2026-01-15', amount: '250.50' }),
    ]);
    const partner = side([
      row({ docNumber: '2', docDate: '2026-01-15', amount: '250.50' }),
      row({ docNumber: '1', docDate: '2026-01-10', amount: '100.00' }),
    ]);
    const r = reconcileSides(ours, partner);
    expect(r.matchedPairs).toHaveLength(2);
    expect(r.onlyOurs).toHaveLength(0);
    expect(r.onlyPartner).toHaveLength(0);
    expect(r.amountMismatches).toHaveLength(0);
    expect(r.dateMismatches).toHaveLength(0);
  });

  it('документ только у нас и только у контрагента', () => {
    const ours = side([
      row({ docNumber: '1', amount: '100.00' }),
      row({ docNumber: '2', amount: '300.00' }),
    ]);
    const partner = side([
      row({ docNumber: '1', amount: '100.00' }),
      row({ docNumber: '9', amount: '77.00' }),
    ]);
    const r = reconcileSides(ours, partner);
    expect(r.onlyOurs.map((i) => i.docNumber)).toEqual(['2']);
    expect(r.onlyPartner.map((i) => i.docNumber)).toEqual(['9']);
  });

  it('разница сумм до копейки и направление долга', () => {
    const ours = side([row({ docNumber: '1', amount: '1000.00' })]);
    const partner = side([row({ docNumber: '1', amount: '999.99' })]);
    const r = reconcileSides(ours, partner);
    expect(r.amountMismatches).toHaveLength(1);
    const m = r.amountMismatches[0]!;
    expect(m.difference).toBe('0.01');
    // Наша сумма больше → контрагент должен нам
    expect(m.direction).toBe('they_owe');
  });

  it('обратное направление: мы должны контрагенту', () => {
    const ours = side([row({ docNumber: '1', amount: '500.00' })]);
    const partner = side([row({ docNumber: '1', amount: '700.00' })]);
    const r = reconcileSides(ours, partner);
    expect(r.amountMismatches[0]!.direction).toBe('we_owe');
    expect(r.amountMismatches[0]!.difference).toBe('-200.00');
  });

  it('строгое равенство: суммы, прошедшие нормализацию до копейки', () => {
    // В реальном пайплайне обе суммы проходят parseMoney (2 знака) —
    // движок сравнивает их строго
    const ours = side([row({ docNumber: '1', amount: '0,10' })]);
    const partner = side([row({ docNumber: '1', amount: '0.10000001' })]);
    const r = reconcileSides(ours, partner);
    expect(r.amountMismatches).toHaveLength(0);
  });

  it('совпадение сумм при разной дате → расхождение дат', () => {
    const ours = side([row({ docNumber: '1', docDate: '2026-03-05', amount: '100.00' })]);
    const partner = side([row({ docNumber: '1', docDate: '2026-03-06', amount: '100.00' })]);
    const r = reconcileSides(ours, partner);
    expect(r.amountMismatches).toHaveLength(0);
    expect(r.dateMismatches).toHaveLength(1);
    expect(r.dateMismatches[0]!.ourDate).toBe('2026-03-05');
  });

  it('дубли: два экземпляра у нас, один у контрагента', () => {
    // Платёж №55 двумя частями по 500; контрагент отразил только одну часть
    const ours = side([
      row({ docNumber: '55', docDate: '2026-02-01', amount: '500.00' }),
      row({ docNumber: '55', docDate: '2026-02-01', amount: '500.00' }),
    ]);
    const partner = side([row({ docNumber: '55', docDate: '2026-02-01', amount: '500.00' })]);
    const r = reconcileSides(ours, partner);
    expect(r.matchedPairs).toHaveLength(1);
    expect(r.onlyOurs).toHaveLength(1);
    expect(r.onlyOurs[0]!.amount).toBe('500.00');
  });

  it('дубли с разной датой парсятся попарно по порядку дат', () => {
    const ours = side([
      row({ docNumber: '7', docDate: '2026-01-20', amount: '10.00' }),
      row({ docNumber: '7', docDate: '2026-01-05', amount: '20.00' }),
    ]);
    const partner = side([
      row({ docNumber: '7', docDate: '2026-01-05', amount: '20.00' }),
      row({ docNumber: '7', docDate: '2026-01-21', amount: '30.00' }),
    ]);
    const r = reconcileSides(ours, partner);
    // (05.01: 20=20 ок) и (20.01 vs 21.01: 10≠30)
    expect(r.matchedPairs).toHaveLength(2);
    expect(r.amountMismatches).toHaveLength(1);
    expect(r.amountMismatches[0]!.difference).toBe('-20.00');
  });

  it('нормализация номера: «№ 123/А» и «123/а» — один документ', () => {
    const ours = side([row({ docNumber: '№ 123/А', amount: '50.00' })]);
    const partner = side([row({ docNumber: '123/а', amount: '50.00' })]);
    const r = reconcileSides(ours, partner);
    expect(r.matchedPairs).toHaveLength(1);
  });

  it('строка без номера не может быть сопоставлена', () => {
    const ours = side([row({ docNumber: null, amount: '42.00' })]);
    const partner = side([]);
    const r = reconcileSides(ours, partner);
    // Без ключа строка не попадает ни в группы, ни в отчётные списки — фиксируется при извлечении
    expect(r.onlyOurs).toHaveLength(0);
    expect(r.matchedPairs).toHaveLength(0);
  });

  it('производительность: 1000×1000 строк со сдвигом менее чем за 3 секунды', () => {
    const mkRows = (offset: number) =>
      Array.from({ length: 1000 }, (_, i) =>
        row({
          docNumber: `D${String(i + offset).padStart(5, '0')}`,
          docDate: `2026-${String((i % 12) + 1).padStart(2, '0')}-15`,
          amount: `${i * 3 + offset}.25`,
        }),
      );
    const ours = side(mkRows(0));
    const partner = side(mkRows(5)); // 5 документов отсутствуют у нас, 5 только у нас
    const t0 = performance.now();
    const r = reconcileSides(ours, partner);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(3000);
    // 995 сопоставленных + 5 только у нас + 5 только у контрагента = 1005 позиций
    expect(r.matchedPairs.length + r.onlyOurs.length + r.onlyPartner.length).toBe(1005);
    expect(r.onlyOurs).toHaveLength(5);
    expect(r.onlyPartner).toHaveLength(5);
  });
});
