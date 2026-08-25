/**
 * OCR-конвейер для сканированных PDF.
 *
 * pdf.js рендерит страницу в canvas (@napi-rs/canvas) с увеличением,
 * sharp приводит изображение к ч/б и выравнивает контраст, tesseract.js
 * (rus+eng) распознаёт слова с координатами. Из слов с bbox восстанавливается
 * сетка таблицы той же геометрией, что и у текстового PDF (tableGeometry).
 *
 * Результат: RawSource { kind: 'pdf-ocr' }.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';

import type { Grid, RawSource } from '@recon/shared';

import { loadPdfjs } from './pdfParser.js';
import { assignColumns, segmentsToGrid, trimGridEdges } from './tableGeometry.js';
import type { Segment } from './tableGeometry.js';

/* ------------------------------ Типы pdf.js ------------------------------- */

interface RenderPageLike {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  cleanup?(): void;
}

interface OcrDocLike {
  numPages: number;
  getPage(n: number): Promise<RenderPageLike>;
  destroy(): Promise<void>;
}

interface OcrInitParams {
  data: Uint8Array;
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  isEvalSupported?: boolean;
  useWorkerFetch?: boolean;
}

type OcrPdfModule = {
  getDocument(src: OcrInitParams): { promise: Promise<OcrDocLike> };
};

/* -------------------------------- Tesseract ------------------------------- */

export interface OcrWordBox {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Слова страницы, извлечённые из блоков tesseract */
function wordsFromTesseractPage(data: {
  blocks: Array<{
    paragraphs: Array<{
      lines: Array<{ words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }>;
    }>;
  }> | null;
}): OcrWordBox[] {
  const words: OcrWordBox[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text || word.confidence <= 0) continue;
          words.push({
            text,
            confidence: word.confidence,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
          });
        }
      }
    }
  }
  return words;
}

/**
 * Каталог кеша traineddata. Стабильный путь внутри backend (а не tmpdir),
 * чтобы данные скачивались один раз и переиспользовались; можно переопределить
 * через TESSDATA_DIR. Предзагрузка: `pnpm prepare-ocr`.
 */
export function tessdataDir(): string {
  return (
    process.env.TESSDATA_DIR ??
    fileURLToPath(new URL('../../.tessdata', import.meta.url))
  );
}

let workerPromise: Promise<{
  recognize(
    image: Buffer,
    options?: unknown,
    output?: { blocks: boolean },
  ): Promise<{ data: Parameters<typeof wordsFromTesseractPage>[0] }>;
  terminate(): Promise<unknown>;
}> | null = null;

/**
 * Один воркер tesseract на процесс (инициализация тяжёлая: загрузка
 * rus+eng traineddata в кеш).
 */
async function getOcrWorker() {
  workerPromise ??= (async () => {
    // tesseract.js пишет кеш через fs.writeFile и молча теряет данные,
    // если каталог не существует — создаём заранее
    const cachePath = tessdataDir();
    await fs.promises.mkdir(cachePath, { recursive: true });
    const { createWorker } = await import('tesseract.js');
    return createWorker('rus+eng', 1, {
      cachePath,
      logger: () => undefined,
    });
  })();
  return workerPromise;
}

/**
 * Прогрев OCR: гарантирует наличие rus+eng traineddata в кеше (скачивает,
 * если их нет) и закрывает временный воркер. Вызывается скриптом
 * scripts/prepare-ocr.ts и перед OCR-e2e тестами.
 */
export async function warmUpOcr(): Promise<{ dir: string; files: string[] }> {
  const worker = await getOcrWorker();
  await worker.terminate();
  workerPromise = null;
  const dir = tessdataDir();
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.traineddata'))
    : [];
  return { dir, files };
}

/* --------------------- Восстановление сетки из слов ----------------------- */

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Группировка слов в строки по вертикальному центру (скользящее среднее базы),
 * затем разбиение строк на ячейки по горизонтальным зазорам относительно
 * высоты текста. Чистая функция — тестируется без tesseract.
 */
