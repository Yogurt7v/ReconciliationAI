import type { AiCompareResult } from '../api';
import { fmt, buildPairs, pairStatusLabel, pairTypeLabel } from '../utils';
import { CheckCircleIcon, AlertTriangleIcon } from './icons';

interface ComparisonCardProps {
  comparison: AiCompareResult;
}

export function ComparisonCard({ comparison }: ComparisonCardProps) {
  const { balanceCheck: bc, turnoverCheck: tc, aiAnalysis, rows, aiFallback } = comparison;
  const pairs = buildPairs(rows);
  const matched = pairs.filter((p) => p.pairStatus === 'match').length;
  const partial = pairs.filter((p) => p.pairStatus === 'partial').length;
  const unmatched = pairs.filter((p) => p.pairStatus.startsWith('unmatched')).length;

  const allBalancesMatch = bc.match;
  const allTurnoversMatch = tc.debitMatch && tc.creditMatch;
  const allDocsMatch = unmatched === 0 && partial === 0;
  const allMatch = allBalancesMatch && allTurnoversMatch && allDocsMatch;

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
              : `${!allBalancesMatch ? 'Сальдо расходится. ' : ''}${!allTurnoversMatch ? 'Обороты расходятся. ' : ''}${!allDocsMatch ? `Документов: ${matched} совпало, ${partial} расхождение, ${unmatched} непарных.` : ''}`}
          </div>
        </div>
      </div>

      {aiFallback && (
        <div className="banner banner-warning" style={{ marginTop: 'var(--sp-4)' }}>
          AI-сравнение недоступно. Сальдо и обороты рассчитаны без ИИ.
        </div>
      )}

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
                <td className="summary-num">{fmt(bc.openingA)}</td>
                <td className="summary-num">{fmt(bc.openingB)}</td>
                <td className="summary-num">
                  {bc.openingA !== bc.openingB ? fmt(bc.openingA - bc.openingB) : '—'}
                </td>
                <td className={bc.openingA === bc.openingB ? 'summary-ok' : 'summary-fail'}>
                  {bc.openingA === bc.openingB ? '✓' : '✗'}
                </td>
              </tr>
              <tr>
                <td className="summary-label">Сальдо конечное</td>
                <td className="summary-num">{fmt(bc.closingA)}</td>
                <td className="summary-num">{fmt(bc.closingB)}</td>
                <td className="summary-num">
                  {bc.match ? '—' : fmt(Math.abs(bc.diff))}
                </td>
                <td className={bc.match ? 'summary-ok' : 'summary-fail'}>
                  {bc.match ? '✓' : '✗'}
                </td>
              </tr>
              <tr>
                <td className="summary-label">Оборот Д-К</td>
                <td className="summary-num">{fmt(tc.debitA)}</td>
                <td className="summary-num">{fmt(tc.debitB)}</td>
                <td className="summary-num">
                  {!tc.debitMatch ? fmt(Math.abs(tc.debitA - tc.debitB)) : '—'}
                </td>
                <td className={tc.debitMatch ? 'summary-ok' : 'summary-fail'}>
                  {tc.debitMatch ? '✓' : '✗'}
                </td>
              </tr>
              <tr>
                <td className="summary-label">Оборот К-Д</td>
                <td className="summary-num">{fmt(tc.creditA)}</td>
                <td className="summary-num">{fmt(tc.creditB)}</td>
                <td className="summary-num">
                  {!tc.creditMatch ? fmt(Math.abs(tc.creditA - tc.creditB)) : '—'}
                </td>
                <td className={tc.creditMatch ? 'summary-ok' : 'summary-fail'}>
                  {tc.creditMatch ? '✓' : '✗'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* AI-анализ */}
      {/* aiAnalysis && (
        <div className="card animate-in mt-4" style={{ animationDelay: '120ms' }}>
          <h3 className="card-title">Анализ AI</h3>
          <p style={{ lineHeight: 1.6, color: 'var(--ink-secondary)' }}>{aiAnalysis}</p>
        </div>
      ) */}

      {/* Пары документов */}
      {pairs.length > 0 && (
        <div className="card animate-in mt-4" style={{ animationDelay: '160ms' }}>
          <h3 className="card-title">
            Документы ({matched} совпало{partial > 0 ? `, ${partial} расхождение` : ''}{unmatched > 0 ? `, ${unmatched} непарных` : ''})
          </h3>
          <div className="comparison-pairs">
            {pairs.map((pair, i) => (
              <div
                key={pair.index}
                className={`comparison-pair comparison-pair--${pair.pairStatus} animate-in`}
                style={{ animationDelay: `${200 + i * 60}ms` }}
              >
                <div className="comparison-pair-header">
                  <span className="pair-number">#{pair.index}</span>
                  <span className={`pair-status pair-status--${pair.pairStatus}`}>
                    {pairStatusLabel(pair.pairStatus)}
                  </span>
                  <span className="pair-type">
                    {pairTypeLabel(pair.typeA, pair.typeB, pair.pairStatus)}
                  </span>
                  <span className="pair-amount">
                    {pair.a ? fmt(pair.a.tx.debit ?? pair.a.tx.credit) : ''}
                    {pair.b && !pair.a ? fmt(pair.b.tx.debit ?? pair.b.tx.credit) : ''}
                    {pair.diff !== undefined && pair.diff > 0 ? (
                      <span className="pair-diff"> diff {fmt(pair.diff)}</span>
                    ) : null}
                  </span>
                </div>
                <div className="comparison-pair-body">
                  {pair.a && (
                    <div className={`pair-side ${pair.pairStatus === 'unmatched-a' ? 'pair-side--unmatched' : ''}`}>
                      <span className="pair-side-label">Наша сторона</span>
                      <span className="pair-side-date">{pair.a.tx.date}</span>
                      <span className="pair-side-doc">{pair.a.tx.document}</span>
                      <span className="pair-side-amt">{fmt(pair.a.tx.debit ?? pair.a.tx.credit)}</span>
                    </div>
                  )}
                  {pair.b && (
                    <div className={`pair-side ${pair.pairStatus === 'unmatched-b' ? 'pair-side--unmatched' : ''}`}>
                      <span className="pair-side-label">Контрагент</span>
                      <span className="pair-side-date">{pair.b.tx.date}</span>
                      <span className="pair-side-doc">{pair.b.tx.document}</span>
                      <span className="pair-side-amt">{fmt(pair.b.tx.debit ?? pair.b.tx.credit)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
