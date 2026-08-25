/**
 * Тесты PDF-парсера: генерируем контрольные PDF через pdfkit
 * и проверяем восстановление сетки, склейку страниц и детект скана.
 *
 * Важно: порог OCR_MIN_CHARS_PER_PAGE = 120 символов на страницу,
 * поэтому «текстовые» тестовые таблицы должны быть достаточно плотными,
 * иначе парсер справедливо сочтёт их сканом.
 */

import { describe, expect, it } from 'vitest';

import { parsePdf } from '../src/parsers/pdfParser.js';
import type { Grid } from '@recon/shared';

function makePdf(draw: (doc: import('pdfkit').PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const PDFDocument = require('pdfkit') as typeof import('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

/** Таблица в фиксированных колонках: текст кладётся по абсолютным координатам */
function drawTable(doc: import('pdfkit').PDFDocument, rows: string[][], top = 60): void {
  const cols = [40, 150, 260, 380];
  rows.forEach((row, ri) => {
    row.forEach((text, ci) => {
      if (text !== '') doc.text(text, cols[ci]!, top + ri * 20, { lineBreak: false });
    });
  });
}

function sampleRows(count: number, from = 1): string[][] {
  const rows: string[][] = [['No', 'Date', 'Amount', 'Item']];
  for (let i = from; i < from + count; i++) {
    rows.push([String(i), '2026-03-05', `${(i * 137) % 900}.${(i * 13) % 100 < 10 ? '0' : ''}${(i * 13) % 100}`, `Item-${i}`]);
  }
  return rows;
}

describe('parsePdf', () => {
  it('восстанавливает таблицу из одной страницы', async () => {
    const rows = sampleRows(8);
    const pdf = await makePdf((doc) => drawTable(doc, rows));
    const source = await parsePdf(pdf, 'test.pdf');

    expect(source.kind).toBe('pdf-text');
    expect(source.pages).toBe(1);
    expect(source.needsOcr).toBe(false);
    expect(source.grid.length).toBe(rows.length);
    // Каждое значение попадает в свою колонку, порядок строк сверху вниз
    for (let r = 0; r < rows.length; r++) {
      expect(source.grid[r]).toEqual(rows[r]);
    }
  });

  it('склеивает страницы в одну сетку с общими колонками', async () => {
    const page1 = sampleRows(7);
    const page2 = sampleRows(6, 100);
    const pdf = await makePdf((doc) => {
      drawTable(doc, page1);
      doc.addPage();
      drawTable(doc, page2, 60);
    });
    const source = await parsePdf(pdf, 'multi.pdf');

    expect(source.pages).toBe(2);
    expect(source.needsOcr).toBe(false);
    expect(source.grid.length).toBe(page1.length + page2.length);
    // Колонки унифицированы: значения второй страницы в тех же колонках
    const grid = source.grid as Grid;
    expect(grid[0]![0]).toBe('No');
    expect(grid[1]![0]).toBe('1');
    // Вторая страница начинается с повторной шапки, за ней данные
    expect(grid[page1.length]![0]).toBe('No');
    expect(grid[page1.length]![1]).toBe('Date');
    expect(grid[page1.length + 1]![0]).toBe('100');
    expect(grid[page1.length + 1]![1]).toBe('2026-03-05');
  });

  it('помечает как скан PDF почти без текста', async () => {
    const pdf = await makePdf((doc) => {
      doc.text('OK', 40, 40, { lineBreak: false });
    });
    const source = await parsePdf(pdf, 'scan.pdf');

    expect(source.needsOcr).toBe(true);
    expect(source.grid.length).toBe(0);
  });

  it('дроблённый на куски текст склеивается обратно в ячейку', async () => {
    const pdf = await makePdf((doc) => {
      doc.font('Helvetica').fontSize(10);
      // «12 345,67» одним значением, но тремя вызовами с малым зазором
      doc.text('INV-1', 40, 60, { lineBreak: false });
      doc.text('12', 300, 60, { lineBreak: false });
      doc.text('345,', 314, 60, { lineBreak: false });
      doc.text('67', 334, 60, { lineBreak: false });
      // Наполнитель, чтобы страница не считалась сканом
      for (let i = 0; i < 6; i++) {
        doc.text(`Filler row ${i} with several extra words here`, 40, 110 + i * 18, {
          lineBreak: false,
        });
      }
    });
    const source = await parsePdf(pdf, 'split.pdf');

    expect(source.needsOcr).toBe(false);
    expect(source.grid.length).toBeGreaterThanOrEqual(7);
    const firstLine = source.grid[0]!.filter(Boolean).join('|');
    expect(firstLine).toContain('INV-1');
    expect(firstLine).toContain('12345,67');
  });
});
