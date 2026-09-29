import { useState } from 'react';

import { useAiRuntime } from './hooks/useAiRuntime';
import MainScreen from './screens/MainScreen';
import JobScreen from './screens/JobScreen';

type Mode = 'recon' | 'quick';

/**
 * Единая точка входа. Модель выбирается в settings.txt, поэтому в интерфейсе
 * её можно только показать — здесь берём фактически применяемую из /api/health.
 *
 * Два режима:
 *  - «Сверка» — полный пайплайн: OCR, структура с подтверждением, сверка, отчёт;
 *  - «Быстро»  — разбор двух файлов и сравнение результатов на одной странице.
 */
export default function App() {
  const ai = useAiRuntime();
  const [mode, setMode] = useState<Mode>('recon');

  return (
    <main className="page">
      <header className="app-header">
        <div>
          <h1 className="app-title">Reconciliation AI</h1>
          <p className="muted app-subtitle">Сверка актов сверки на локальной модели</p>
        </div>
        {ai ? (
          <span className="badge badge-info" title="OLLAMA_MODEL из settings.txt">
            Модель: {ai.model}
          </span>
        ) : (
          <span className="badge" title="backend недоступен">
            Модель недоступна
          </span>
        )}
      </header>

      <nav className="mode-switch" role="tablist">
        <button
          role="tab"
          aria-selected={mode === 'recon'}
          className={`mode-switch-btn ${mode === 'recon' ? 'is-active' : ''}`}
          onClick={() => setMode('recon')}
        >
          Сверка
        </button>
        <button
          role="tab"
          aria-selected={mode === 'quick'}
          className={`mode-switch-btn ${mode === 'quick' ? 'is-active' : ''}`}
          onClick={() => setMode('quick')}
        >
          Быстро
        </button>
      </nav>

      {mode === 'recon' ? <JobScreen runtime={ai} /> : <MainScreen runtime={ai} />}
    </main>
  );
}
