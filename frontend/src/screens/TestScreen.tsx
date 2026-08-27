import { useCallback, useRef, useState } from 'react';

import { MAX_FILE_SIZE_BYTES } from '@recon/shared';

import { api } from '../api';
import { ApiError } from '../api';
import type { AiDebugInfo, Contract, TestAnalyzeResponse } from '../api';
import { UploadCloudIcon, FileIcon } from '../components/icons';

const ACCEPT = '.xlsx,.xls,.pdf';
const MAX_MB = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));

interface Props {
  onBack: () => void;
}

export default function TestScreen({ onBack }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugError, setDebugError] = useState<AiDebugInfo | null>(null);
  const [result, setResult] = useState<TestAnalyzeResponse | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = (f: File): string | null => {
    if (!/\.(xlsx|xls|pdf)$/i.test(f.name)) return 'Поддерживаются только XLSX и PDF.';
    if (f.size > MAX_FILE_SIZE_BYTES) return `Файл больше ${MAX_MB} МБ.`;
    return null;
  };

  const pick = (f: File) => {
    const problem = validate(f);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setDebugError(null);
    setResult(null);
    setFile(f);
  };

  const submit = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDebugError(null);
    try {
      const res = await api.testAnalyze(file);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить анализ');
      if (err instanceof ApiError && err.debug) {
        setDebugError(err.debug);
      }
    } finally {
      setBusy(false);
    }
  }, [file]);

  const openPicker = () => inputRef.current?.click();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) pick(f);
  };

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <button className="btn btn-ghost btn-sm" onClick={onBack}>
              &larr; Назад
            </button>
            <h2>Тестовый анализ</h2>
          </div>
          <p className="muted" style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--text-sm)' }}>
            Загрузите файл — ИИ извлечёт данные и проверит баланс
          </p>
        </div>

        <div
          className={`dropzone ${over ? 'over' : ''} ${file ? 'filled' : ''}`}
          onClick={openPicker}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && openPicker()}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
              e.target.value = '';
            }}
          />
          {file ? (
            <>
              <FileIcon className="dropzone-icon" />
              <div className="dropzone-file">{file.name}</div>
              <div className="dropzone-hint">
                {busy ? 'Анализ…' : 'Нажмите или перетащите другой файл'}
              </div>
            </>
          ) : (
            <>
              <UploadCloudIcon className="dropzone-icon" />
              <div className="dropzone-label">Файл для анализа</div>
              <div className="dropzone-hint">Перетащите файл сюда или нажмите</div>
            </>
          )}
        </div>

        <div className="upload-actions">
          <span className="muted">XLSX или PDF, до {MAX_MB} МБ</span>
          <button className="btn btn-primary" disabled={!file || busy} onClick={submit}>
            {busy ? 'Анализ…' : 'Анализировать'}
          </button>
        </div>
      </div>

      {error && (
        <div className="banner banner-error">{error}</div>
      )}

      {debugError && <DebugCard debug={debugError} />}

      {busy && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--sp-8)' }}>
          <div className="spinner" />
          <div style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)' }}>
            Анализируем файл…
          </div>
          <div style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
            ИИ извлекает данные, это может занять до 60 секунд
          </div>
        </div>
      )}

      {result && <ResultCard result={result} />}
    </div>
  );
}

/* ----------------------------- Debug Card -------------------------------- */

