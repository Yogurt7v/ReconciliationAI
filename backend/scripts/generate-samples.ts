/**
 * Генератор демонстрационных пар файлов для ручной проверки и smoke-прогонов.
 *
 * Сценарии (наш файл всегда xlsx, контрагент варьируется):
 *  1. ideal          — полные совпадения;
 *  2. amount         — у одного документа сумма отличается на 5 000;
 *  3. dates          — у одного документа дата сдвинута;
 *  4. missing        — у нас есть документ, которого нет у контрагента;
 *  5. pdf-text       — контрагент прислал текстовый PDF (pdfkit + системный TTF);
 *  6. pdf-scan       — «скан»: таблица рисуется на canvas и вклеивается картинкой
 *                      (распознаётся OCR-конвейером; tessdata скачивается при первом
 *                      распознавании).
 *
 * Запуск: pnpm samples (файлы в backend/samples/). PDF-сценарии требуют TTF
 * с кириллицей — при отсутствии шрифта они пропускаются с предупреждением.
 */

import fs from 'node:fs';
import path from 'node:path';

import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';

export interface DocRow {
  num: string;
  date: string; // дд.мм.гггг
  amount: number;
  title: string;
}

const BASE_DOCS: DocRow[] = [
  { num: '101', date: '05.03.2026', amount: 15000, title: 'Оплата за отгрузку' },
  { num: '102', date: '07.03.2026', amount: 4200.5, title: 'Отгрузка по счёту' },
  { num: '103', date: '12.03.2026', amount: 78000, title: 'Оплата за отгрузку' },
  { num: '104', date: '18.03.2026', amount: 12500.75, title: 'Доп. работы' },
  { num: '105', date: '24.03.2026', amount: 9900, title: 'Оплата за отгрузку' },
];

const HEADER = ['№', 'Дата', 'Сумма, руб.', 'Назначение'];

/** Таблица акта: титул, пустая строка, шапка, данные, итоги/сальдо */
function actRows(docs: DocRow[]): unknown[][] {
  const rows: unknown[][] = [
    [`АКТ СВЕРКИ взаимных расчётов за март 2026 г.`],
    [],
    HEADER,
    ...docs.map((d) => [d.num, d.date, d.amount.toFixed(2).replace('.', ','), d.title]),
    [],
    ['Сальдо на начало периода', null, null],
    ['Обороты за период', null, null],
    ['Сальдо на конец периода', null, null],
  ];
  return rows;
}

function writeXlsx(filePath: string, rows: unknown[][]): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Акт');
  XLSX.writeFile(wb, filePath);
}

/* ---------------------------------- PDF ----------------------------------- */

const COLS_PDF = [40, 150, 280, 420];
const TOP_PDF = 90;

function drawActText(doc: PDFKit.PDFDocument, docs: DocRow[], font: string): void {
  doc.font(font).fontSize(14).text('АКТ СВЕРКИ взаимных расчётов за март 2026 г.', 40, 50);
  doc.fontSize(10);
  HEADER.forEach((h, i) => doc.text(h, COLS_PDF[i]!, TOP_PDF, { lineBreak: false }));
  docs.forEach((d, ri) => {
    const y = TOP_PDF + 24 + ri * 20;
    doc.text(d.num, COLS_PDF[0]!, y, { lineBreak: false });
    doc.text(d.date, COLS_PDF[1]!, y, { lineBreak: false });
    doc.text(`${d.amount.toFixed(2).replace('.', ',')} руб.`, COLS_PDF[2]!, y, { lineBreak: false });
    doc.text(d.title, COLS_PDF[3]!, y, { lineBreak: false });
  });
}

async function makePdfBuffer(
  render: (doc: PDFKit.PDFDocument) => Promise<void> | void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    void Promise.resolve(render(doc)).catch(reject).finally(() => doc.end());
  });
}

/** Поиск TTF с кириллицей (та же логика, что в pdf-экспорте отчёта) */
function findFont(): string | null {
  const candidates = [
    ...(process.env.PDF_FONT_PATH ? [process.env.PDF_FONT_PATH] : []),
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
    '/System/Library/Fonts/Supplemental/Verdana.ttf',
    '/Library/Fonts/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* пропускаем */
    }
  }
  return null;
}

/* ------------------------------- Сценарии --------------------------------- */

export interface SamplePair {
  name: string;
  oursFile: string;
  partnerFile: string;
  /** Ожидание для smoke: количество совпавших пар */
  expectMatched: number;
  expectAmountMismatches?: number;
  expectDateMismatches?: number;
  expectOnlyOurs?: number;
  expectEvenBalance?: boolean;
  expectDirection?: 'they_owe' | 'we_owe';
}

