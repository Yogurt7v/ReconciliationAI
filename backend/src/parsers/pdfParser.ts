/**
 * Парсер текстовых PDF на базе pdf.js (pdfjs-dist, legacy-сборка для Node).
 *
 * Конвейер:
 *  1. Извлекаем текстовые элементы с координатами (transform → x/y, width/height).
 *  2. Кластеризуем элементы в строки по базовой линии Y (устойчиво к дроблению
 *     текста на куски — типично для генераторов PDF).
 *  3. Внутри строки склеиваем соседние элементы в ячейки по ширине пробела,
 *    а колонки выравниваем между строками и страницами методом интервалов:
 *    каждая ячейка — отрезок [x0, x1], колонка — объединение перекрывающихся
 *    отрезков. Это переживает выключку чисел вправо и разные шапки страниц.
 *  4. Считаем символы на страницу: меньше OCR_MIN_CHARS_PER_PAGE — это скан,
 *    ставим needsOcr, дальше файл уходит в OCR-конвейер.
 */

import { createRequire } from 'node:module';

import { OCR_MIN_CHARS_PER_PAGE } from '@recon/shared';
import type { AiStructuredResult, CellValue, Grid, RawSource } from '@recon/shared';

import { assignColumns, segmentsToGrid, trimGridEdges } from './tableGeometry.js';
import type { Segment } from './tableGeometry.js';
import { looksTwoSided, parseTwoSidedPdf } from '../services/ai/structuredParse.js';
import type { AiConfig } from '../services/ai/client.js';

const require = createRequire(import.meta.url);

/* ------------------------- Минимальные типы pdf.js ------------------------ */

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface PdfPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?(): void;
}

interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}

interface PdfInitParams {
  data: Uint8Array;
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  isEvalSupported?: boolean;
  useWorkerFetch?: boolean;
}

type PdfModule = {
  getDocument(src: PdfInitParams): { promise: Promise<PdfDocLike> };
};

let pdfjsPromise: Promise<PdfModule> | null = null;

/** Ленивая загрузка pdf.js (тяжёлый модуль нужен не каждому запросу). Переиспользуется OCR-конвейером. */
export function loadPdfjs(): Promise<PdfModule> {
  pdfjsPromise ??= (async () => {
    const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return mod as unknown as PdfModule;
  })();
  return pdfjsPromise;
}

/** URL ресурсов внутри пакета pdfjs-dist (cMap для кириллицы, стандартные шрифты) */
export function pdfjsAssetDir(subdir: 'cmaps' | 'standard_fonts'): string | undefined {
  try {
    const entry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs') as string;
    const marker = 'legacy/build/';
    const cut = entry.indexOf(marker);
    if (cut < 0) return undefined;
    return new URL(`${subdir}/`, `file://${entry.slice(0, cut)}`).href;
  } catch {
    return undefined;
  }
}

/* ------------------------------ Геометрия -------------------------------- */

interface PositionedItem extends PdfTextItem {
  x: number;
  y: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Группировка элементов в визуальные строки по базовой линии Y */
function clusterLines(items: PositionedItem[]): PositionedItem[][] {
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const heights = sorted.map((it) => (it.height > 0 ? it.height : 10));
  const tol = Math.min(8, Math.max(1.5, median(heights) * 0.7));

  const lines: PositionedItem[][] = [];
  let current: PositionedItem[] = [];
  let currentY = Number.NaN;

  for (const item of sorted) {
    if (!Number.isNaN(currentY) && Math.abs(item.y - currentY) <= tol) {
      current.push(item);
      // Скользящее среднее базы — строки с лёгким наклоном не рвутся
      currentY = (currentY * (current.length - 1) + item.y) / current.length;
    } else {
      if (current.length > 0) lines.push(current);
      current = [item];
      currentY = item.y;
    }
  }
  if (current.length > 0) lines.push(current);
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Склейка элементов строки в ячейки: зазор до ~ширины пробела — та же ячейка
 * (дроблённый текст), большой зазор — новая ячейка.
 */
function lineToSegments(line: PositionedItem[]): Segment[] {
  const segments: Segment[] = [];
  let buf: { x0: number; x1: number; text: string } | null = null;

  const avgChar = (it: PositionedItem): number => {
    if (it.str.length > 0 && it.width > 0) return it.width / it.str.length;
    return it.height > 0 ? it.height * 0.5 : 5;
  };

  for (const item of line) {
    const text = item.str.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    if (buf === null) {
      buf = { x0: item.x, x1: item.x + item.width, text };
      continue;
    }
    const charW = avgChar(item);
    const gap = item.x - buf.x1;
    const joinSameWord = gap <= Math.max(1.0, charW * 1.1);
    const joinWithSpace = gap <= Math.max(4, charW * 2.4);

    if (joinSameWord) {
      buf.text += text;
    } else if (joinWithSpace) {
      buf.text += ` ${text}`;
    } else {
      segments.push({ ...buf, col: -1 });
      buf = { x0: item.x, x1: item.x + item.width, text };
    }
    buf.x1 = Math.max(buf.x1, item.x + item.width);
  }
  if (buf !== null) segments.push({ ...buf, col: -1 });
  return segments;
}

/* --------------------- Унификация колонок по страницам ------------------- */

/* Перенесено в tableGeometry.ts (общий код с OCR-конвейером) */

/* ------------------------------- Парсинг --------------------------------- */

function isTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof (item as PdfTextItem).str === 'string'
  );
}

