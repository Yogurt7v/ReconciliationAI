import { useCallback, useEffect, useRef, useState } from 'react';

import type { JobStatus } from '@recon/shared';

import { api } from './api';
import UploadScreen from './screens/UploadScreen';
import ProgressPanel from './screens/ProgressPanel';
import ConfirmationScreen from './screens/ConfirmationScreen';
import ReportScreen from './screens/ReportScreen';
import TestScreen from './screens/TestScreen';
import ErrorBanner from './components/ErrorBanner';

type Phase =
  | { kind: 'upload' }
  | { kind: 'job'; jobId: string }
  | { kind: 'test' };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'upload' });
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback(
    (jobId: string) => {
      stopPolling();
      const tick = async () => {
        try {
          const next = await api.status(jobId);
          setError(next.error);
          setStatus(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Ошибка связи с сервером');
        }
      };
      void tick();
      pollRef.current = setInterval(tick, 700);
    },
    [stopPolling],
  );

  const handleUploaded = useCallback(
    (jobId: string) => {
      setPhase({ kind: 'job', jobId });
      startPolling(jobId);
    },
    [startPolling],
  );

  const handleRestart = useCallback(() => {
    stopPolling();
    setStatus(null);
    setError(null);
    setPhase({ kind: 'upload' });
  }, [stopPolling]);

  const handleCancel = useCallback(async () => {
    if (phase.kind !== 'job') return;
    await api.cancel(phase.jobId).catch((err) =>
      setError(err instanceof Error ? err.message : 'Не удалось отменить'),
    );
  }, [phase]);

  if (phase.kind === 'test') {
    return (
      <main className="page">
        <AppBar activeTab="test" onNavigate={(kind) => {
          stopPolling();
          setStatus(null);
          setError(null);
          setPhase({ kind });
        }} />
        <TestScreen onBack={() => {
          stopPolling();
          setStatus(null);
          setError(null);
          setPhase({ kind: 'upload' });
        }} />
      </main>
    );
  }

  if (phase.kind === 'upload' || !status) {
    return (
      <main className="page">
        <AppBar activeTab="main" onNavigate={(kind) => {
          stopPolling();
          setStatus(null);
          setError(null);
          setPhase({ kind });
        }} />
        <ErrorBanner message={error} />
        <UploadScreen onUploaded={handleUploaded} onError={setError} />
      </main>
    );
  }

  const terminal = status.stage === 'done' || status.stage === 'failed' || status.stage === 'cancelled';

  return (
    <main className="page">
      <AppBar activeTab="main" onNavigate={(kind) => {
        stopPolling();
        setStatus(null);
        setError(null);
        setPhase({ kind });
      }} />
      <ErrorBanner message={error} />

      {status.stage === 'awaiting_confirmation' && status.pendingConfirmation ? (
        <ConfirmationScreen
          key={`${status.id}:${status.pendingConfirmation.side}`}
          jobId={status.id}
          pending={status.pendingConfirmation}
        />
      ) : status.stage === 'done' && status.reportReady ? (
        <ReportScreen jobId={status.id} onRestart={handleRestart} />
      ) : terminal ? (
        <div className="card">
          <div className="muted" style={{ marginBottom: 'var(--sp-4)' }}>
            {status.stage === 'cancelled'
              ? 'Сверка отменена.'
              : `Не удалось выполнить сверку: ${status.error ?? 'неизвестная ошибка'}`}
          </div>
          <button className="btn btn-primary" onClick={handleRestart}>
            Начать заново
          </button>
        </div>
      ) : (
        <ProgressPanel status={status} onCancel={handleCancel} />
      )}
    </main>
  );
}

function AppBar({ activeTab, onNavigate }: { activeTab: 'main' | 'test'; onNavigate: (kind: 'upload' | 'test') => void }) {
  return (
    <header className="appbar">
      <span className="appbar-brand">Акты сверки</span>
      <span className="appbar-subtitle">
        Reconciliation AI
      </span>
      <nav style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)' }}>
        <button
          className={`btn btn-sm ${activeTab === 'main' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onNavigate('upload')}
        >
          Сверка
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'test' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onNavigate('test')}
        >
          Тест ИИ
        </button>
      </nav>
    </header>
  );
}
