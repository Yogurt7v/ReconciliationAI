import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_FILE_SIZE_BYTES } from '@recon/shared';
import { MAPPING_FIELD_LABELS, REQUIRED_FIELDS } from '@recon/shared';
import type { ConfirmPayload, JobStage, JobStatus, MappingFieldKey } from '@recon/shared';

import { api, ApiError, apiUrl } from '../api';
import type { AiRequestProfile, AiRuntimeInfo } from '../api';
import { providerLabel } from '../hooks/useAiModelBadge';
import type { ActiveAiModel } from '../hooks/useAiModelBadge';
import { DropZone } from '../components/DropZone';

const MAX_MB = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));

/** Как часто опрашиваем статус задания, мс */
const POLL_MS = 1200;

const STAGE_LABELS: Record<JobStage, string> = {
  uploaded: 'Загрузка',
  parsing: 'Разбор файлов',
  structure: 'Определение структуры',
  awaiting_confirmation: 'Ждёт подтверждения',
  extraction: 'Извлечение данных',
  reconciliation: 'Сверка',
  analysis: 'Анализ и отчёт',
  done: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменено',
};

/** Стадии, на которых задание ждёт действий пользователя — их не опрашиваем впустую */
const PAUSED_STAGES: JobStage[] = ['awaiting_confirmation', 'done', 'failed', 'cancelled'];

interface Props {
  runtime?: AiRuntimeInfo | null;
  /**
   * Профиль этого браузера: уходит в `createJob` и больше никуда. Показывать его
   * нельзя — в нём секрет, поэтому в разметку попадает только `activeModel`.
   */
  profile: AiRequestProfile;
  /** Модель, которая уйдёт в следующий запуск, — без ключа */
  activeModel: ActiveAiModel;
  /** Сообщает вверх, какую модель применило задание: этим двигается значок в шапке */
  onEffectiveModel?: (model: string | null) => void;
}