/**
 * Разбор текстового PDF в сетку. Если символов на страницу мало —
 * возвращает needsOcr: true (сетка при этом почти пустая).
 */
export async function parsePdf(buffer: Buffer, fileName: string): Promise<RawSource> {
  const pdfjs = await loadPdfjs();
  const cMapUrl = pdfjsAssetDir('cmaps');
  const standardFontDataUrl = pdfjsAssetDir('standard_fonts');

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), // копия: pdf.js может «забрать» буфер себе
    ...(cMapUrl ? { cMapUrl, cMapPacked: true } : {}),
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;

  try {
    // страница → строка → ячейки-сегменты
    const pagesOfLines: Segment[][][] = [];
    const charsPerPage: number[] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();

      let pageChars = 0;
      const items: PositionedItem[] = [];
      for (const raw of content.items) {
        if (!isTextItem(raw)) continue;
        pageChars += raw.str.replace(/\s+/g, '').length;
        if (!raw.str.trim()) continue;
        items.push({
          ...raw,
          x: raw.transform[4] ?? 0,
          y: raw.transform[5] ?? 0,
        });
      }
      charsPerPage.push(pageChars);

      pagesOfLines.push(clusterLines(items).map((line) => lineToSegments(line)));
      page.cleanup?.();
    }

    const avgChars =
      charsPerPage.length > 0
        ? charsPerPage.reduce((a, b) => a + b, 0) / charsPerPage.length
        : 0;
    const needsOcr = avgChars < OCR_MIN_CHARS_PER_PAGE;

    if (needsOcr) {
      // Скан: содержимого нет, сетка не строится — дальше OCR
      return {
        grid: [],
        kind: 'pdf-text',
        fileName,
        sheetName: null,
        pages: doc.numPages,
        needsOcr: true,
      };
    }

    const assignment = assignColumns(pagesOfLines);

    const rows: string[][] = segmentsToGrid(pagesOfLines, assignment);
    return {
      grid: trimGridEdges(rows, (v) => !v),
      kind: 'pdf-text',
      fileName,
      sheetName: null,
      pages: doc.numPages,
      needsOcr: false,
    };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/* ---------------------- Двусторонний парсинг (AI) ------------------------- */

/** Конвертирует Grid обратно в текст для передачи AI */
function gridToText(grid: Grid): string {
  return grid.map((row) => row.map((v) => (v === null || v === undefined) ? '' : String(v)).join('\t')).join('\n');
}

/**
 * Пытается распарсить двухсторонний акт сверки через AI.
 *
 * Логика:
 *  1. Извлекаем текст из PDF (через существующий parsePdf → grid → text).
 *  2. Проверяем эвристику looksTwoSided.
 *  3. Если двухсторонний формат обнаружен ИЛИ twoSided=true — вызываем AI.
 *  4. При ошибке/неудаче — возвращаем null (fallback на стандартный пайплайн).
 */
export async function detectTwoSidedPdf(
  buffer: Buffer,
  fileName: string,
  aiConfig: AiConfig,
  twoSidedRequested: boolean,
): Promise<AiStructuredResult | null> {
  const source = await parsePdf(buffer, fileName);

  if (source.needsOcr || source.grid.length === 0) return null;

  const text = gridToText(source.grid);

  if (!twoSidedRequested && !looksTwoSided(text)) return null;

  return parseTwoSidedPdf(aiConfig, text, fileName);
}
