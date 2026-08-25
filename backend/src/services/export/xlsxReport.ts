/**
 * XLSX-экспорт отчёта (exceljs). Листы: Сводка, Сальдо, Расхождения сумм,
 * Расхождения дат, Только у нас, Только у контрагента, Гипотезы, Логика AI.
 */

import ExcelJS from 'exceljs';

import { formatMoney } from '@recon/shared';
import type { ReconciliationReport } from '@recon/shared';

const MONEY_FMT = '# ##0.00;[Red]-# ##0.00';

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
}

function addSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  return wb.addWorksheet(name);
}

/** Сумма как число с денежным форматом (null → прочерк текстом) */
function moneyCell(row: ExcelJS.Row, col: number, value: string | null): void {
  const cell = row.getCell(col);
  if (value === null) {
    cell.value = '—';
    cell.alignment = { horizontal: 'right' };
  } else {
    cell.value = Number(value);
    cell.numFmt = MONEY_FMT;
  }
}

export async function buildXlsxReport(report: ReconciliationReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Reconciliation AI Agent';
  wb.created = new Date();

  /* ------------------------------ Сводка ------------------------------ */
  const sum = addSheet(wb, 'Сводка');
  sum.columns = [{ width: 42 }, { width: 22 }, { width: 22 }, { width: 18 }];

  sum.addRow(['Отчёт о сверке расчётов']).font = { bold: true, size: 14 };
  sum.addRow([`Задание ${report.id} от ${new Date(report.createdAt).toLocaleString('ru-RU')}`]);
  sum.addRow([
    `Период: ${report.period.from ?? '—'} — ${report.period.to ?? '—'}`,
  ]);
  sum.addRow([]);
  sum.addRow(['Наши данные', report.sides.ours.fileName]);
  sum.addRow(['Данные контрагента', report.sides.partner.fileName]);
  sum.addRow([]);

  const s = report.summary;
  styleHeader(sum.addRow(['Показатель', 'Значение']));
  const summaryRows: Array<[string, number | string]> = [
    ['Строк у нас', s.ourTotal],
    ['Строк у контрагента', s.partnerTotal],
    ['Совпало позиций', s.matched],
    ['Только у нас', s.onlyOurs],
    ['Только у контрагента', s.onlyPartner],
    ['Расхождений сумм', s.amountMismatches],
    ['Расхождений дат', s.dateMismatches],
    ['Проблем с сальдо/оборотами', s.balanceIssues],
  ];
  for (const [label, value] of summaryRows) sum.addRow([label, value]);

  const fb = report.finalBalance;
  sum.addRow([]);
  sum.addRow(['Итоговый баланс расхождений']).font = { bold: true };
  moneyCell(sum.addRow(['Сумма']), 2, fb.amount);
  sum.addRow([
    'Направление',
    fb.direction === 'they_owe'
      ? 'контрагент должен нам'
      : fb.direction === 'we_owe'
        ? 'мы должны контрагенту'
        : 'сошлось взаимозачётом',
  ]);

  /* ------------------------------ Сальдо ------------------------------ */
  const bal = addSheet(wb, 'Сальдо и обороты');
  bal.columns = [{ width: 34 }, { width: 20 }, { width: 20 }, { width: 16 }];
  styleHeader(bal.addRow(['Показатель', 'Наши данные', 'У контрагента', 'Статус']));
  for (const b of report.balanceChecks) {
    const row = bal.addRow([b.label]);
    moneyCell(row, 2, b.ours);
    moneyCell(row, 3, b.partner);
    row.getCell(4).value =
      b.status === 'match' ? 'совпадает' : b.status === 'mismatch' ? 'не совпадает' : 'нет данных';
  }

  /* ------------------------- Расхождения сумм ------------------------- */
  const am = addSheet(wb, 'Расхождения сумм');
  am.columns = [
    { width: 16 }, { width: 14 }, { width: 14 },
    { width: 16 }, { width: 18 }, { width: 14 }, { width: 16 },
  ];
  styleHeader(
    am.addRow([
      'Документ', 'Дата (наши)', 'Дата (контрагент)', 'Наша сумма', 'Сумма контрагента', 'Разница', 'Кто должен',
    ]),
  );
  for (const i of report.amountMismatches) {
    const row = am.addRow([
      i.docNumber ?? '—',
      i.docDateOurs ?? '—',
      i.docDatePartner ?? '—',
    ]);
    moneyCell(row, 4, i.ourAmount);
    moneyCell(row, 5, i.partnerAmount);
    moneyCell(row, 6, i.difference);
    row.getCell(7).value =
      i.direction === 'they_owe' ? 'контрагент' : i.direction === 'we_owe' ? 'мы' : 'не определено';
  }
  if (report.amountMismatches.length === 0) am.addRow(['Нет расхождений']);
  am.addRow([]);
  am.addRow(['Итого по модулю']).font = { bold: true };
  moneyCell(am.addRow(['']), 1, report.totals.mismatchSum);

  /* -------------------------- Расхождения дат -------------------------- */
  const dm = addSheet(wb, 'Расхождения дат');
  dm.columns = [{ width: 16 }, { width: 16 }, { width: 20 }, { width: 16 }];
  styleHeader(dm.addRow(['Документ', 'Наша дата', 'Дата контрагента', 'Сумма']));
  for (const i of report.dateMismatches) {
    const row = dm.addRow([i.docNumber ?? '—', i.ourDate ?? '—', i.partnerDate ?? '—']);
    moneyCell(row, 4, i.amount);
  }
  if (report.dateMismatches.length === 0) dm.addRow(['Нет расхождений']);

  /* --------------------------- Only-позиции ---------------------------- */
  const onlySheet = (
    name: string,
    title: string,
    items: ReconciliationReport['onlyOurs'],
    total: string,
  ): void => {
    const ws = addSheet(wb, name);
    ws.columns = [{ width: 18 }, { width: 16 }, { width: 16 }];
    styleHeader(ws.addRow([title, '', '']));
    styleHeader(ws.addRow(['Документ', 'Дата', 'Сумма']));
    for (const i of items) {
      const row = ws.addRow([i.docNumber ?? '—', i.docDate ?? '—']);
      moneyCell(row, 3, i.amount);
    }
    if (items.length === 0) ws.addRow(['Нет позиций']);
    ws.addRow([]);
    ws.addRow(['Итого']).font = { bold: true };
    moneyCell(ws.addRow(['']), 3, total);
  };
  onlySheet('Только у нас', 'Только у нас', report.onlyOurs, report.totals.onlyOursSum);
  onlySheet(
    'Только у контрагента',
    'Только у контрагента',
    report.onlyPartner,
    report.totals.onlyPartnerSum,
  );

  /* ----------------------------- Гипотезы ------------------------------ */
  const hyp = addSheet(wb, 'Гипотезы');
  hyp.columns = [{ width: 12 }, { width: 14 }, { width: 70 }, { width: 50 }];
  styleHeader(hyp.addRow(['Область', 'Документ', 'Гипотеза', 'Рекомендация']));
  for (const h of report.hypotheses) {
    hyp.addRow([
      h.scope === 'doc' ? 'документ' : 'общее',
      h.docNumber ?? '',
      h.text,
      h.recommendation ?? '',
    ]);
  }
  if (report.hypotheses.length === 0) hyp.addRow(['Гипотез не сформировано']);

  /* ----------------------------- Логика AI ----------------------------- */
  const ai = addSheet(wb, 'Логика AI');
  ai.columns = [{ width: 20 }, { width: 44 }, { width: 80 }, { width: 14 }, { width: 20 }];
  styleHeader(ai.addRow(['Стадия', 'Шаг', 'Детали', 'Уверенность', 'Время']));
  for (const step of report.aiLogic) {
    ai.addRow([
      step.stage,
      step.title,
      step.detail,
      typeof step.confidence === 'number' ? `${Math.round(step.confidence * 100)}%` : '',
      new Date(step.createdAt).toLocaleString('ru-RU'),
    ]);
  }
  if (report.aiLogic.length === 0) ai.addRow(['Логика недоступна']);

  // Человекочитаемая сводка в конце листа «Сводка» — текстом
  sum.addRow([]);
  sum.addRow([
    `Итог: ${formatMoney(fb.amount)} (${
      fb.direction === 'they_owe'
        ? 'контрагент должен нам'
        : fb.direction === 'we_owe'
          ? 'мы должны контрагенту'
          : 'взаимозачёт'
    })`,
  ]).font = { italic: true };

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
