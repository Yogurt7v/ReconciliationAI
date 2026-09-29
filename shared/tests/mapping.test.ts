/**
 * Правила раскладки колонок: какие поля обязательны для сверки.
 *
 * Здесь зафиксирована причина, по которой отдельная колонка «Сумма» не
 * обязательна: извлечение берёт первую непустую из amount/debit/credit,
 * поэтому типичный акт с колонками «Дебет»/«Кредит» разбирается сам.
 */

import { describe, expect, it } from 'vitest';

import { missingRequiredFields } from '../src/types.js';
import type { MappingFieldKey } from '../src/types.js';

function columns(over: Partial<Record<MappingFieldKey, number | null>> = {}) {
  return {
    docNumber: 0,
    docDate: 1,
    amount: 2,
    debit: null,
    credit: null,
    ...over,
  };
}

describe('missingRequiredFields', () => {
  it('полная раскладка — ничего не требует', () => {
    expect(missingRequiredFields(columns())).toEqual([]);
  });

  it('отсутствие «Суммы» не мешает, если есть дебет или кредит', () => {
    expect(missingRequiredFields(columns({ amount: null, debit: 2 }))).toEqual([]);
    expect(missingRequiredFields(columns({ amount: null, credit: 3 }))).toEqual([]);
    expect(missingRequiredFields(columns({ amount: null, debit: 2, credit: 3 }))).toEqual([]);
  });

  it('требует «Сумму», когда нет ни дебета, ни кредита', () => {
    expect(missingRequiredFields(columns({ amount: null }))).toEqual(['amount']);
  });

  it('требует номер и дату независимо от суммы', () => {
    expect(missingRequiredFields(columns({ docNumber: null, debit: 2 }))).toEqual(['docNumber']);
    expect(missingRequiredFields(columns({ docDate: null, debit: 2 }))).toEqual(['docDate']);
  });

  it('перечисляет все недостающие разом', () => {
    expect(
      missingRequiredFields(
        columns({ docNumber: null, docDate: null, amount: null, debit: null, credit: null }),
      ),
    ).toEqual(['docNumber', 'docDate', 'amount']);
  });
});
