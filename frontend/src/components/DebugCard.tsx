import type { AiDebugInfo } from '../api';
import { AiDebugRows } from './AiDebugRows';

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
        <AiDebugRows debug={debug} />
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
