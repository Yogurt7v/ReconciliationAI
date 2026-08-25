import { useEffect, useState } from 'react';

import type { ReconciliationReport } from '@recon/shared';

import { api } from '../api';
import AiLogicTimeline from '../components/AiLogicTimeline';
import { DownloadIcon } from '../components/icons';

export default function ReportScreen({
  jobId,
  onRestart,
}: {
  jobId: string;
  onRestart: () => void;
}) {
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void api
      .report(jobId)
      .then((r) => !disposed && setReport(r))
      .catch((err) => !disposed && setError(err instanceof Error ? err.message : 'Ошибка'));
    return () => {
      disposed = true;
    };
  }, [jobId]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!report) return <p className="muted">Загрузка отчёта…</p>;

  const { summary, finalBalance, sides } = report;

  const download = (format: 'html' | 'xlsx' | 'pdf') => {
    window.open(`/api/jobs/${jobId}/report?format=${format}`, '_blank');
  };

  return (
    <>
      {/* Summary KPI Tiles */}
      <div className="card">
        <div className="card-header">
          <h2>Сводка</h2>
        </div>

        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-tile-label">Совпавших</div>
            <div className="stat-tile-value">{summary.matched}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Только ваш</div>
            <div className="stat-tile-value">{summary.onlyOurs}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Только контрагент</div>
            <div className="stat-tile-value">{summary.onlyPartner}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Разницы в сумме</div>
            <div className="stat-tile-value" style={{ color: summary.amountMismatches > 0 ? 'var(--warn)' : undefined }}>
              {summary.amountMismatches}
            </div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Разницы в дате</div>
            <div className="stat-tile-value" style={{ color: summary.dateMismatches > 0 ? 'var(--warn)' : undefined }}>
              {summary.dateMismatches}
            </div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Проблем с сальдо</div>
            <div className="stat-tile-value" style={{ color: summary.balanceIssues > 0 ? 'var(--bad)' : undefined }}>
              {summary.balanceIssues}
            </div>
          </div>
        </div>

        {/* Balance — Ledger closing line */}
        <div className="balance-block">
          <div className="label">
            Итоговое сальдо{report.period.from ? ` · ${report.period.from} — ${report.period.to ?? ''}` : ''}
          </div>
          <div
            className={`balance-figure ${finalBalance.direction === 'even' ? 'balance-figure--ok' : 'balance-figure--bad'}`}
          >
            {finalBalance.explanation}
          </div>
        </div>

        {/* Downloads */}
        <div className="download-row">
          <button className="btn btn-ghost btn-sm" onClick={() => download('html')}>
            <DownloadIcon /> HTML
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => download('xlsx')}>
            <DownloadIcon /> XLSX
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => download('pdf')}>
            <DownloadIcon /> PDF
          </button>
        </div>
      </div>

      {/* Balance checks table */}
      {report.balanceChecks.length > 0 && (
        <BalanceSection checks={report.balanceChecks} />
      )}

      {/* Paired: Only Ours + Only Partner */}
      <div className="paired">
        <OnlySection
          title={`Только ваш акт`}
          subtitle={sides.ours.fileName}
          items={report.onlyOurs}
          emptyText="Все ваши документы найдены у контрагента."
        />
        <OnlySection
          title={`Только акт контрагента`}
          subtitle={sides.partner.fileName}
          items={report.onlyPartner}
          emptyText="Все документы контрагента найдены у вас."
        />
      </div>

      <AmountMismatchSection items={report.amountMismatches} />
      <DateMismatchSection items={report.dateMismatches} />

      {report.hypotheses.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2>Гипотезы о причинах расхождений</h2>
          </div>
          <ul className="hypotheses">
            {report.hypotheses.map((h, i) => (
              <li key={i}>
                {h.text}
                {h.recommendation && (
                  <div className="hypotheses-recommendation">
                    Рекомендация: {h.recommendation}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AiLogicTimeline steps={report.aiLogic} />

      <button className="btn btn-primary" onClick={onRestart}>
        Новая сверка
      </button>
    </>
  );
}

function BalanceSection({ checks }: { checks: ReconciliationReport['balanceChecks'] }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2>Сальдо и обороты</h2>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Показатель</th>
              <th className="num">У вас</th>
              <th className="num">У контрагента</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.key}>
                <td>{c.label}</td>
                <td className="num">{c.ours ?? '—'}</td>
                <td className="num">{c.partner ?? '—'}</td>
                <td>
                  <span className={`badge ${c.status === 'match' ? 'badge-ok' : c.status === 'missing' ? 'badge-warn' : 'badge-bad'}`}>
                    {c.status === 'match'
                      ? 'совпадает'
                      : c.status === 'missing'
                        ? 'не найдено'
                        : 'расхождение'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OnlySection({
  title,
  subtitle,
  items,
  emptyText,
}: {
  title: string;
  subtitle?: string;
  items: ReconciliationReport['onlyOurs'];
  emptyText: string;
}) {
  return (
    <div className={`card ${items.length > 0 ? 'section-warn' : ''}`}>
      <div className="card-header">
        <h2>{title}</h2>
        {subtitle && <div className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: '2px' }}>{subtitle}</div>}
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>{emptyText}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Документ</th>
                <th className="num">Дата</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td>{item.docNumber ?? '(без номера)'}</td>
                  <td className="num">{item.docDate ?? '—'}</td>
                  <td className="num">{item.amount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AmountMismatchSection({ items }: { items: ReconciliationReport['amountMismatches'] }) {
  return (
    <div className={`card ${items.length > 0 ? 'section-warn' : ''}`}>
      <div className="card-header">
        <h2>Расхождения в суммах</h2>
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Суммы всех сопоставленных документов совпадают.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Документ</th>
                <th className="num">Ваша сумма</th>
                <th className="num">Сумма контрагента</th>
                <th className="num">Разница</th>
                <th>Направление</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td>{item.docNumber ?? '(без номера)'}</td>
                  <td className="num">{item.ourAmount ?? '—'}</td>
                  <td className="num">{item.partnerAmount ?? '—'}</td>
                  <td className="num">{item.difference ?? '—'}</td>
                  <td>{directionLabel(item.direction)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DateMismatchSection({ items }: { items: ReconciliationReport['dateMismatches'] }) {
  return (
    <div className={`card ${items.length > 0 ? 'section-warn' : ''}`}>
      <div className="card-header">
        <h2>Расхождения в датах</h2>
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Даты совпадающих документов совпадают.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Документ</th>
                <th className="num">Ваша дата</th>
                <th className="num">Дата контрагента</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td>{item.docNumber ?? '(без номера)'}</td>
                  <td className="num">{item.ourDate ?? '—'}</td>
                  <td className="num">{item.partnerDate ?? '—'}</td>
                  <td className="num">{item.amount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function directionLabel(direction: 'we_owe' | 'they_owe' | 'unknown'): string {
  switch (direction) {
    case 'they_owe':
      return 'контрагент должен нам';
    case 'we_owe':
      return 'мы должны контрагенту';
    default:
      return 'не определено';
  }
}
