/**
 * HTML-экспорт отчёта: самодостаточная страница (инлайн-CSS, без внешних
 * ресурсов), печатается в A4 из браузера. Секции расхождений выделены цветом.
 */

import { formatMoney } from '@recon/shared';
import type {
  AmountMismatchItem,
  DateMismatchItem,
  OnlyItem,
  ReconciliationReport,
} from '@recon/shared';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(v: string | null | undefined): string {
  return esc(formatMoney(v ?? null));
}

function dateIso(v: string | null | undefined): string {
  if (!v) return '—';
  const [y, m, d] = v.split('-');
  return y && m && d ? `${d}.${m}.${y}` : esc(v);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? esc(iso)
    : esc(d.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }));
}

const CSS = `
  :root {
    --ink: #1a1d21; --muted: #6b7280; --line: #e5e7eb;
    --red-bg: #fef2f2; --red-ink: #991b1b;
    --amber-bg: #fffbeb; --amber-ink: #92400e;
    --blue-bg: #eff6ff; --blue-ink: #1e40af;
    --violet-bg: #f5f3ff; --violet-ink: #5b21b6;
    --green-bg: #ecfdf5; --green-ink: #065f46;
  }
  * { box-sizing: border-box; }
  body { font: 13px/1.45 -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--ink); margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 26px 0 8px; }
  .meta { color: var(--muted); margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; white-space: nowrap; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; min-width: 130px; }
  .card .n { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .card .t { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  section { border-radius: 10px; padding: 12px 14px; margin: 10px 0; page-break-inside: avoid; }
  section h2 { margin-top: 0; }
  .s-red { background: var(--red-bg); } .s-red h2 { color: var(--red-ink); }
  .s-amber { background: var(--amber-bg); } .s-amber h2 { color: var(--amber-ink); }
  .s-blue { background: var(--blue-bg); } .s-blue h2 { color: var(--blue-ink); }
  .s-violet { background: var(--violet-bg); } .s-violet h2 { color: var(--violet-ink); }
  .s-green { background: var(--green-bg); } .s-green h2 { color: var(--green-ink); }
  .balance { display: flex; align-items: baseline; gap: 14px; margin: 6px 0; }
  .balance .sum { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .balance .dir { color: var(--muted); }
  .explain { color: var(--ink); margin-top: 4px; }
  .hypo { margin: 6px 0; padding-left: 16px; }
  .hypo b.doc { margin-right: 6px; }
  .timeline { list-style: none; margin: 8px 0 0; padding: 0; }
  .timeline li { position: relative; padding: 0 0 12px 22px; border-left: 2px solid var(--line); margin-left: 8px; }
  .timeline li::before { content: ''; position: absolute; left: -6px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--blue-ink); }
  .timeline .title { font-weight: 600; }
  .timeline .detail { color: var(--muted); }
  .timeline .conf { color: var(--blue-ink); font-size: 11px; }
  .empty { color: var(--muted); font-style: italic; }
  footer { margin-top: 28px; color: var(--muted); font-size: 11px; }
  @page { size: A4; margin: 14mm; }
  @media print { body { padding: 0; } section { break-inside: avoid; } }
`;

