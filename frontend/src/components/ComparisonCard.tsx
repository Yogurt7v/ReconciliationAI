import type { CompareResult, AiDebugInfo } from '../api';
import { fmt } from '../utils';
import { CheckCircleIcon, AlertTriangleIcon } from './icons';

interface ComparisonCardProps {
  comparison: CompareResult & { debug?: AiDebugInfo };
}

export function ComparisonCard({ comparison }: ComparisonCardProps) {
  const { summary: s, matched, onlyInYour, onlyInPartner, diffs, aiAnalysis, debug } = comparison;

  const allMatch = s.closingMatch && s.debitMatch && s.creditMatch && diffs.length === 0 && onlyInYour.length === 0 && onlyInPartner.length === 0;

  return (
    <div className="comparison-card">
      {/* Вердикт */}
      <div
        className={`verdict ${allMatch ? 'verdict--ok' : 'verdict--fail'} animate-scale-in`}
        role="status"
        aria-label={allMatch ? 'Акты сверки совпадают' : 'Обнаружены расхождения'}
      >
        <span className="verdict-icon">
          {allMatch
            ? <CheckCircleIcon size={48} />
            : <AlertTriangleIcon size={48} />}
        </span>
        <div>
          <div className="verdict-title">
            {allMatch ? 'Акты сверки совпадают' : 'Обнаружены расхождения'}
          </div>
          <div className="verdict-sub">
            {allMatch
              ? 'Сальдо, обороты и документы идентичны.'
              : `${!s.closingMatch ? 'Сальдо расходится. ' : ''}${!s.debitMatch || !s.creditMatch ? 'Обороты расходятся. ' : ''}${diffs.length > 0 ? `Расхождений: ${diffs.length}. ` : ''}${onlyInYour.length > 0 ? `Только у вас: ${onlyInYour.length}. ` : ''}${onlyInPartner.length > 0 ? `Только у контрагента: ${onlyInPartner.length}.` : ''}`}
          </div>
        </div>
      </div>

      {/* Сводная таблица */}
      <div className="card animate-in mt-4" style={{ animationDelay: '80ms' }}>
        <h3 className="card-title">Сводка</h3>
        <div className="overflow-x-auto">
          <table className="summary-table">
            <thead>
              <tr>
                <th></th>
                <th>Файл А</th>
                <th>Файл Б</th>
                <th>Разница</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="summary-label">Сальдо начальное</td>
                <td className="summary-num">{fmt(s.yourOpeningBalance)}</td>
                <td className="summary-num">{fmt(s.partnerOpeningBalance)}</td>
                <td className="summary-num">
                  {s.openingDiff !== 0 ? fmt(Math.abs(s.openingDiff)) : '—'}
                </td>
                <td className={s.openingMatch ? 'summary-ok' : 'summary-fail'}>
                  {s.openingMatch ? '✓' : '✗'}
                </td>
              </tr>
              <tr>
                <td className="summary-label">Сальдо конечное</td>
                <td className="summary-num">{fmt(s.yourClosingBalance)}</td>
                <td className="summary-num">{fmt(s.partnerClosingBalance)}</td>
                <td className="summary-num">
                  {s.closingDiff !== 0 ? fmt(Math.abs(s.closingDiff)) : '—'}
                </td>
                <td className={s.closingMatch ? 'summary-ok' : 'summary-fail'}>
                  {s.closingMatch ? '✓' : '✗'}
                </td>
              </tr>
              <tr>
                <td className="summary-label">Оборот дебет</td>
                <td className="summary-num">{fmt(s.yourTurnoverDebit)}</td>
                <td className="summary-num">{fmt(s.partnerTurnoverDebit)}</td>
                <td className="summary-num">
                  {s.debitDiff !== 0 ? fmt(Math.abs(s.debitDiff)) : '—'}
                </td>
                <td className={s.debitMatch ? 'summary-ok' : 'summary-fail'}>
                  {s.debitMatch ? '✓' : '✗'}
                </td>
              </tr>
              <tr>
                <td className="summary-label">Оборот кредит</td>
                <td className="summary-num">{fmt(s.yourTurnoverCredit)}</td>
                <td className="summary-num">{fmt(s.partnerTurnoverCredit)}</td>
                <td className="summary-num">
                  {s.creditDiff !== 0 ? fmt(Math.abs(s.creditDiff)) : '—'}
                </td>
                <td className={s.creditMatch ? 'summary-ok' : 'summary-fail'}>
                  {s.creditMatch ? '✓' : '✗'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Сопоставленные документы */}
      {matched.length > 0 && (
        <div className="card animate-in mt-4" style={{ animationDelay: '100ms' }}>
          <h3 className="card-title">Сопоставлено ({matched.length})</h3>
          <div className="comparison-pairs">
            {matched.map((pair, i) => (
              <div
                key={pair.your.document}
                className="comparison-pair comparison-pair--match animate-in"
                style={{ animationDelay: `${120 + i * 40}ms` }}
              >
                <div className="comparison-pair-header">
                  <span className="pair-status pair-status--match">✓ Совпадает</span>
                  <span className="pair-amount">{fmt(pair.your.debit ?? pair.your.credit)}</span>
                </div>
                <div className="comparison-pair-body">
                  <div className="pair-side">
                    <span className="pair-side-label">Наша сторона</span>
                    <span className="pair-side-date">{pair.your.date}</span>
                    <span className="pair-side-doc">{pair.your.document}</span>
                    <span className="pair-side-amt">
                      {pair.your.debit ? `Д ${fmt(pair.your.debit)}` : ''}
                      {pair.your.credit ? `К ${fmt(pair.your.credit)}` : ''}
                    </span>
                  </div>
                  <div className="pair-side">
                    <span className="pair-side-label">Контрагент</span>
                    <span className="pair-side-date">{pair.partner.date}</span>
                    <span className="pair-side-doc">{pair.partner.document}</span>
                    <span className="pair-side-amt">
                      {pair.partner.debit ? `Д ${fmt(pair.partner.debit)}` : ''}
                      {pair.partner.credit ? `К ${fmt(pair.partner.credit)}` : ''}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI-анализ */}
      {aiAnalysis && (
        <div className="card animate-in mt-4" style={{ animationDelay: '120ms' }}>
          <h3 className="card-title">Анализ AI</h3>
          <p style={{ lineHeight: 1.6, color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap' }}>{aiAnalysis}</p>
        </div>
      )}

      {/* Расхождения по документам */}
      {diffs.length > 0 && (
        <div className="card animate-in mt-4" style={{ animationDelay: '160ms' }}>
          <h3 className="card-title">Расхождения ({diffs.length})</h3>
          <div className="comparison-pairs">
            {diffs.map((d, i) => (
              <div
                key={d.document}
                className="comparison-pair comparison-pair--partial animate-in"
                style={{ animationDelay: `${200 + i * 60}ms` }}
              >
                <div className="comparison-pair-header">
                  <span className="pair-number">#{i + 1}</span>
                  <span className="pair-status pair-status--partial">{reasonLabel(d.reason)}</span>
                  <span className="pair-amount">{fmt(Math.abs(d.diff))}</span>
                </div>
                <div className="comparison-pair-body">
                  <div className="pair-side">
                    <span className="pair-side-label">Наша сторона</span>
                    <span className="pair-side-date">{d.yourDate ?? '—'}</span>
                    <span className="pair-side-doc">{d.document}</span>
                    <span className="pair-side-amt">
                      {d.yourDebit ? `Д ${fmt(d.yourDebit)}` : ''}
                      {d.yourCredit ? `К ${fmt(d.yourCredit)}` : ''}
                    </span>
                  </div>
                  <div className="pair-side">
                    <span className="pair-side-label">Контрагент</span>
                    <span className="pair-side-date">{d.partnerDate ?? '—'}</span>
                    <span className="pair-side-doc">{d.document}</span>
                    <span className="pair-side-amt">
                      {d.partnerDebit ? `Д ${fmt(d.partnerDebit)}` : ''}
                      {d.partnerCredit ? `К ${fmt(d.partnerCredit)}` : ''}
                    </span>
                  </div>
                </div>
                <div style={{ padding: 'var(--sp-2) var(--sp-3)', fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
                  {d.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Только у вас */}
      {onlyInYour.length > 0 && (
        <div className="card animate-in mt-4" style={{ animationDelay: '200ms' }}>
          <h3 className="card-title">Только у вас ({onlyInYour.length})</h3>
          <div className="comparison-pairs">
            {onlyInYour.map((t, i) => (
              <div
                key={t.document}
                className="comparison-pair comparison-pair--unmatched-a animate-in"
                style={{ animationDelay: `${240 + i * 60}ms` }}
              >
                <div className="comparison-pair-header">
                  <span className="pair-status pair-status--unmatched-a">Нет у контрагента</span>
                  <span className="pair-amount">{fmt(t.debit ?? t.credit)}</span>
                </div>
                <div className="comparison-pair-body">
                  <div className="pair-side">
                    <span className="pair-side-label">Наша сторона</span>
                    <span className="pair-side-date">{t.date}</span>
                    <span className="pair-side-doc">{t.document}</span>
                    <span className="pair-side-amt">
                      {t.debit ? `Д ${fmt(t.debit)}` : ''}
                      {t.credit ? `К ${fmt(t.credit)}` : ''}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Только у контрагента */}
      {onlyInPartner.length > 0 && (
        <div className="card animate-in mt-4" style={{ animationDelay: '240ms' }}>
          <h3 className="card-title">Только у контрагента ({onlyInPartner.length})</h3>
          <div className="comparison-pairs">
            {onlyInPartner.map((t, i) => (
              <div
                key={t.document}
                className="comparison-pair comparison-pair--unmatched-b animate-in"
                style={{ animationDelay: `${280 + i * 60}ms` }}
              >
                <div className="comparison-pair-header">
                  <span className="pair-status pair-status--unmatched-b">Нет у вас</span>
                  <span className="pair-amount">{fmt(t.debit ?? t.credit)}</span>
                </div>
                <div className="comparison-pair-body">
                  <div className="pair-side">
                    <span className="pair-side-label">Контрагент</span>
                    <span className="pair-side-date">{t.date}</span>
                    <span className="pair-side-doc">{t.document}</span>
                    <span className="pair-side-amt">
                      {t.debit ? `Д ${fmt(t.debit)}` : ''}
                      {t.credit ? `К ${fmt(t.credit)}` : ''}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Диагностика AI */}
      {debug && (
        <details className="animate-in mt-4" style={{ animationDelay: '300ms' }}>
          <summary>Диагностика AI</summary>
          <div className="details-code-panel">
            <div><strong>Модель:</strong> {debug.model}</div>
            <div><strong>HTTP статус:</strong> {debug.httpStatus ?? '---'}</div>
            <div><strong>Попыток:</strong> {debug.attempts}</div>
            <div><strong>Длина ответа:</strong> {debug.contentLength} символов</div>
            <div><strong>Ошибка:</strong> {debug.errorMessage ?? '---'}</div>
            {debug.rawPreview && (
              <pre className="details-pre">{debug.rawPreview}</pre>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'amount_mismatch': return 'Разные суммы';
    case 'direction_mismatch': return 'Перепутаны Д/К';
    case 'date_mismatch': return 'Разные даты';
    case 'missing_in_partner': return 'Нет у контрагента';
    case 'missing_in_your': return 'Нет у вас';
    default: return reason;
  }
}