export function buildScenarios(outDir: string): { pairs: SamplePair[]; skippedPdfScan: boolean } {
  fs.mkdirSync(outDir, { recursive: true });
  const pairs: SamplePair[] = [];

  // 1. Идеальное совпадение
  {
    const ours = path.join(outDir, 'ideal-ours.xlsx');
    const partner = path.join(outDir, 'ideal-partner.xlsx');
    writeXlsx(ours, actRows(BASE_DOCS));
    writeXlsx(partner, actRows(BASE_DOCS));
    pairs.push({
      name: 'ideal',
      oursFile: ours,
      partnerFile: partner,
      expectMatched: BASE_DOCS.length,
      expectEvenBalance: true,
    });
  }

  // 2. Расхождение сумм: документ 103 у контрагента на 5 000 меньше
  {
    const theirs = BASE_DOCS.map((d) =>
      d.num === '103' ? { ...d, amount: d.amount - 5000 } : d,
    );
    const ours = path.join(outDir, 'amount-ours.xlsx');
    const partner = path.join(outDir, 'amount-partner.xlsx');
    writeXlsx(ours, actRows(BASE_DOCS));
    writeXlsx(partner, actRows(theirs));
    pairs.push({
      name: 'amount',
      oursFile: ours,
      partnerFile: partner,
      expectMatched: BASE_DOCS.length,
      expectAmountMismatches: 1,
      expectDirection: 'they_owe',
    });
  }

  // 3. Расхождение дат: документ 105 сдвинут на неделю
  {
    const theirs = BASE_DOCS.map((d) => (d.num === '105' ? { ...d, date: '31.03.2026' } : d));
    const ours = path.join(outDir, 'dates-ours.xlsx');
    const partner = path.join(outDir, 'dates-partner.xlsx');
    writeXlsx(ours, actRows(BASE_DOCS));
    writeXlsx(partner, actRows(theirs));
    pairs.push({
      name: 'dates',
      oursFile: ours,
      partnerFile: partner,
      expectMatched: BASE_DOCS.length,
      expectDateMismatches: 1,
      expectEvenBalance: true,
    });
  }

  // 4. Отсутствующий документ: у нас есть 106, у контрагента нет
  {
    const extra: DocRow = { num: '106', date: '27.03.2026', amount: 30000, title: 'Отгрузка без оплаты' };
    const oursDocs = [...BASE_DOCS, extra];
    const ours = path.join(outDir, 'missing-ours.xlsx');
    const partner = path.join(outDir, 'missing-partner.xlsx');
    writeXlsx(ours, actRows(oursDocs));
    writeXlsx(partner, actRows(BASE_DOCS));
    pairs.push({
      name: 'missing',
      oursFile: ours,
      partnerFile: partner,
      expectMatched: BASE_DOCS.length,
      expectOnlyOurs: 1,
      expectDirection: 'they_owe',
    });
  }

  // PDF-сценарии собираются в buildPdfPairs (нужен TTF с кириллицей)
  return { pairs, skippedPdfScan: !findFont() };
}

/** Асинхронная часть генерации PDF-пар (вызывается из CLI) */
export async function buildPdfPairs(outDir: string): Promise<{
  textPair: SamplePair | null;
  scanPair: SamplePair | null;
}> {
  fs.mkdirSync(outDir, { recursive: true });
  const font = findFont();

  if (!font) {
    console.warn('⚠ TTF-шрифт с кириллицей не найден (можно задать PDF_FONT_PATH) — PDF-сэмплы пропущены.');
    return { textPair: null, scanPair: null };
  }

  // Текстовый PDF
  const textPath = path.join(outDir, 'pdf-text-partner.pdf');
  const textPdf = await makePdfBuffer(async (doc) => drawActText(doc, BASE_DOCS, font));
  fs.writeFileSync(textPath, textPdf);
  const textPair: SamplePair = {
    name: 'pdf-text',
    oursFile: path.join(outDir, 'ideal-ours.xlsx'),
    partnerFile: textPath,
    expectMatched: BASE_DOCS.length,
    expectEvenBalance: true,
  };

  // «Скан»: рисуем таблицу на canvas → PNG → одностраничный PDF-«скан»
  let scanPair: SamplePair | null = null;
  try {
    const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
    GlobalFonts.registerFromPath(font, 'SampleAct');

    // Канва в 2x против печатного размера: иначе текст при встраивании в PDF
    // становится слишком «мыльным» и OCR путает похожие цифры (8↔6)
    const canvas = createCanvas(1400, 640);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1400, 640);
    ctx.fillStyle = '#111111';
    ctx.font = '32px SampleAct';

    ctx.fillText('АКТ СВЕРКИ взаимных расчётов за март 2026 г.', 60, 80);
    const cols = [60, 280, 540, 820];
    HEADER.forEach((h, i) => ctx.fillText(h, cols[i]!, 160));
    BASE_DOCS.forEach((d, ri) => {
      const y = 220 + ri * 56;
      ctx.fillText(d.num, cols[0]!, y);
      ctx.fillText(d.date, cols[1]!, y);
      ctx.fillText(`${d.amount.toFixed(2).replace('.', ',')}`, cols[2]!, y);
      ctx.fillText(d.title, cols[3]!, y);
    });

    const png = await canvas.encode('png');
    const scanPath = path.join(outDir, 'pdf-scan-partner.pdf');
    const scanPdf = await makePdfBuffer((doc) => {
      doc.image(png, 0, 0, { width: 595 });
    });
    fs.writeFileSync(scanPath, scanPdf);
    scanPair = {
      name: 'pdf-scan',
      oursFile: path.join(outDir, 'ideal-ours.xlsx'),
      partnerFile: scanPath,
      expectMatched: BASE_DOCS.length - 1, // OCR не идеален — допускаем одну потерю
      expectEvenBalance: true,
    };
  } catch (err) {
    console.warn(`⚠ Не удалось собрать скан-PDF (${err instanceof Error ? err.message : err}) — пропущено.`);
  }

  return { textPair, scanPair };
}

/* ---------------------------------- CLI ------------------------------------ */

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('generate-samples.ts');
if (isMain) {
  const outDir = path.resolve(process.cwd(), 'samples');
  const { pairs } = buildScenarios(outDir);
  const { textPair, scanPair } = await buildPdfPairs(outDir);
  const all = [...pairs, ...(textPair ? [textPair] : []), ...(scanPair ? [scanPair] : [])];
  for (const pair of all) {
    console.log(`✓ ${pair.name}: ${path.basename(pair.oursFile)} + ${path.basename(pair.partnerFile)}`);
  }
  console.log(`\nГотово: ${all.length} пар в ${outDir}`);
}
