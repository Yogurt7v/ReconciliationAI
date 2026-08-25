import type { JobStage, JobStatus } from '@recon/shared';

import { api } from '../api';

const STAGE_LABELS: Array<{ stage: JobStage; title: string }> = [
  { stage: 'parsing', title: 'Разбор файлов' },
  { stage: 'structure', title: 'Определение структуры таблиц' },
  { stage: 'awaiting_confirmation', title: 'Уточнение у пользователя' },
  { stage: 'extraction', title: 'Извлечение строк' },
  { stage: 'reconciliation', title: 'Сопоставление документов' },
  { stage: 'analysis', title: 'Итоговый анализ и гипотезы' },
];

export default function ProgressPanel({
  status,
  onCancel,
}: {
  status: JobStatus;
  onCancel: () => void;
}) {
  const currentIdx = STAGE_LABELS.findIndex((s) => s.stage === status.stage);
  const activeIdx = status.stage === 'uploaded' ? 0 : currentIdx;

  return (
    <div className="card">
      <div className="card-header">
        <h2>Выполняется сверка…</h2>
      </div>

      <ul className="stepper" role="list">
        {STAGE_LABELS.map((step, idx) => {
          const state = idx < activeIdx ? 'done' : idx === activeIdx ? 'active' : '';
          return (
            <li
              key={step.stage}
              className={`stepper-item ${state}`}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <div className="stepper-dot" />
              <div className="stepper-text">{step.title}</div>
            </li>
          );
        })}
      </ul>

      <div className="progress-bar" role="progressbar" aria-valuenow={Math.round(status.progress * 100)}>
        <div className="progress-bar-fill" style={{ width: `${Math.round(status.progress * 100)}%` }} />
      </div>

      <div className="progress-meta">
        {Math.round(status.progress * 100)}%
        {status.etaSeconds !== null && status.etaSeconds > 0
          ? ` · ~${formatEta(status.etaSeconds)}`
          : ''}
        {' — '}
        {status.message}
      </div>

      {status.reasoningLog.length > 0 && (
        <ul className="journal">
          {status.reasoningLog.map((step, i) => (
            <li key={i} className="journal-item">
              <div className="journal-title">{step.title}</div>
              {step.detail && <div className="journal-detail">{step.detail}</div>}
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 'var(--sp-5)' }}>
        <button
          className="btn btn-danger btn-sm"
          onClick={() => void api.cancel(status.id).then(onCancel)}
        >
          Отменить сверку
        </button>
      </div>
    </div>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} с`;
  const min = Math.floor(seconds / 60);
  return `${min} мин ${seconds % 60 > 0 ? `${seconds % 60} с` : ''}`;
}
