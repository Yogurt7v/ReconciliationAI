import type { ReasoningStep } from '@recon/shared';

const STAGE_LABELS: Partial<Record<ReasoningStep['stage'], string>> = {
  parsing: 'Разбор файлов',
  structure: 'Структура таблиц',
  extraction: 'Извлечение строк',
  reconciliation: 'Сопоставление',
  analysis: 'Анализ',
};

export default function AiLogicTimeline({ steps }: { steps: ReasoningStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="card">
      <div className="card-header">
        <h2>Логика системы</h2>
      </div>
      <ul className="journal">
        {steps.map((step) => (
          <li key={step.id} className="journal-item">
            <div className="journal-eyebrow">{STAGE_LABELS[step.stage] ?? step.stage}</div>
            <div className="journal-title">{step.title}</div>
            {step.detail && <div className="journal-detail">{step.detail}</div>}
            {step.confidence !== undefined && (
              <div className="journal-confidence">{(step.confidence * 100).toFixed(0)}%</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