function onlyTable(items: OnlyItem[]): string {
  if (items.length === 0) return `<p class="empty">Нет позиций.</p>`;
  return `<table><thead><tr><th>Документ</th><th>Дата</th><th class="num">Сумма</th></tr></thead><tbody>${items
    .map(
      (i) =>
        `<tr><td>${esc(i.docNumber ?? '—')}</td><td>${dateIso(i.docDate)}</td><td class="num">${money(i.amount)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function amountMismatchTable(items: AmountMismatchItem[]): string {
  if (items.length === 0) return `<p class="empty">Нет расхождений сумм.</p>`;
  return `<table><thead><tr><th>Документ</th><th>Дата (наши)</th><th>Дата (контрагент)</th><th class="num">Наша сумма</th><th class="num">Сумма контрагента</th><th class="num">Разница</th><th>Кто должен</th></tr></thead><tbody>${items
    .map((i) => {
      const dir =
        i.direction === 'they_owe'
          ? 'контрагент'
          : i.direction === 'we_owe'
            ? 'мы'
            : 'не определено';
      return `<tr><td>${esc(i.docNumber ?? '—')}</td><td>${dateIso(i.docDateOurs)}</td><td>${dateIso(
        i.docDatePartner,
      )}</td><td class="num">${money(i.ourAmount)}</td><td class="num">${money(i.partnerAmount)}</td><td class="num">${money(
        i.difference,
      )}</td><td>${dir}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

function dateMismatchTable(items: DateMismatchItem[]): string {
  if (items.length === 0) return `<p class="empty">Нет расхождений дат.</p>`;
  return `<table><thead><tr><th>Документ</th><th>Наша дата</th><th>Дата контрагента</th><th class="num">Сумма</th></tr></thead><tbody>${items
    .map(
      (i) =>
        `<tr><td>${esc(i.docNumber ?? '—')}</td><td>${dateIso(i.ourDate)}</td><td>${dateIso(
          i.partnerDate,
        )}</td><td class="num">${money(i.amount)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

/** Полный самодостаточный HTML-документ отчёта */
export function buildHtmlReport(report: ReconciliationReport): string {
  const s = report.summary;

  const balanceRows = report.balanceChecks
    .map(
      (b) =>
        `<tr><td>${esc(b.label)}</td><td class="num">${money(b.ours)}</td><td class="num">${money(
          b.partner,
        )}</td><td>${
          b.status === 'match' ? 'совпадает' : b.status === 'mismatch' ? 'не совпадает' : 'нет данных'
        }</td></tr>`,
    )
    .join('');

  const hypotheses = report.hypotheses.length
    ? report.hypotheses
        .map(
          (h) =>
            `<div class="hypo">${
              h.scope === 'doc' ? `<b class="doc">Док. ${esc(h.docNumber ?? '—')}:</b>` : ''
            }${esc(h.text)}${h.recommendation ? ` <em>→ ${esc(h.recommendation)}</em>` : ''}</div>`,
        )
        .join('')
    : `<p class="empty">Гипотез не сформировано.</p>`;

  const timeline = report.aiLogic.length
    ? `<ul class="timeline">${report.aiLogic
        .map(
          (step) =>
            `<li><div class="title">${esc(step.title)}${
              typeof step.confidence === 'number'
                ? ` <span class="conf">уверенность ${(step.confidence * 100).toFixed(0)}%</span>`
                : ''
            }</div><div class="detail">${esc(step.detail)}</div></li>`,
        )
        .join('')}</ul>`
    : `<p class="empty">Логика недоступна.</p>`;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Акт сверки — отчёт ${esc(report.id)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>Отчёт о сверке расчётов</h1>
  <div class="meta">
    Задание ${esc(report.id)} · сформирован ${fmtDateTime(report.createdAt)}<br>
    Период документов: ${dateIso(report.period.from)} — ${dateIso(report.period.to)}<br>
    Наши данные: ${esc(report.sides.ours.fileName)} (${report.sides.ours.rowsExtracted} строк) ·
    Данные контрагента: ${esc(report.sides.partner.fileName)} (${report.sides.partner.rowsExtracted} строк)
  </div>
</header>

<div class="cards">
  <div class="card"><div class="n">${s.matched}</div><div class="t">Совпало</div></div>
  <div class="card"><div class="n">${s.onlyOurs}</div><div class="t">Только у нас</div></div>
  <div class="card"><div class="n">${s.onlyPartner}</div><div class="t">Только у контрагента</div></div>
  <div class="card"><div class="n">${s.amountMismatches}</div><div class="t">Расхождений сумм</div></div>
  <div class="card"><div class="n">${s.dateMismatches}</div><div class="t">Расхождений дат</div></div>
</div>

<section class="${report.finalBalance.direction === 'even' ? 's-green' : 's-red'}">
  <h2>Итоговый баланс расхождений</h2>
  <div class="balance">
    <span class="sum">${money(report.finalBalance.amount)}</span>
    <span class="dir">${
      report.finalBalance.direction === 'they_owe'
        ? 'контрагент должен нам'
        : report.finalBalance.direction === 'we_owe'
          ? 'мы должны контрагенту'
          : 'расхождение сошлось взаимозачётом'
    }</span>
  </div>
  <div class="explain">${esc(report.finalBalance.explanation)}</div>
</section>

<section>
  <h2>Сальдо и обороты</h2>
  <table><thead><tr><th>Показатель</th><th class="num">Наши данные</th><th class="num">Данные контрагента</th><th>Статус</th></tr></thead>
  <tbody>${balanceRows}</tbody></table>
</section>

<section class="s-red">
  <h2>Расхождения сумм (${s.amountMismatches}) · всего ${money(report.totals.mismatchSum)}</h2>
  ${amountMismatchTable(report.amountMismatches)}
</section>

<section class="s-amber">
  <h2>Расхождения дат (${s.dateMismatches})</h2>
  ${dateMismatchTable(report.dateMismatches)}
</section>

<section class="s-blue">
  <h2>Только у нас (${s.onlyOurs}) · на ${money(report.totals.onlyOursSum)}</h2>
  ${onlyTable(report.onlyOurs)}
</section>

<section class="s-violet">
  <h2>Только у контрагента (${s.onlyPartner}) · на ${money(report.totals.onlyPartnerSum)}</h2>
  ${onlyTable(report.onlyPartner)}
</section>

<section>
  <h2>Гипотезы и рекомендации</h2>
  ${hypotheses}
</section>

<section>
  <h2>Логика AI</h2>
  ${timeline}
</section>

<footer>Документ сформирован автоматически. Арифметика сверки детерминирована и точна до копейки.</footer>
</body>
</html>`;
}
