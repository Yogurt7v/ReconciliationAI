import { useCallback, useState } from 'react';

import { ModelModal } from './components/ModelModal';
import { SettingsButton } from './components/SettingsButton';
import { useAiModelBadge } from './hooks/useAiModelBadge';
import { useAiProfile } from './hooks/useAiProfile';
import { useAiRuntime } from './hooks/useAiRuntime';
import MainScreen from './screens/MainScreen';
import JobScreen from './screens/JobScreen';

type Mode = 'recon' | 'quick';

/**
 * Единая точка входа. Два режима: «Сверка» — полный пайплайн с OCR и отчётом,
 * «Быстро» — разбор двух файлов и сравнение на одной странице.
 *
 * Значок модели в шапке собирается из трёх источников и **не** из `/api/health`:
 * маршрут общий для всех, кто зашёл на этот backend, а профиль и удалённый запуск
 * живут в конкретном браузере и в конкретном задании (см. `useAiModelBadge`).
 * Отсюда два следствия:
 *
 *  - один экземпляр `useAiProfile` на всё дерево. Два экземпляра держали бы
 *    независимые копии состояния, и сохранение в окне настроек обновило бы
 *    значок, но не те запросы, что уходят из «Быстрого» режима; поэтому
 *    `ModelModal` получает тот же `profile` пропом и своего хука не создаёт;
 *  - `jobModel` — то, что сообщило задание о фактически применённой модели.
 *    Правка профиля посреди работы не переименовывает идущий запуск.
 *
 * Подпись под заголовком намеренно ничего не утверждает о том, где считает
 * модель: она одинаково правдива для локального и удалённого запуска.
 */
export default function App() {
  const profile = useAiProfile();
  const server = useAiRuntime();
  const [mode, setMode] = useState<Mode>('recon');
  /** Что сообщило текущее задание; JobScreen сбрасывает его в null при отмене */
  const [jobModel, setJobModel] = useState<string | null>(null);
  /** Окно настроек модели открыто — значит, смонтировано (см. `ModelModal`) */
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  /**
   * Обработчики окна — через `useCallback`, а не стрелками в разметке: хук окна
   * вешает подписку на Escape, и новая ссылка на каждый рендер пересоздавала бы
   * слушателя заново.
   */
  const openSettings = useCallback((): void => setSettingsOpen(true), []);
  const closeSettings = useCallback((): void => setSettingsOpen(false), []);

  const active = useAiModelBadge(profile, jobModel, server);

  return (
    <main className="page">
      <header className="app-header">
        <div>
          <h1 className="app-title">Reconciliation AI</h1>
          <p className="muted app-subtitle">Сверка актов сверки с контрагентами</p>
        </div>
        <span className={`badge${active.model === null ? '' : ' badge-info'}`} title={active.source}>
          {active.model === null ? 'Модель недоступна' : `Модель: ${active.model}`}
        </span>
      </header>

      <SettingsButton onOpen={openSettings} />
      {settingsOpen && <ModelModal profile={profile} onClose={closeSettings} />}

      <ModeSwitch mode={mode} onChange={setMode} />

      {mode === 'recon' ? (
        <JobScreen
          runtime={server}
          profile={profile}
          activeModel={active}
          onEffectiveModel={setJobModel}
        />
      ) : (
        <MainScreen profile={profile} />
      )}
    </main>
  );
}

/* ------------------------------- Переключатель ----------------------------- */

interface ModeSwitchProps {
  mode: Mode;
  onChange(next: Mode): void;
}

/** Вынесено отдельной функцией, чтобы `App` оставался в пределах 80 строк */
function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  const tab = (id: Mode, label: string) => (
    <button
      role="tab"
      aria-selected={mode === id}
      className={`mode-switch-btn ${mode === id ? 'is-active' : ''}`}
      onClick={() => onChange(id)}
    >
      {label}
    </button>
  );

  return (
    <nav className="mode-switch" role="tablist">
      {tab('recon', 'Сверка')}
      {tab('quick', 'Быстро')}
    </nav>
  );
}