export default function JobScreen({ runtime, profile, activeModel, onEffectiveModel }: Props) {
  const [ours, setOurs] = useState<File | null>(null);
  const [partner, setPartner] = useState<File | null>(null);
  const [twoSided, setTwoSided] = useState(false);
  const [overOurs, setOverOurs] = useState(false);
  const [overPartner, setOverPartner] = useState(false);

  const [status, setStatus] = useState<JobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const jobIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  /** Когда прогресс последний раз менялся — для пульсации «ещё думает» */
  const lastChangeRef = useRef<number>(Date.now());
  const progressRef = useRef<number>(-1);
  const oursInputRef = useRef<HTMLInputElement>(null);
  const partnerInputRef = useRef<HTMLInputElement>(null);

  const validate = useCallback((f: File): string | null => {
    if (!/\.(xlsx|xls|pdf)$/i.test(f.name)) return 'Поддерживаются только XLSX и PDF.';
    if (f.size > MAX_FILE_SIZE_BYTES) return `Файл больше ${MAX_MB} МБ.`;
    return null;
  }, []);

  const pick = useCallback(
    (f: File, set: (file: File | null) => void) => {
      const problem = validate(f);
      setFatal(problem);
      if (!problem) set(f);
    },
    [validate],
  );

  /* ------------------------------ Опрос статуса ---------------------------- */

  const poll = useCallback((id: string) => {
    const tick = async () => {
      let next: JobStatus;
      try {
        next = await api.jobStatus(id);
      } catch (err) {
        setFatal(err instanceof Error ? err.message : 'Задание недоступно.');
        return;
      }

      if (next.progress !== progressRef.current) {
        progressRef.current = next.progress;
        lastChangeRef.current = Date.now();
      }
      setStatus(next);
      if (PAUSED_STAGES.includes(next.stage)) return; // ждём пользователя или конца
      timerRef.current = setTimeout(tick, POLL_MS);
    };
    void tick();
  }, []);

  // Остановка опроса при размонтировании или смене задания
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /* --------------------------------- Действия ------------------------------ */

  const start = useCallback(async () => {
    if (!ours || !partner) return;
    setStarting(true);
    setFatal(null);
    setStatus(null);
    try {
      const created = await api.createJob(ours, partner, twoSided, profile);
      jobIdRef.current = created.id;
      startedAtRef.current = Date.now();
      lastChangeRef.current = Date.now();
      progressRef.current = created.progress;
      setStatus(created);
      poll(created.id);
    } catch (err) {
      setFatal(err instanceof ApiError ? err.message : 'Не удалось запустить задание.');
    } finally {
      setStarting(false);
    }
  }, [ours, partner, twoSided, profile, poll]);

  const confirm = useCallback(
    async (payload: ConfirmPayload) => {
      if (!status) return;
      setBusy(true);
      setFatal(null);
      try {
        const next = await api.confirmJobMapping(status.id, payload);
        setStatus(next);
        if (next.stage === 'awaiting_confirmation') poll(status.id);
      } catch (err) {
        setFatal(err instanceof Error ? err.message : 'Не удалось подтвердить структуру.');
      } finally {
        setBusy(false);
      }
    },
    [status, poll],
  );

  const cancel = useCallback(async () => {
    if (!status) return;
    setBusy(true);
    try {
      setStatus(await api.cancelJob(status.id));
    } catch (err) {
      setFatal(err instanceof Error ? err.message : 'Не удалось отменить задание.');
    } finally {
      setBusy(false);
    }
  }, [status]);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    jobIdRef.current = null;
    startedAtRef.current = null;
    lastChangeRef.current = Date.now();
    progressRef.current = -1;
    setStatus(null);
    setFatal(null);
  }, []);

  /* ---------------------------------- Вид ---------------------------------- */

  const running = status !== null && !PAUSED_STAGES.includes(status.stage);

  /* --------------- Что применяет это задание, а не текущий профиль ---------- */

  const effectiveModel = status?.effectiveModel ?? null;

  // Значок в шапке обязан называть модель задания: правка профиля посреди работы
  // не должна переименовывать уже запущенный запуск. Отчёт идёт наверх и при
  // сбросе (effectiveModel становится null), поэтому отдельного вызова в reset
  // не нужно — состояние само выведет подпись обратно на профиль.
  useEffect(() => {
    onEffectiveModel?.(effectiveModel);
  }, [effectiveModel, onEffectiveModel]);

  // Размонтирование тоже сбрасывает: задание продолжает идти на сервере, а значок
  // не должен называть модель, которой на экране уже никто не видит.
  useEffect(() => {
    if (onEffectiveModel === undefined) return;
    return () => onEffectiveModel(null);
  }, [onEffectiveModel]);

  /* -------------------- Таймер «прошло» и пульсация ----------------------- */

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsedLabel =
    running && startedAtRef.current !== null
      ? `прошло ${formatDuration((now - startedAtRef.current) / 1000)}`
      : null;
  // Прогресс не двигался 4+ с → показываем, что идёт долгий шаг (AI-вызов)
  const progressIdle = running && now - lastChangeRef.current >= 4000;

  return (
    <div className="card animate-in">
      <div className="card-header">
        <h2>Сверка актов</h2>
        <p className="muted card-subtitle">
          Полный разбор с распознаванием сканов: определяется структура таблицы, извлекаются
          документы, выполняется сверка и строится отчёт.
        </p>
      </div>

      {!status && (
        <>
          <div className="upload-grid">
            <DropZone
              label="Наш файл"
              file={ours}
              busy={false}
              over={overOurs}
              inputRef={oursInputRef}
              onPick={(f) => pick(f, setOurs)}
              onOver={setOverOurs}
            />
            <DropZone
              label="Файл контрагента"
              file={partner}
              busy={false}
              over={overPartner}
              inputRef={partnerInputRef}
              onPick={(f) => pick(f, setPartner)}
              onOver={setOverPartner}
            />
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={twoSided}
              onChange={(e) => setTwoSided(e.target.checked)}
            />
            <span>
              У контрагента двухсторонний акт (обе стороны в одном PDF)
            </span>
          </label>

          {fatal && <div className="banner banner-error">{fatal}</div>}

          <div className="upload-actions">
            <span className="muted">XLSX или PDF, до {MAX_MB} МБ</span>
            <button
              className="btn btn-primary"
              disabled={!ours || !partner || starting}
              onClick={start}
            >
              {starting ? 'Запуск...' : 'Начать сверку'}
            </button>
          </div>
        </>
      )}

      {status && (
        <div className="job-status">
          <div className="job-status-head">
            <strong>{STAGE_LABELS[status.stage]}</strong>
            {elapsedLabel !== null && <span className="muted job-elapsed">{elapsedLabel}</span>}
          </div>

          <Stepper stage={status.stage} />

          <div className={`progress${progressIdle ? ' is-idle' : ''}`}>
            <div className="progress-bar" style={{ width: `${Math.round(status.progress * 100)}%` }} />
          </div>

          <p className="muted job-message" key={status.message}>{status.message}</p>
          <p className="muted mt-2">
            Модель запуска: {effectiveModel ?? `запрошено ${activeModel.model ?? '—'}, ещё не ответила`}
          </p>

          {status.error && <div className="banner banner-error">{status.error}</div>}
          {fatal && <div className="banner banner-error">{fatal}</div>}

          {status.stage === 'awaiting_confirmation' && status.pendingConfirmation && (
            <MappingConfirmation
              pending={status.pendingConfirmation}
              busy={busy}
              onConfirm={confirm}
            />
          )}

          <AiDiagnostics
            runtime={runtime ?? null}
            effectiveModel={effectiveModel}
            requestedModel={status.requestedModel ?? null}
          />

          {status.stage === 'done' && status.reportReady && <ReportLinks id={status.id} />}

          {/* Причина обрыва — в самом отчёте, и по нажатию её не спрятать в
              свёрнутый блок: оператору нужен этот шаг, а не охота за ним.
              `open`, а не `defaultOpen`: у `<details>` в типах React нет второго
              (это атрибут `<input>`). Пока значение не меняется, React в DOM не
              пишет — свёрнуть обратно оператор может. */}
          {status.reasoningLog.length > 0 && (
            <details open={status.stage === 'failed' || status.stage === 'cancelled'}>
              <summary>Ход работы ({status.reasoningLog.length})</summary>
              <ul className="job-log">
                {status.reasoningLog.map((step) => (
                  <li key={step.id}>
                    <span className="job-log-stage">{STAGE_LABELS[step.stage]}</span>
                    <strong>{step.title}</strong>
                    {step.detail && <span className="muted"> — {step.detail}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="upload-actions">
            {running ? (
              <button className="btn btn-ghost" onClick={cancel} disabled={busy}>
                Отменить
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={reset}>
                Новое задание
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Диагностика AI ----------------------------- */

interface AiDiagnosticsProps {
  /** Настройки сервера: чем считалось бы задание без сохранённого профиля */
  runtime: AiRuntimeInfo | null;
  /** Модель, обслужившая этот запуск; null — пока неизвестна */
  effectiveModel: string | null;
  /** Модель, запрошенная для этого запуска; null — запуска на локальной модели */
  requestedModel: string | null;
}

/**
 * Три строки о том, кто считал, — на том же месте и в том же виде, что
 * диагностика в «Быстром» режиме.
 *
 * Ответившая и запрошенная модели — **разные строки**, и различие между ними
 * обязано быть видимым: подставлять запрошенную на место ответившей значило бы
 * показать модели имя того, кто этого запуска не считал, — ровно то, чего ждёт
 * оператор от подписи. Запрошенная берётся из задания (`JobStatus`), а не из
 * значка в шапке: тот по правилам `useAiModelBadge` отдаёт ответившую модель,
 * и обе строки стали бы одинаковыми — то есть подмена на стороне шлюза стала
 * бы незаметной. Упавшее на первом вызове задание обязано выглядеть как
 * задание без модели, а не как задание на выбранной модели.
 *
 * Провайдер задания здесь не назван намеренно: `JobStatus` несёт только имя
 * модели, а догадываться по имени («в идентификаторе есть слэш — значит OpenRouter»)
 * значило бы подписать чужую обработку чужим провайдером.
 */
function AiDiagnostics({ runtime, effectiveModel, requestedModel }: AiDiagnosticsProps) {
  return (
    <details className="mt-3">
      <summary>Диагностика AI</summary>
      <div className="details-code-panel">
        <div>
          <strong>Ответила модель:</strong> {effectiveModel ?? 'ещё не ответила'}
        </div>
        <div>
          <strong>Запрошено для запуска:</strong> {requestedModel ?? '---'}
        </div>
        <div>
          <strong>Локальная модель сервера:</strong> {runtime?.model ?? '---'}
        </div>
        <div>
          <strong>Провайдер по умолчанию:</strong>{' '}
          {runtime === null ? '---' : providerLabel(runtime.provider)}
        </div>
      </div>
    </details>
  );
}

/* ------------------------------ Подтверждение ----------------------------- */

function MappingConfirmation({
  pending,
  busy,
  onConfirm,
}: {
  pending: NonNullable<JobStatus['pendingConfirmation']>;
  busy: boolean;
  onConfirm: (payload: ConfirmPayload) => void;
}) {
  const [columns, setColumns] = useState<Record<MappingFieldKey, number | null>>(
    pending.suggested.columns,
  );
  const { headers, columnLetters } = pending.preview;

  const setField = (key: MappingFieldKey, value: string) => {
    setColumns((prev) => ({ ...prev, [key]: value === '' ? null : Number(value) }));
  };

  const duplicate = (() => {
    const used = Object.values(columns).filter((v): v is number => v !== null);
    return new Set(used).size !== used.length;
  })();

  const missing = REQUIRED_FIELDS.filter((k) => columns[k] === null);

  return (
    <div className="card card--flat">
      <div className="card-header">
        <h3 className="card-title">
          Подтвердите структуру — {pending.side === 'ours' ? 'наш файл' : 'файл контрагента'}
        </h3>
        <p className="muted card-subtitle">{pending.reason}</p>
      </div>

      <div className="mapping-grid">
        {(Object.keys(MAPPING_FIELD_LABELS) as MappingFieldKey[]).map((key) => {
          const col = columns[key];
          const required = REQUIRED_FIELDS.includes(key);
          return (
            <label key={key} className="mapping-field">
              <span className="mapping-label">
                {MAPPING_FIELD_LABELS[key]}
                {required && <span className="mapping-required">*</span>}
              </span>
              <select
                className="mapping-select"
                value={col === null || col === undefined ? '' : String(col)}
                onChange={(e) => setField(key, e.target.value)}
              >
                <option value="">— нет —</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {columnLetters[i] ?? i} — {h ?? '(без заголовка)'}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      {duplicate && (
        <div className="banner banner-warning">
          Одна колонка назначена двум полям — выберите разные.
        </div>
      )}

      <button
        className="btn btn-primary"
        disabled={busy || duplicate || missing.length > 0}
        onClick={() =>
          onConfirm({
            headerRowIndex: pending.suggested.headerRowIndex,
            dataStartRowIndex: pending.suggested.dataStartRowIndex,
            columns,
          })
        }
      >
        {busy ? 'Сохраняем...' : 'Подтвердить структуру'}
      </button>
    </div>
  );
}

/* --------------------------------- Отчёты --------------------------------- */

function ReportLinks({ id }: { id: string }) {
  return (
    <div className="banner banner-success">
      <strong>Отчёт готов.</strong>
      <div className="report-links">
        <a className="btn btn-sm" href={apiUrl(`/api/jobs/${id}/report`)} target="_blank" rel="noreferrer">
          Скачать JSON
        </a>
        <a
          className="btn btn-primary btn-sm"
          href={api.jobReportUrl(id)}
          target="_blank"
          rel="noreferrer"
        >
          Открыть отчёт (HTML)
        </a>
      </div>
    </div>
  );
}

function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m === 0) return `${rest} с`;
  if (m < 60) return `${m} мин ${rest} с`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
}

/** Шаги пайплайна для мини-степпера (без служебных и терминальных стадий) */
const STEPPER_STAGES: JobStage[] = [
  'parsing',
  'structure',
  'extraction',
  'reconciliation',
  'analysis',
];

function Stepper({ stage }: { stage: JobStage }) {
  const doneAll = stage === 'done';
  const stopped = stage === 'failed' || stage === 'cancelled';
  // Подтверждение структуры происходит внутри стадии structure → показываем её
  const currentIdx = doneAll
    ? STEPPER_STAGES.length
    : stopped
      ? -1
      : stage === 'uploaded'
        ? 0
        : stage === 'awaiting_confirmation'
          ? 1
          : STEPPER_STAGES.indexOf(stage);
  return (
    <ol className="stepper" aria-label="Ход обработки">
      {STEPPER_STAGES.map((s, i) => {
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'pending';
        return (
          <li key={s} className={`stepper-item is-${state}`}>
            <span className="stepper-mark">{state === 'done' ? '✓' : ''}</span>
            <span className="stepper-label">{STAGE_LABELS[s]}</span>
          </li>
        );
      })}
    </ol>
  );
}