export function buildPagesOfLinesFromWords(
  pagesOfWords: OcrWordBox[][],
): Segment[][][] {
  return pagesOfWords.map((words) => {
    if (words.length === 0) return [];

    const heights = words.map((w) => Math.max(1, w.y1 - w.y0));
    const medH = median(heights);

    const sorted = [...words].sort(
      (a, b) =>
        (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0,
    );

    const lines: OcrWordBox[][] = [];
    let current: OcrWordBox[] = [];
    let centerY = Number.NaN;

    for (const word of sorted) {
      const wc = (word.y0 + word.y1) / 2;
      if (!Number.isNaN(centerY) && Math.abs(wc - centerY) <= medH * 0.7) {
        current.push(word);
        centerY = (centerY * (current.length - 1) + wc) / current.length;
      } else {
        if (current.length > 0) lines.push(current);
        current = [word];
        centerY = wc;
      }
    }
    if (current.length > 0) lines.push(current);

    // Строка → ячейки: зазор больше ~0.8 высоты текста — граница колонки
    return lines.map((line) => {
      const ordered = [...line].sort((a, b) => a.x0 - b.x0);
      const segments: Segment[] = [];
      let buf: { x0: number; x1: number; text: string } | null = null;
      for (const word of ordered) {
        if (buf === null) {
          buf = { x0: word.x0, x1: word.x1, text: word.text };
          continue;
        }
        const gap = word.x0 - buf.x1;
        if (gap <= medH * 0.45) {
          buf.text += word.text; // склеенный фрагмент слова
        } else if (gap <= medH * 0.8) {
          buf.text += ` ${word.text}`; // соседние слова той же ячейки
        } else {
          segments.push({ ...buf, col: -1 });
          buf = { x0: word.x0, x1: word.x1, text: word.text };
        }
        buf.x1 = Math.max(buf.x1, word.x1);
      }
      if (buf !== null) segments.push({ ...buf, col: -1 });
      return segments;
    });
  });
}

/* ----------------------------- Рендер страницы ---------------------------- */

/** Масштаб рендера: ширина ~1800 px, но не меньше 2× и не больше 4× (для OCR) */
function zoomFor(baseWidth: number): number {
  if (baseWidth <= 0) return 3;
  return Math.min(4, Math.max(2, 1800 / baseWidth));
}

async function renderPageToPng(page: RenderPageLike): Promise<Buffer> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: zoomFor(base.width) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  const raw = await canvas.encode('png');

  // Предобработка: ч/б + растяжка контраста — заметно повышает точность OCR
  return sharp(raw).grayscale().normalise().png().toBuffer();
}

/* -------------------------------- Пайплайн -------------------------------- */

/**
 * Распознавание сканированного PDF. Вход: исходный буфер файла.
 * Возвращает RawSource с kind='pdf-ocr' и восстановленной сеткой.
 */
export async function parsePdfWithOcr(buffer: Buffer, fileName: string): Promise<RawSource> {
  const [pdfjs, worker] = await Promise.all([loadPdfjs(), getOcrWorker()]);
  const mod = pdfjs as unknown as OcrPdfModule;

  const doc = await mod.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;

  try {
    const pagesOfWords: OcrWordBox[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const png = await renderPageToPng(page);
      // В tesseract.js v6 блоки/слова по умолчанию отключены — запрашиваем явно
      const { data } = await worker.recognize(png, {}, { blocks: true });
      pagesOfWords.push(wordsFromTesseractPage(data));
      page.cleanup?.();
    }

    const pagesOfLines = buildPagesOfLinesFromWords(pagesOfWords);
    const assignment = assignColumns(pagesOfLines);
    const rows: string[][] = segmentsToGrid(pagesOfLines, assignment);
    const grid: Grid = trimGridEdges(rows, (v) => !v).map((row) =>
      row.map((text) => text || null),
    );

    return {
      grid,
      kind: 'pdf-ocr',
      fileName,
      sheetName: null,
      pages: doc.numPages,
      needsOcr: false,
    };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
