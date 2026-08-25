/**
 * PDF-экспорт отчёта (pdfkit).
 *
 * Стандартные шрифты pdfkit (Helvetica и др.) не содержат кириллицы, поэтому
 * обязателен TTF-шрифт: поиск по списку типовых путей macOS/Linux/Windows
 * или путь из переменной окружения PDF_FONT_PATH. Без шрифта экспорт
 * завершается понятной ошибкой — вызывающий код вернёт её пользователю.
 */

import fs from 'node:fs';

import PDFDocument from 'pdfkit';

import { formatMoney } from '@recon/shared';
import type { ReconciliationReport } from '@recon/shared';

const FONT_CANDIDATES = [
  // Переопределение через окружение — высший приоритет
  ...(process.env.PDF_FONT_PATH ? [process.env.PDF_FONT_PATH] : []),
  // macOS
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
  '/System/Library/Fonts/Supplemental/Verdana.ttf',
  '/System/Library/Fonts/Supplemental/Georgia.ttf',
  '/Library/Fonts/Arial.ttf',
  '/System/Library/Fonts/HelveticaNeue.ttc',
  // Linux (Debian/Ubuntu)
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  // Windows
  'C:\\Windows\\Fonts\\arial.ttf',
];

/** Возвращает путь к TTF(-коллекции) с кириллицей или null */
export function findCyrillicFont(): string | null {
  for (const path of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(path)) return path;
    } catch {
      // недоступный путь просто пропускаем
    }
  }
  return null;
}

export class PdfFontError extends Error {
  constructor() {
    super(
      'Не найден TTF-шрифт с поддержкой кириллицы. Укажите путь через переменную окружения PDF_FONT_PATH.',
    );
    this.name = 'PdfFontError';
  }
}

const M = 46; // поле страницы
const W = 595.28 - M * 2; // A4

class PdfBuilder {
  private y = M;

  constructor(
    readonly doc: PDFKit.PDFDocument,
    private readonly bold: string,
  ) {}
  ensure(height: number): void {
    if (this.y + height > 792 - M) this.doc.addPage(), (this.y = M);
  }

  text(value: string, opts: { size?: number; bold?: boolean; color?: string; gap?: number } = {}): void {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : 'Regular';
    const lines = this.doc.font(font).fontSize(size).heightOfString(value, { width: W }) || size;
    this.ensure(lines + 6);
    this.doc
      .font(font)
      .fontSize(size)
      .fillColor(opts.color ?? '#111111')
      .text(value, M, this.y, { width: W, lineGap: 2 });
    this.y += lines + (opts.gap ?? 4);
  }

  heading(value: string): void {
    this.ensure(34);
    this.y += 8;
    this.text(value, { size: 13, bold: true, color: '#1d4ed8', gap: 6 });
  }

  row(cells: string[], widths: number[], opts: { num?: boolean[]; bold?: boolean } = {}): void {
    const size = 9;
    const font = opts.bold ? this.bold : 'Regular';
    this.doc.font(font).fontSize(size);
    let maxH = 0;
    cells.forEach((c, i) => {
      maxH = Math.max(maxH, this.doc.heightOfString(c, { width: widths[i] }));
    });
    this.ensure(maxH + 8);
    let x = M;
    cells.forEach((cell, i) => {
      this.doc
        .font(font)
        .fontSize(size)
        .fillColor('#111111')
        .text(cell, x, this.y, {
          width: widths[i],
          align: opts.num?.[i] ? 'right' : 'left',
        });
      x += widths[i]!;
    });
    this.y += maxH + 6;
  }

  separator(): void {
    this.ensure(10);
    this.doc.moveTo(M, this.y).lineTo(M + W, this.y).lineWidth(0.5).strokeColor('#d1d5db').stroke();
    this.y += 8;
  }
}