function DebugCard({ debug }: { debug: AiDebugInfo }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Диагностика AI</h2>
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          lineHeight: '1.6',
        }}
      >
        <div><strong>Модель:</strong> {debug.model}</div>
        <div><strong>HTTP статус:</strong> {debug.httpStatus ?? '—'}</div>
        <div><strong>Попыток:</strong> {debug.attempts}</div>
        <div><strong>Длина ответа:</strong> {debug.contentLength} символов</div>
        <div><strong>Ошибка:</strong> {debug.errorMessage ?? '—'}</div>
        {debug.rawPreview && (
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <strong>Превью ответа:</strong>
            <pre style={{ margin: 'var(--sp-1) 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '120px', overflow: 'auto', background: 'var(--paper)', padding: 'var(--sp-2)', borderRadius: 'var(--radius-sm)' }}>
              {debug.rawPreview}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Result ------------------------------------ */

function ResultCard({ result }: { result: TestAnalyzeResponse }) {
  const r = result.result;
  const d = result.debug;

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <h2>Результат</h2>
          <span className="badge badge-info">{result.fileName}</span>
          {result.sheetName && <span className="badge badge-info">{result.sheetName}</span>}
        </div>
      </div>

      {/* Сальдо начальное */}
      <div className="balance-row">
        <span className="balance-label">Сальдо начальное</span>
        <span className="balance-value">{fmt(r.openingBalance)}</span>
      </div>

      {/* Договоры */}
      {r.contracts.length === 0 ? (
        <div className="empty-state">Договоры не найдены</div>
      ) : (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          {r.contracts.map((contract, i) => (
            <ContractBlock key={i} contract={contract} />
          ))}
        </div>
      )}

      {/* Обороты итого */}
      <div className="turnover-row">
        <div className="turnover-item">
          <span className="turnover-label">Оборот дебет итого</span>
          <span className="turnover-value">{fmt(r.turnoverDebit)}</span>
        </div>
        <div className="turnover-item">
          <span className="turnover-label">Оборот кредит итого</span>
          <span className="turnover-value">{fmt(r.turnoverCredit)}</span>
        </div>
      </div>

      {/* Сальдо конечное */}
      <div className="balance-row">
        <span className="balance-label">Сальдо конечное</span>
        <span className="balance-value">{fmt(r.closingBalance)}</span>
      </div>

      {/* Диагностика */}
      <details style={{ marginTop: 'var(--sp-4)' }}>
        <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
          Диагностика AI
        </summary>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            background: 'var(--paper)',
            padding: 'var(--sp-3)',
            borderRadius: 'var(--radius-md)',
            marginTop: 'var(--sp-2)',
            lineHeight: '1.6',
          }}
        >
          <div><strong>Модель:</strong> {d.model}</div>
          <div><strong>HTTP статус:</strong> {d.httpStatus ?? '—'}</div>
          <div><strong>Попыток:</strong> {d.attempts}</div>
          <div><strong>Длина ответа:</strong> {d.contentLength} символов</div>
          <div><strong>Ошибка:</strong> {d.errorMessage ?? '—'}</div>
          {d.rawPreview && (
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <strong>Превью ответа:</strong>
              <pre style={{ margin: 'var(--sp-1) 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '120px', overflow: 'auto' }}>
                {d.rawPreview}
              </pre>
            </div>
          )}
        </div>
      </details>

      {/* Raw JSON */}
      <details style={{ marginTop: 'var(--sp-2)' }}>
        <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
          Raw JSON
        </summary>
        <pre
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            background: 'var(--paper)',
            padding: 'var(--sp-4)',
            borderRadius: 'var(--radius-md)',
            overflow: 'auto',
            maxHeight: '300px',
            marginTop: 'var(--sp-2)',
          }}
        >
          {JSON.stringify(r, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/* ----------------------------- Contract Block ---------------------------- */

function ContractBlock({ contract }: { contract: Contract }) {
  const hasOps = contract.transactions.length > 0;

  return (
    <div className="contract-block">
      <div className="contract-header">
        <span className="contract-name">{contract.name}</span>
      </div>

      <div className="contract-body">
        <div className="contract-balance-line">
          <span className="contract-balance-label">Сальдо начальное:</span>{' '}
          <span className="contract-balance-value">{fmt(contract.openingBalance)}</span>
        </div>

        {hasOps && (
          <div className="contract-ops">
            {contract.transactions.map((t, i) => (
              <div key={i} className="contract-op-line">
                <span className="contract-op-date">{t.date}</span>
                <span className="contract-op-doc">{t.document}</span>
                <span className="contract-op-amt">
                  {t.debit !== null && <span className="contract-op-debit">{fmt(t.debit)} дебет</span>}
                  {t.credit !== null && <span className="contract-op-credit">{fmt(t.credit)} кредит</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        {(contract.turnoverDebit !== null || contract.turnoverCredit !== null) && (
          <div className="contract-turnovers-line">
            {contract.turnoverDebit !== null && <span>Оборот дебет: {fmt(contract.turnoverDebit)}</span>}
            {contract.turnoverCredit !== null && <span>Оборот кредит: {fmt(contract.turnoverCredit)}</span>}
          </div>
        )}

        <div className="contract-balance-line">
          <span className="contract-balance-label">Сальдо конечное:</span>{' '}
          <span className="contract-balance-value">{fmt(contract.closingBalance)}</span>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Helpers ----------------------------------- */

function fmt(val: number | null): string {
  if (val === null) return '—';
  return val.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
