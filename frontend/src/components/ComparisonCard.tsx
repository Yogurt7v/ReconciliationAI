import type { ComparisonResult } from '../api';
import { fmt, buildPairs, pairStatusLabel, pairTypeLabel } from '../utils';

interface ComparisonCardProps {
  comparison: ComparisonResult;
}

export function ComparisonCard({ comparison }: ComparisonCardProps) {
  const { balanceCheck: bc, turnoverCheck: tc, rows } = comparison;
  const pairs = buildPairs(rows);
  const matched = pairs.filter((p) => p.pairStatus === 'match').length;
  const partial = pairs.filter((p) => p.pairStatus === 'partial').length;
  const unmatched = pairs.filter((p) => p.pairStatus.startsWith('unmatched')).length;

  return (
    <div className="card comparison-card">
      <h3 style={{ margin: '0 0 var(--sp-3)' }}>Результат сверки</h3>

      {/* Сальдо */}
      <div className="comparison-section">
        <div className="comparison-row">
          <span>Сальдо конечное:</span>
          <span className={bc.match ? 'match' : 'mismatch'}>
            {fmt(bc.closingA)} = {fmt(bc.closingB)}
            {bc.match ? ' OK' : ` (разница: ${fmt(Math.abs(bc.diff))}) FAIL`}
          </span>
        </div>
      </div>

      {/* Обороты */}
      <div className="comparison-section">
        <div className="comparison-row">
          <span>Дебет А = Кредит Б:</span>
          <span className={tc.debitA_eq_debitB ? 'match' : 'mismatch'}>
            {fmt(tc.debitA)} = {fmt(tc.debitB)}
            {tc.debitA_eq_debitB ? ' OK' : ' FAIL'}
          </span>
        </div>
        <div className="comparison-row">
          <span>Кредит А = Дебит Б:</span>
          <span className={tc.creditA_eq_creditB ? 'match' : 'mismatch'}>
            {fmt(tc.creditA)} = {fmt(tc.creditB)}
            {tc.creditA_eq_creditB ? ' OK' : ' FAIL'}
          </span>
        </div>
      </div>

      {/* Сводка */}
      <div className="comparison-section">
        <div className="comparison-row" style={{ fontWeight: 600 }}>
          <span>Документы:</span>
          <span>
            {matched} совпало, {partial} расхождение, {unmatched} непарных
          </span>
        </div>
      </div>

      {/* Пары */}
      <div className="comparison-pairs">
        {pairs.map((pair) => (
          <div
            key={pair.index}
            className={`comparison-pair comparison-pair--${pair.pairStatus}`}
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
  );
}
