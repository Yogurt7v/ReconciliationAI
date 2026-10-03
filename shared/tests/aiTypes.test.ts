/**
 * Расширение AI-типов провайдером и фактически применённой моделью.
 *
 * Проверяются две вещи, и обе живут на уровне типов, а не значений:
 * поля `provider` / `model` / `effectiveModel` существуют и принимают значения,
 * а объектный литерал, в котором их нет, по-прежнему компилируется — иначе
 * локальный путь `toStatus` и `buildReport` пришлось бы править, а он обязан
 * остаться нетронутым. `tsconfig` пакета включает `tests`, поэтому отрицательные
 * проверки через `@ts-expect-error` проверяет и `pnpm typecheck`.
 */

import { describe, expect, it } from 'vitest';

import type { AiDebugInfo, AiProvider, JobStatus, ReconciliationReport } from '../src/types.js';

const PROVIDERS: readonly AiProvider[] = ['ollama', 'openrouter'];

function debugInfo(over: Partial<AiDebugInfo> = {}): AiDebugInfo {
  return {
    model: 'qwen2.5:7b-instruct',
    httpStatus: 200,
    contentLength: 120,
    errorMessage: null,
    rawPreview: null,
    attempts: 1,
    ...over,
  };
}

function jobStatus(over: Partial<JobStatus> = {}): JobStatus {
  return {
    id: 'job-1',
    stage: 'analysis',
    progress: 0.8,
    message: 'Сверка',
    error: null,
    pendingConfirmation: null,
    reportReady: false,
    reasoningLog: [],
    files: { ours: 'a.xlsx', partner: 'b.xlsx' },
    ...over,
  };
}

function report(over: Partial<ReconciliationReport> = {}): ReconciliationReport {
  return {
    id: 'rep-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    sides: {
      ours: {
        fileName: 'a.xlsx',
        kind: 'excel',
        sheetName: null,
        pages: null,
        rowsExtracted: 0,
        rowsSkipped: 0,
      },
      partner: {
        fileName: 'b.pdf',
        kind: 'pdf-text',
        sheetName: null,
        pages: 2,
        rowsExtracted: 0,
        rowsSkipped: 0,
      },
    },
    period: { from: null, to: null },
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
    onlyOurs: [],
    onlyPartner: [],
    amountMismatches: [],
    dateMismatches: [],
    balanceChecks: [],
    totals: { onlyOursSum: '0', onlyPartnerSum: '0', mismatchSum: '0' },
    finalBalance: { amount: '0', direction: 'even', explanation: '—' },
    hypotheses: [],
    aiLogic: [],
    ...over,
  };
}

describe('AiProvider', () => {
  it('называет ровно двух провайдеров: локальный и удалённый', () => {
    expect(PROVIDERS).toEqual(['ollama', 'openrouter']);
  });

  it('не принимает стороннего провайдера', () => {
    // @ts-expect-error — 'anthropic' не входит в union
    const wrong: AiProvider = 'anthropic';
    expect(wrong).toBe('anthropic');
  });
});

describe('AiDebugInfo', () => {
  it('принимает провайдера и фактически применённую модель', () => {
    const info = debugInfo({ provider: 'openrouter', effectiveModel: 'a/b:free' });
    expect(info.provider).toBe('openrouter');
    expect(info.effectiveModel).toBe('a/b:free');
  });

  it('различает запрошенную и фактически применённую модель', () => {
    const info = debugInfo({ model: 'a/b', provider: 'openrouter', effectiveModel: 'c/d' });
    expect(info.model).toBe('a/b');
    expect(info.effectiveModel).toBe('c/d');
  });

  it('допускает null, когда ответ не сообщил имени модели', () => {
    expect(debugInfo({ effectiveModel: null }).effectiveModel).toBeNull();
  });

  it('остаётся собираемым без новых полей — локальный путь не меняется', () => {
    const info: AiDebugInfo = {
      model: 'qwen2.5:7b-instruct',
      httpStatus: null,
      contentLength: 0,
      errorMessage: 'Ошибка',
      rawPreview: null,
      attempts: 2,
    };
    expect(info.provider).toBeUndefined();
    expect(info.effectiveModel).toBeUndefined();
  });
});

describe('JobStatus', () => {
  it('принимает фактически применённую модель', () => {
    expect(jobStatus({ effectiveModel: 'a/b' }).effectiveModel).toBe('a/b');
  });

  it('остаётся собираемым без новых полей — toStatus не требует правок', () => {
    const status: JobStatus = {
      id: 'job-2',
      stage: 'done',
      progress: 1,
      message: 'Готово',
      error: null,
      pendingConfirmation: null,
      reportReady: true,
      reasoningLog: [],
      files: { ours: 'a.xlsx', partner: 'b.pdf' },
    };
    expect(status.effectiveModel).toBeUndefined();
  });
});

describe('ReconciliationReport', () => {
  it('принимает модель и провайдера, обработавших документ', () => {
    const built = report({ model: 'a/b:free', provider: 'openrouter' });
    expect(built.model).toBe('a/b:free');
    expect(built.provider).toBe('openrouter');
  });

  it('остаётся собираемым без новых полей — buildReport не требует правок', () => {
    const local = report();
    expect(local.model).toBeUndefined();
    expect(local.provider).toBeUndefined();
  });

  it('не принимает провайдера вне union', () => {
    // @ts-expect-error — 'anthropic' не входит в union
    const built: ReconciliationReport = report({ provider: 'anthropic' });
    expect(built.provider).toBe('anthropic');
  });
});
