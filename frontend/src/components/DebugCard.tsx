import type { AiDebugInfo } from '../api';

interface DebugCardProps {
  debug: AiDebugInfo;
}

export function DebugCard({ debug }: DebugCardProps) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Диагностика AI</h2>
      </div>
      <div className="details-code-panel">
        <div><strong>Модель:</strong> {debug.model}</div>
        <div><strong>HTTP статус:</strong> {debug.httpStatus ?? '---'}</div>
        <div><strong>Попыток:</strong> {debug.attempts}</div>
        <div><strong>Длина ответа:</strong> {debug.contentLength} символов</div>
        <div><strong>Ошибка:</strong> {debug.errorMessage ?? '---'}</div>
        {debug.rawPreview && (
          <div className="mt-2">
            <strong>Превью:</strong>
            <pre className="details-pre">
              {debug.rawPreview}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
