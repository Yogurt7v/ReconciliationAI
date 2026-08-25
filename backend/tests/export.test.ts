/**
 * Тесты экспорта отчёта: HTML (структура + экранирование), XLSX
 * (обратное чтение SheetJS), PDF (сигнатура файла; требует кириллический
 * шрифт в системе, иначе тест пропускается).
 */

import fs from 'node:fs';

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { buildHtmlReport } from '../src/services/export/htmlReport.js';
import { buildXlsxReport } from '../src/services/export/xlsxReport.js';
import { buildPdfReport, findCyrillicFont } from '../src/services/export/pdfReport.js';
import type { ReconciliationReport } from '@recon/shared';

function fakeReport(): ReconciliationReport {
  return {
    id: 'job-test',
    createdAt: '2026-08-25T10:00:00.000Z',
    sides: {
      ours: {
        fileName: 'наши.xlsx',
        kind: 'excel',
        sheetName: 'Sheet1',
        pages: null,
        rowsExtracted: 3,
        rowsSkipped: 1,
      },
      partner: {
        fileName: 'их.pdf',
        kind: 'pdf-text',
        sheetName: null,
        pages: 2,
        rowsExtracted: 2,
        rowsSkipped: 0,
      },
    },
    period: { from: '2026-03-01', to: '2026-03-31' },
    summary: {
      ourTotal: 3,
      partnerTotal: 2,
      matched: 1,
      onlyOurs: 1,
      onlyPartner: 1,
      amountMismatches: 1,
      dateMismatches: 1,
      balanceIssues: 2,
    },
    onlyOurs: [{ docNumber: '<b>77</b>', docDate: '2026-03-05', amount: '450.00', sourceRowIndex: 11 }],
    onlyPartner: [{ docNumber: '9', docDate: '2026-03-09', amount: '700.00', sourceRowIndex: 5 }],
    amountMismatches: [
      {
        docNumber: '1',
        docDateOurs: '2026-03-05',
        docDatePartner: '2026-03-05',
        ourAmount: '15000.00',
        partnerAmount: '10000.00',
        difference: '5000.00',
        direction: 'they_owe',
        dateMismatch: false,
      },
    ],
    dateMismatches: [
      { docNumber: '2', ourDate: '2026-03-06', partnerDate: '2026-03-08', amount: '2500.00' },
    ],
    balanceChecks: [
      { key: 'openingBalance', label: 'Сальдо на начало', ours: '100.00', partner: '100.00', status: 'match' },
      { key: 'closingBalance', label: 'Сальдо на конец', ours: '5050.00', partner: '350.00', status: 'mismatch' },
    ],
    totals: { onlyOursSum: '450.00', onlyPartnerSum: '700.00', mismatchSum: '5000.00' },
    finalBalance: {
      amount: '4750.00',
      direction: 'they_owe',
      explanation: 'Итоговая разница складывается из расхождений позиций.',
    },
    hypotheses: [
      { scope: 'doc', docNumber: '1', text: 'Возможна частичная оплата.', recommendation: 'Сверить платежи.' },
    ],
    aiLogic: [
      {
        id: 's1',
        stage: 'parsing',
        title: 'Файлы разобраны',
        detail: 'Excel и текстовый PDF.',
        confidence: 0.9,
        createdAt: '2026-08-25T10:00:01.000Z',
      },
    ],
  };
}

describe('buildHtmlReport', () => {
  it('содержит ключевые секции и русские форматы сумм', () => {
    const html = buildHtmlReport(fakeReport());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Отчёт о сверке расчётов');
    expect(html).toContain('4\u2009750,00');
    expect(html).toContain('контрагент должен нам');
    expect(html).toContain('Возможна частичная оплата.');
    expect(html).toContain('Логика AI');
  });

  it('экранирует HTML в данных из файлов', () => {
    const html = buildHtmlReport(fakeReport());
    expect(html).toContain('&lt;b&gt;77&lt;/b&gt;');
    expect(html).not.toContain('<b>77</b>');
  });
});

describe('buildXlsxReport', () => {
  it('формирует книгу с ожидаемыми листами и данными', async () => {
    const buf = await buildXlsxReport(fakeReport());
    const wb = XLSX.read(buf, { type: 'buffer' });

    expect(wb.SheetNames).toContain('Сводка');
    expect(wb.SheetNames).toContain('Расхождения сумм');
    expect(wb.SheetNames).toContain('Только у нас');

    // На листе расхождений есть наш документ с суммами
    const sheet = wb.Sheets['Расхождения сумм']!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const flat = rows.flat().map(String);
    expect(flat.some((v) => v.includes('15000'))).toBe(true);
    expect(flat.some((v) => v.includes('10000'))).toBe(true);
  });
});

const fontPath = findCyrillicFont();

describe.skipIf(fontPath === null)('buildPdfReport', () => {
  it('создаёт валидный PDF', async () => {
    if (!fontPath) return;
    const buf = await buildPdfReport(fakeReport());
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1500);

    const outPath = '/tmp/recon-report-test.pdf';
    fs.writeFileSync(outPath, buf);
    expect(fs.statSync(outPath).size).toBe(buf.length);
  });
});

describe('findCyrillicFont / PdfFontError', () => {
  it('без шрифта экспорт падает с понятной ошибкой', async () => {
    if (fontPath !== null) return; // на машине шрифт есть — правило не проверить
    await expect(buildPdfReport(fakeReport())).rejects.toThrow(/PDF_FONT_PATH/);
  });
});