/** Собирает PDF-файл отчёта. Бросает PdfFontError, если нет кириллического шрифта. */
export function buildPdfReport(report: ReconciliationReport): Promise<Buffer> {
  const fontPath = findCyrillicFont();
  if (!fontPath) return Promise.reject(new PdfFontError());

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: M, left: M, right: M } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Regular', fontPath);
    const boldPath = fontPath.replace(/\.ttf$/i, 'Bold.ttf');
    const bold = fs.existsSync(boldPath) ? (() => { doc.registerFont('Bold', boldPath); return 'Bold'; })() : 'Regular';

    const b = new PdfBuilder(doc, bold);

    /* ------------------------------ Шапка ------------------------------ */
    b.text('Отчёт о сверке расчётов', { size: 17, bold: true });
    b.text(`Задание ${report.id} · сформирован ${new Date(report.createdAt).toLocaleString('ru-RU')}`, {
      size: 9,
      color: '#6b7280',
    });
    b.text(
      `Период документов: ${report.period.from ?? '—'} — ${report.period.to ?? '—'}`,
      { size: 9, color: '#6b7280', gap: 8 },
    );
    b.separator();

    b.text(`Наши данные: ${report.sides.ours.fileName} (${report.sides.ours.rowsExtracted} строк)`, { size: 9 });
    b.text(
      `Данные контрагента: ${report.sides.partner.fileName} (${report.sides.partner.rowsExtracted} строк)`,
      { size: 9 },
    );

    /* ---------------------------- Итоговый баланс ---------------------- */
    b.heading('Итоговый баланс расхождений');
    const fb = report.finalBalance;
    b.text(
      `${formatMoney(fb.amount)}  —  ${
        fb.direction === 'they_owe'
          ? 'контрагент должен нам'
          : fb.direction === 'we_owe'
            ? 'мы должны контрагенту'
            : 'расхождение сошлось взаимозачётом'
      }`,
      { size: 15, bold: true },
    );
    b.text(fb.explanation, { size: 9, color: '#374151' });

    /* -------------------------------- Сводка --------------------------- */
    b.heading('Сводка');
    const s = report.summary;
    const summaryPairs: Array<[string, string]> = [
      ['Совпало позиций', String(s.matched)],
      ['Только у нас', `${s.onlyOurs} · на ${formatMoney(report.totals.onlyOursSum)}`],
      ['Только у контрагента', `${s.onlyPartner} · на ${formatMoney(report.totals.onlyPartnerSum)}`],
      ['Расхождений сумм', `${s.amountMismatches} · на ${formatMoney(report.totals.mismatchSum)}`],
      ['Расхождений дат', String(s.dateMismatches)],
      ['Проблем с сальдо/оборотами', String(s.balanceIssues)],
    ];
    for (const [k, v] of summaryPairs) b.row([k, v], [W * 0.55, W * 0.45], { num: [false, true] });

    /* ------------------------------ Сальдо ------------------------------ */
    b.heading('Сальдо и обороты');
    b.row(['Показатель', 'Наши данные', 'У контрагента', 'Статус'], [W * 0.34, W * 0.22, W * 0.22, W * 0.22], {
      bold: true,
      num: [false, true, true, false],
    });
    for (const check of report.balanceChecks) {
      b.row(
        [
          check.label,
          formatMoney(check.ours),
          formatMoney(check.partner),
          check.status === 'match' ? 'совпадает' : check.status === 'mismatch' ? 'не совпадает' : 'нет данных',
        ],
        [W * 0.34, W * 0.22, W * 0.22, W * 0.22],
        { num: [false, true, true, false] },
      );
    }

    /* ------------------------- Расхождения сумм ------------------------- */
    if (report.amountMismatches.length > 0) {
      b.heading(`Расхождения сумм (${report.amountMismatches.length})`);
      const w = [W * 0.14, W * 0.16, W * 0.16, W * 0.18, W * 0.18, W * 0.18];
      b.row(['Документ', 'Дата (наши)', 'Дата (контр.)', 'Наша сумма', 'Их сумма', 'Разница'], w, { bold: true, num: [false, false, false, true, true, true] });
      for (const i of report.amountMismatches) {
        b.row(
          [
            i.docNumber ?? '—',
            i.docDateOurs ?? '—',
            i.docDatePartner ?? '—',
            formatMoney(i.ourAmount),
            formatMoney(i.partnerAmount),
            formatMoney(i.difference),
          ],
          w,
          { num: [false, false, false, true, true, true] },
        );
      }
    }

    /* -------------------------- Расхождения дат -------------------------- */
    if (report.dateMismatches.length > 0) {
      b.heading(`Расхождения дат (${report.dateMismatches.length})`);
      const w = [W * 0.2, W * 0.25, W * 0.25, W * 0.3];
      b.row(['Документ', 'Наша дата', 'Дата контрагента', 'Сумма'], w, { bold: true, num: [false, false, false, true] });
      for (const i of report.dateMismatches) {
        b.row([i.docNumber ?? '—', i.ourDate ?? '—', i.partnerDate ?? '—', formatMoney(i.amount)], w, {
          num: [false, false, false, true],
        });
      }
    }

    /* --------------------------- Only-позиции ---------------------------- */
    const onlySection = (
      title: string,
      items: ReconciliationReport['onlyOurs'],
    ): void => {
      if (items.length === 0) return;
      b.heading(title);
      b.row(['Документ', 'Дата', 'Сумма'], [W * 0.35, W * 0.25, W * 0.4], { bold: true, num: [false, false, true] });
      for (const i of items) {
        b.row([i.docNumber ?? '—', i.docDate ?? '—', formatMoney(i.amount)], [W * 0.35, W * 0.25, W * 0.4], {
          num: [false, false, true],
        });
      }
    };
    onlySection(`Только у нас (${report.onlyOurs.length})`, report.onlyOurs);
    onlySection(`Только у контрагента (${report.onlyPartner.length})`, report.onlyPartner);

    /* ----------------------------- Гипотезы ------------------------------ */
    if (report.hypotheses.length > 0) {
      b.heading('Гипотезы и рекомендации');
      for (const h of report.hypotheses) {
        const prefix = h.scope === 'doc' && h.docNumber ? `Док. ${h.docNumber}: ` : '';
        b.text(`${prefix}${h.text}${h.recommendation ? ` → ${h.recommendation}` : ''}`, {
          size: 9,
        });
      }
    }

    /* ----------------------------- Логика AI ----------------------------- */
    if (report.aiLogic.length > 0) {
      b.heading('Логика AI');
      for (const step of report.aiLogic) {
        const conf = typeof step.confidence === 'number' ? ` (уверенность ${Math.round(step.confidence * 100)}%)` : '';
        b.text(`• ${step.title}${conf}`, { size: 9, bold: true });
        b.text(step.detail, { size: 9, color: '#374151' });
      }
    }

    b.separator();
    b.text('Документ сформирован автоматически. Арифметика сверки детерминирована и точна до копейки.', {
      size: 8,
      color: '#9ca3af',
    });

    doc.end();
  });
}
