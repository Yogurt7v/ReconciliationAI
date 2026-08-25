import { useState } from 'react';

import {
  MAPPING_FIELD_LABELS,
  REQUIRED_FIELDS,
  type ColumnStats,
  type MappingFieldKey,
  type PendingConfirmation,
} from '@recon/shared';

import { api } from '../api';

interface Props {
  jobId: string;
  pending: PendingConfirmation;
}

export default function ConfirmationScreen({ jobId, pending }: Props) {
  const suggested = pending.suggested;
  const [headerRow, setHeaderRow] = useState(suggested.headerRowIndex);
  const [dataStart, setDataStart] = useState(suggested.dataStartRowIndex);
  const [columns, setColumns] =
    useState<Record<MappingFieldKey, number | null>>(suggested.columns);
  const [busy, setBusy] = useState(false);

  const sideLabel = pending.side === 'ours' ? 'вашего файла' : 'файла контрагента';
  const missingRequired = REQUIRED_FIELDS.filter((f) => columns[f] === null);

  const submit = async () => {
    setBusy(true);
    try {
      await api.confirm(jobId, { headerRowIndex: headerRow, dataStartRowIndex: dataStart, columns });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось подтвердить структуру');
    }
    setBusy(false);
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Уточните структуру ({sideLabel})</h2>
      </div>

      <p className="muted" style={{ marginBottom: 'var(--sp-4)' }}>
        {pending.reason}
      </p>

      <p style={{ marginBottom: 'var(--sp-4)' }}>
        Уверенность системы:{' '}
        <span className="mono" style={{ fontWeight: 600 }}>
          {(suggested.confidence * 100).toFixed(0)}%
        </span>
        . Проверьте соответствие колонок и при необходимости исправьте.
      </p>

      <div className="confirm-controls">
        <label>
          Строка заголовков
          <input
            className="input"
            type="number"
            min={0}
            value={headerRow}
            onChange={(e) => setHeaderRow(Number(e.target.value))}
          />
        </label>
        <label>
          Первая строка данных
          <input
            className="input"
            type="number"
            min={0}
            value={dataStart}
            onChange={(e) => setDataStart(Number(e.target.value))}
          />
        </label>
      </div>

      <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-4)' }}>
        <table className="mapping-table">
          <thead>
            <tr>
              <th>Колонка</th>
              <th>Заголовок</th>
              {Object.keys(MAPPING_FIELD_LABELS).map((field) => (
                <th key={field} title={`Поле «${MAPPING_FIELD_LABELS[field as MappingFieldKey]}»`}>
                  {MAPPING_FIELD_LABELS[field as MappingFieldKey]}
                </th>
              ))}
              <th>Примеры</th>
            </tr>
          </thead>
          <tbody>
            {previewRows(pending).map((row) => (
              <tr key={row.stats.index}>
                <td className="col-letter">{row.stats.letter}</td>
                <td className="col-header">{row.header ?? '—'}</td>
                {(Object.keys(MAPPING_FIELD_LABELS) as MappingFieldKey[]).map((field) => (
                  <td key={field} style={{ textAlign: 'center' }}>
                    <label
                      className={`radio-tile ${columns[field] === row.stats.index ? 'checked' : ''}`}
                      title={`${MAPPING_FIELD_LABELS[field]} — колонка ${row.stats.letter}`}
                    >
                      <input
                        type="radio"
                        name={`${field}-${row.stats.index}`}
                        checked={columns[field] === row.stats.index}
                        onChange={() =>
                          setColumns((prev) => ({
                            ...prev,
                            [field]: prev[field] === row.stats.index ? null : row.stats.index,
                          }))
                        }
                      />
                    </label>
                  </td>
                ))}
                <td className="col-samples">{truncate(row.stats.samples.join(' · '), 60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {missingRequired.length > 0 && (
        <div className="banner banner-error" style={{ marginBottom: 'var(--sp-4)' }}>
          Не выбраны обязательные поля:{' '}
          {missingRequired.map((f) => MAPPING_FIELD_LABELS[f]).join(', ')}.
        </div>
      )}

      <button
        className="btn btn-primary"
        disabled={busy || missingRequired.length > 0}
        onClick={() => void submit()}
      >
        Продолжить сверку
      </button>
    </div>
  );
}

function previewRows(pending: PendingConfirmation): Array<{ header: string | null; stats: ColumnStats }> {
  return pending.preview.columnLetters.map((letter, idx) => ({
    header: pending.preview.headers[idx] ?? null,
    stats: {
      index: idx,
      letter,
      header: pending.preview.headers[idx] ?? null,
      fillRatio: 1,
      numericRatio: 0,
      dateLikeRatio: 0,
      samples: pending.preview.rows
        .map((r) => r[idx])
        .filter((v): v is string => Boolean(v) && v!.trim() !== '')
        .slice(0, 3),
    },
  }));
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}
