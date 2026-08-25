/**
 * Тесты OCR-конвейера: восстановление сетки из слов с координатами.
 * Полный прогон tesseract вынесен в opt-in тест (RUN_OCR_E2E=1),
 * т.к. при первом запуске требует скачивания traineddata.
 */

import { describe, expect, it } from 'vitest';

import { assignColumns, segmentsToGrid, trimGridEdges } from '../src/parsers/tableGeometry.js';
import { buildPagesOfLinesFromWords } from '../src/parsers/ocrPipeline.js';
import type { OcrWordBox } from '../src/parsers/ocrPipeline.js';

function word(text: string, x0: number, y0: number, w = 40, h = 12): OcrWordBox {
  return { text, confidence: 90, x0, y0, x1: x0 + w, y1: y0 + h };
}

describe('buildPagesOfLinesFromWords + геометрия', () => {
  it('восстанавливает таблицу из слов одной страницы', () => {
    const words: OcrWordBox[] = [
      word('№', 20, 100),
      word('Дата', 200, 100),
      word('Сумма', 400, 100),
      // числа выключены вправо: начало зависит от длины
      word('1', 30, 130, 10),
      word('05.03.2026', 190, 130, 80),
      word('15 000,00', 340, 130, 100),
      word('2', 30, 160, 10),
      word('06.03.2026', 190, 160, 80),
      word('420,50', 380, 160, 60),
    ];

    const pagesOfLines = buildPagesOfLinesFromWords([words]);
    expect(pagesOfLines[0]!.length).toBe(3);

    const assignment = assignColumns(pagesOfLines);
    const rows = segmentsToGrid(pagesOfLines, assignment);
    const grid = trimGridEdges(rows, (v) => !v);

    expect(grid.length).toBe(3);
    expect(grid[0]).toEqual(['№', 'Дата', 'Сумма']);
    expect(grid[1]).toEqual(['1', '05.03.2026', '15 000,00']);
    expect(grid[2]).toEqual(['2', '06.03.2026', '420,50']);
  });

  it('склеивает разорванные фрагменты слова и разделяет близкие слова ячейки', () => {
    // «15» и «000,00» почти вплотную — одна ячейка; «от» и «25.03» с малым зазором
    const words: OcrWordBox[] = [
      word('Документ от', 20, 50, 120),
      word('25.03', 150, 50, 45),
      word('15', 400, 50, 22),
      word('000,00', 424, 50, 58),
    ];
    const pagesOfLines = buildPagesOfLinesFromWords([words]);
    const assignment = assignColumns(pagesOfLines);
    const [row] = segmentsToGrid(pagesOfLines, assignment);

    expect(row!.some((c) => c.replace(/\s/g, '') === '15000,00')).toBe(true);
    expect(row!.some((c) => c.includes('25.03'))).toBe(true);
  });

  it('унифицирует колонки между страницами', () => {
    const page1 = [
      word('No', 20, 100),
      word('Sum', 300, 100),
      word('A-1', 20, 130),
      word('100.00', 280, 130, 80),
    ];
    const page2 = [
      word('B-2', 20, 100),
      word('250.75', 270, 100, 90),
    ];
    const pagesOfLines = buildPagesOfLinesFromWords([page1, page2]);
    const assignment = assignColumns(pagesOfLines);
    const rows = segmentsToGrid(pagesOfLines, assignment);

    // Страница 1: шапка + строка; страница 2: одна строка
    expect(rows.length).toBe(3);
    expect(rows[1]).toEqual(['A-1', '100.00']);
    expect(rows[2]).toEqual(['B-2', '250.75']);
  });

  it('пустая страница не ломает пайплайн', () => {
    const pagesOfLines = buildPagesOfLinesFromWords([[], []]);
    const assignment = assignColumns(pagesOfLines);
    const rows = segmentsToGrid(pagesOfLines, assignment);
    expect(rows).toEqual([]);
  });

  it('титульная строка не поглощает соседние колонки (регрессия)', () => {
    // Титул — единственный сегмент строки с широким интервалом; он не должен
    // создавать колонку, в которую «проваливаются» ячейки данных.
    const words: OcrWordBox[] = [
      word('АКТ СВЕРКИ взаимных расчётов за март 2026 года', 20, 40, 400),
      word('№', 20, 100, 20),
      word('Дата', 200, 100, 60),
      word('Сумма', 400, 100, 80),
      word('101', 25, 130, 15),
      word('05.03.2026', 200, 130, 70),
      word('15000,00', 410, 130, 60),
    ];
    const pagesOfLines = buildPagesOfLinesFromWords([words]);
    const assignment = assignColumns(pagesOfLines);
    const rows = segmentsToGrid(pagesOfLines, assignment);
    const grid = trimGridEdges(rows, (v) => !v);

    expect(grid.length).toBe(3);
    // Титул занимает одну ячейку своей строки и не смешивается с данными
    expect(grid[0]!.filter(Boolean)).toEqual(['АКТ СВЕРКИ взаимных расчётов за март 2026 года']);
    expect(grid[1]).toEqual(['№', 'Дата', 'Сумма']);
    expect(grid[2]).toEqual(['101', '05.03.2026', '15000,00']);
  });
});

describe.skipIf(!process.env.RUN_OCR_E2E)('parsePdfWithOcr (интеграция, RUN_OCR_E2E=1)', () => {
  it('распознаёт простой скан таблицы', async () => {
    const PDFDocument = require('pdfkit') as typeof import('pdfkit');
    const { createCanvas } = await import('@napi-rs/canvas');
    const { parsePdfWithOcr } = await import('../src/parsers/ocrPipeline.js');

    // Готовим картинку-«скан» с таблицей
    const canvas = createCanvas(600, 200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 200);
    ctx.fillStyle = '#000000';
    ctx.font = '16px sans-serif';
    const lines: Array<[string, number]> = [
      ['No     Amount', 20],
      ['A-1    100.00', 50],
      ['B-2    250.75', 80],
    ];
    for (const [text, y] of lines) ctx.fillText(text, 20, y);

    // Оборачиваем PNG в одностраничный PDF через pdfkit (image)
    const pdfDoc = new PDFDocument({ size: [612, 792], margin: 0 });
    const chunks: Buffer[] = [];
    pdfDoc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => pdfDoc.on('end', () => resolve()));
    pdfDoc.image(await canvas.encode('png'), 0, 0, { width: 612 });
    pdfDoc.end();
    await done;
    const pdf = Buffer.concat(chunks);

    const source = await parsePdfWithOcr(pdf, 'scan.pdf');
    expect(source.kind).toBe('pdf-ocr');
    expect(source.grid.length).toBeGreaterThanOrEqual(2);
  });
});
