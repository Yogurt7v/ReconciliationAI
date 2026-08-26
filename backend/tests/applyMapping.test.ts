import { describe, expect, it } from 'vitest';

import type { ColumnMapping, Grid, RawSource } from '@recon/shared';

import { applyMapping, cellToString, findBalances, sumColumn } from '../src/services/applyMapping.js';

function src(grid: Grid, fileName = 'test.xlsx'): RawSource {
  return { grid, kind: 'excel', fileName };
}

function mapping(docNumber = 0, docDate = 1, amount = 2, dataStart = 1): ColumnMapping {
  return {
    headerRowIndex: 0,
    dataStartRowIndex: dataStart,
    columns: { docNumber, docDate, amount, debit: null, credit: null },
    confidence: 1,
    source: 'heuristic',
    reasoning: [],
  };
}

describe('cellToString', () => {
  it('нормализует неразрывные пробелы', () => {
    expect(cellToString('1\u00A0234,56')).toBe('1 234,56');
  });

  it('null/undefined → пустая строка', () => {
    expect(cellToString(null)).toBe('');
    expect(cellToString(undefined)).toBe('');
  });
});

describe('sumColumn', () => {
  it('суммирует debit колонку', () => {
    const rows = [
      { rowIndex: 0, docNumber: '1', docNumberNorm: '1', docDate: '2026-01-01', amount: null, debit: '100.00', credit: null },
      { rowIndex: 1, docNumber: '2', docNumberNorm: '2', docDate: '2026-01-02', amount: null, debit: '200.50', credit: null },
    ];
    expect(sumColumn(rows, 'debit')).toBe('300.50');
  });

  it('null если нет значений', () => {
    const rows = [
      { rowIndex: 0, docNumber: '1', docNumberNorm: '1', docDate: null, amount: null, debit: null, credit: null },
    ];
    expect(sumColumn(rows, 'debit')).toBeNull();
  });
});

describe('findBalances', () => {
  it('извлекает сальдо начальное и конечное из нормальных строк', () => {
    const grid: Grid = [
      ['Номер', 'Дата', 'Сумма'],
      ['1', '01.03.2026', '1000'],
      ['2', '02.03.2026', '2000'],
      ['Сальдо на начало периода', '', '500'],
      ['Сальдо на конец периода', '', '3500'],
    ];
    const result = findBalances(grid);
    expect(result.openingBalance).toBe('500.00');
    expect(result.closingBalance).toBe('3500.00');
  });

  it('fallback для склеенных значений: "7 999,99Сальдо конечное"', () => {
    const grid: Grid = [
      ['Номер', 'Дата', 'Сумма'],
      ['1', '01.03.2026', '1000'],
      ['7 999,99Сальдо конечное', '', ''],
    ];
    const result = findBalances(grid);
    expect(result.closingBalance).toBe('7999.99');
  });

  it('fallback для склеенных начальных значений', () => {
    const grid: Grid = [
      ['5 000,00Сальдо начальное', '', ''],
    ];
    const result = findBalances(grid);
    expect(result.openingBalance).toBe('5000.00');
  });

  it('без строк сальдо — всё null', () => {
    const grid: Grid = [
      ['Номер', 'Дата', 'Сумма'],
      ['1', '01.03.2026', '1000'],
    ];
    const result = findBalances(grid);
    expect(result.openingBalance).toBeNull();
    expect(result.closingBalance).toBeNull();
  });
});

describe('applyMapping', () => {
  it('извлекает строки документов и пропускает лейблы', () => {
    const grid: Grid = [
      ['Номер', 'Дата', 'Сумма'],
      ['1', '05.03.2026', '15 000,00'],
      ['Сальдо на начало периода', '', '5 000,00'],
      ['2', '06.03.2026', '4 200,50'],
      ['Итого', '', '19 200,50'],
      ['Сальдо на конец периода', '', '24 200,50'],
    ];
    const result = applyMapping(src(grid), mapping(), 'ours');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].docNumber).toBe('1');
    expect(result.rows[0].docDate).toBe('2026-03-05');
    expect(result.rows[0].amount).toBe('15000.00');
    expect(result.rows[1].docNumber).toBe('2');
    expect(result.meta.rowsSkipped).toBeGreaterThanOrEqual(3);
    expect(result.openingBalance).toBe('5000.00');
    expect(result.closingBalance).toBe('24200.50');
  });

  it('пропускает строки без номера и данных', () => {
    const grid: Grid = [
      ['Номер', 'Дата', 'Сумма'],
      ['1', '05.03.2026', '1000'],
      ['', '', ''],
    ];
    const result = applyMapping(src(grid), mapping(), 'ours');
    expect(result.rows).toHaveLength(1);
  });

  it('fallback debit/credit если нет amount', () => {
    const grid: Grid = [
      ['Номер', 'Дата', 'Дебет', 'Кредит'],
      ['1', '05.03.2026', '15 000', ''],
      ['2', '06.03.2026', '', '4 200'],
    ];
    const m: ColumnMapping = {
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columns: { docNumber: 0, docDate: 1, amount: null, debit: 2, credit: 3 },
      confidence: 1,
      source: 'heuristic',
      reasoning: [],
    };
    const result = applyMapping(src(grid), m, 'ours');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].amount).toBe('15000.00');
    expect(result.rows[1].amount).toBe('4200.00');
    expect(result.assumptions.length).toBeGreaterThan(0);
  });
});
