import type { AiDebugInfo } from '../api';

interface DebugCardProps {
  debug: AiDebugInfo;
}

export function DebugCard({ debug }: DebugCardProps) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Диагностика AI</h2>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: '1.6' }}>
        <div><strong>Модель:</strong> {debug.model}</div>
        <div><strong>HTTP статус:</strong> {debug.httpStatus ?? '---'}</div>
        <div><strong>Попыток:</strong> {debug.attempts}</div>
        <div><strong>Длина ответа:</strong> {debug.contentLength} символов</div>
        <div><strong>Ошибка:</strong> {debug.errorMessage ?? '---'}</div>
        {debug.rawPreview && (
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <strong>Превью:</strong>
            <pre style={{ margin: 'var(--sp-1) 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '120px', overflow: 'auto', background: 'var(--paper)', padding: 'var(--sp-2)', borderRadius: 'var(--radius-sm)' }}>
              {debug.rawPreview}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
