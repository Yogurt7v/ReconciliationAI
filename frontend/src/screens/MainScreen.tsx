import { useCallback, useRef, useState } from 'react';

import { MAX_FILE_SIZE_BYTES } from '@recon/shared';

import { api, ApiError } from '../api';
import type { CompareResult, DocumentData } from '../api';
import { useEditableData, emptySlot } from '../hooks/useEditableData';
import { DropZone } from '../components/DropZone';
import { DebugCard } from '../components/DebugCard';
import { ContractBlock } from '../components/ContractBlock';
import { EditableValue } from '../components/EditableValue';
import { ComparisonCard } from '../components/ComparisonCard';
import { SwapIcon } from '../components/icons';

const MAX_MB = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));

interface Props {
  model: string;
  apiKey: string;
  onBack?: () => void;
}

export default function MainScreen({ model, apiKey, onBack }: Props) {
  const slotA = useEditableData();
  const slotB = useEditableData();
  const [overA, setOverA] = useState(false);
  const [overB, setOverB] = useState(false);
  const [comparison, setComparison] = useState<(CompareResult & { debug?: import('../api').AiDebugInfo }) | null>(null);
  const [comparing, setComparing] = useState(false);
  const inputRefA = useRef<HTMLInputElement>(null);
  const inputRefB = useRef<HTMLInputElement>(null);

  const validate = (f: File): string | null => {
    if (!/\.(xlsx|xls|pdf)$/i.test(f.name)) return 'Поддерживаются только XLSX и PDF.';
    if (f.size > MAX_FILE_SIZE_BYTES) return `Файл больше ${MAX_MB} МБ.`;
    return null;
  };

  const pickFile = (f: File, setSlot: typeof slotA.setSlot) => {
    const problem = validate(f);
    if (problem) {
      setSlot((s) => ({ ...s, error: problem }));
      return;
    }
    setSlot({ ...emptySlot, file: f });
  };

  const analyzeSlot = useCallback(async (
    slot: typeof slotA.slot,
    setSlot: typeof slotA.setSlot,
  ) => {
    if (!slot.file) return;
    setSlot((s) => ({ ...s, busy: true, error: null, debugError: null }));
    try {
      const res = await api.testAnalyze(slot.file, model, apiKey);
      setSlot((s) => ({ ...s, result: res, data: structuredClone(res.result), busy: false }));
    } catch (err) {
      const debug = err instanceof ApiError ? (err.debug ?? null) : null;
      setSlot((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Не удалось выполнить анализ',
        debugError: debug,
        busy: false,
      }));
    }
  }, [model, apiKey]);

  const analyzeBoth = useCallback(async () => {
    await Promise.all([
      !slotA.slot.data ? analyzeSlot(slotA.slot, slotA.setSlot) : Promise.resolve(),
      !slotB.slot.data ? analyzeSlot(slotB.slot, slotB.setSlot) : Promise.resolve(),
    ]);
  }, [slotA.slot.file, slotB.slot.file, slotA.slot.data, slotB.slot.data, analyzeSlot]);

  const compare = useCallback(async () => {
    const a = slotA.slot.data;
    const b = slotB.slot.data;
    if (!a || !b) return;

    setComparing(true);
    try {
      const result = await api.compare(a, b, model, apiKey);
      setComparison(result);
    } catch (err) {
      const debug = err instanceof ApiError ? (err.debug ?? null) : null;
      setComparison({
        summary: {
          yourTotalRows: a.totalRows,
          partnerTotalRows: b.totalRows,
          yourOpeningBalance: a.openingBalance,
          partnerOpeningBalance: b.openingBalance,
          yourClosingBalance: a.closingBalance,
          partnerClosingBalance: b.closingBalance,
          yourTurnoverDebit: a.turnoverDebit ?? 0,
          partnerTurnoverDebit: b.turnoverDebit ?? 0,
          yourTurnoverCredit: a.turnoverCredit ?? 0,
          partnerTurnoverCredit: b.turnoverCredit ?? 0,
          openingMatch: Math.abs(a.openingBalance - b.openingBalance) < 0.02,
          closingMatch: Math.abs(a.closingBalance - b.closingBalance) < 0.02,
          debitMatch: Math.abs((a.turnoverDebit ?? 0) - (b.turnoverDebit ?? 0)) < 0.02,
          creditMatch: Math.abs((a.turnoverCredit ?? 0) - (b.turnoverCredit ?? 0)) < 0.02,
          openingDiff: b.openingBalance - a.openingBalance,
          closingDiff: b.closingBalance - a.closingBalance,
          debitDiff: (b.turnoverDebit ?? 0) - (a.turnoverDebit ?? 0),
          creditDiff: (b.turnoverCredit ?? 0) - (a.turnoverCredit ?? 0),
        },
        matched: [],
        onlyInYour: [],
        onlyInPartner: [],
        diffs: [],
        finalBalance: { yourDebt: 0, partnerDebt: 0 },
        aiAnalysis: 'Сравнение недоступно.',
        debug: debug ?? undefined,
      });
    } finally {
      setComparing(false);
    }
  }, [slotA.slot.data, slotB.slot.data, model, apiKey]);

  return (
    <div>
      {/* Upload zone */}
      <div className="card animate-in">
        <div className="card-header">
          <h2>ИИ Анализ актов сверок</h2>
          <p className="muted card-subtitle">
            Загрузите два файла — ИИ извлечёт данные. Можно править вручную. А потом сравнит их.
          </p>
        </div>

        <div className="upload-grid">
          <DropZone
            label="Файл А"
            file={slotA.slot.file}
            busy={slotA.slot.busy}
            over={overA}
            inputRef={inputRefA}
            onPick={(f) => pickFile(f, slotA.setSlot)}
            onOver={setOverA}
          />
          <DropZone
            label="Файл Б"
            file={slotB.slot.file}
            busy={slotB.slot.busy}
            over={overB}
            inputRef={inputRefB}
            onPick={(f) => pickFile(f, slotB.setSlot)}
            onOver={setOverB}
          />
        </div>

        <div className="upload-actions">
          <span className="muted">XLSX или PDF, до {MAX_MB} МБ</span>
          <button
            className="btn btn-primary"
            disabled={(!slotA.slot.file && !slotB.slot.file) || slotA.slot.busy || slotB.slot.busy}
            onClick={analyzeBoth}
          >
            {slotA.slot.busy || slotB.slot.busy ? 'Анализ...' : 'Анализировать'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="results-grid">
        <ResultColumn
          slot={slotA.slot}
          label="А"
          updaters={slotA}
          onRetry={() => analyzeSlot(slotA.slot, slotA.setSlot)}
        />
        <ResultColumn
          slot={slotB.slot}
          label="Б"
          updaters={slotB}
          onRetry={() => analyzeSlot(slotB.slot, slotB.setSlot)}
        />
      </div>

      {/* Compare button */}
      {slotA.slot.data && slotB.slot.data && (
        <div className="compare-actions">
          <button className="btn btn-primary" onClick={compare} disabled={comparing}>
            <SwapIcon />
            {comparing ? 'Сравнение...' : 'Сверить'}
          </button>
        </div>
      )}

      {/* Comparison result */}
      {comparison && <ComparisonCard comparison={comparison} />}
    </div>
  );
}

/* ----------------------------- Result Column ----------------------------- */

interface SlotUpdaters {
  updateData: (patch: Partial<DocumentData>) => void;
  updateContract: (idx: number, patch: Partial<import('../api').Contract>) => void;
  updateTransaction: (contractIdx: number, txIdx: number, patch: Partial<import('../api').Transaction>) => void;
  addContract: () => void;
  removeContract: (idx: number) => void;
  addTransaction: (contractIdx: number) => void;
  removeTransaction: (contractIdx: number, txIdx: number) => void;
}

interface ResultColumnProps {
  slot: import('../hooks/useEditableData').FileSlot;
  label: string;
  updaters: SlotUpdaters;
  onRetry: () => void;
}

function ResultColumn({ slot, label, updaters, onRetry }: ResultColumnProps) {
  if (slot.busy) {
    return (
      <div className="result-column">
        <div className="card card--centered">
          <div className="skeleton skeleton-row" style={{ width: '60%', margin: '0 auto var(--sp-2)' }} />
          <div className="skeleton skeleton-row" style={{ width: '80%', margin: '0 auto var(--sp-2)' }} />
          <div className="skeleton skeleton-row" style={{ width: '40%', margin: '0 auto' }} />
          <div className="mt-3" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
            Анализ файла {label}...
          </div>
        </div>
      </div>
    );
  }

  if (slot.error) {
    return (
      <div className="result-column">
        <div className="banner banner-error">{slot.error}</div>
        {slot.debugError && <DebugCard debug={slot.debugError} />}
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--sp-3)' }} onClick={onRetry}>
          Повторить
        </button>
      </div>
    );
  }

  if (!slot.data) {
    return <div className="result-column" />;
  }

  return (
    <div className="result-column">
      <ResultCard
        slot={slot}
        label={label}
        updaters={updaters}
      />
    </div>
  );
}

/* ----------------------------- Result ------------------------------------ */

interface ResultCardProps {
  slot: import('../hooks/useEditableData').FileSlot;
  label: string;
  updaters: SlotUpdaters;
}

function ResultCard({ slot, label, updaters }: ResultCardProps) {
  const data = slot.data!;
  const d = slot.debugError;

  return (
    <div className="card animate-in">
      <div className="card-header">
        <div className="flex-gap-3">
          <h2 className="card-title">Файл {label}</h2>
          <span className="badge badge-info">{slot.result?.fileName}</span>
          {slot.result?.sheetName && <span className="badge badge-info">{slot.result.sheetName}</span>}
        </div>
      </div>

      {slot.result?.warnings && slot.result.warnings.length > 0 && (
        <div className="banner banner-warning">
          <strong>Внимание:</strong>
          <ul className="mt-2 mb-0 ps-4">
            {slot.result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="balance-row">
        <span className="balance-label">Сальдо начальное</span>
        <EditableValue value={data.openingBalance} onChange={(v) => updaters.updateData({ openingBalance: v })} />
      </div>

      {data.contracts.length === 0 ? (
        <div className="empty-state">Договоры не найдены</div>
      ) : (
        <div className="mb-3">
          {data.contracts.map((contract, i) => (
            <ContractBlock
              key={i}
              contract={contract}
              contractIdx={i}
              updateContract={updaters.updateContract}
              updateTransaction={updaters.updateTransaction}
              addTransaction={updaters.addTransaction}
              removeTransaction={updaters.removeTransaction}
              removeContract={updaters.removeContract}
            />
          ))}
        </div>
      )}

      <button className="btn btn-ghost btn-sm" onClick={updaters.addContract}>
        + Добавить договор
      </button>

      <div className="turnover-row">
        <div className="turnover-item">
          <span className="turnover-label">Оборот дебет</span>
          <EditableValue value={data.turnoverDebit ?? 0} onChange={(v) => updaters.updateData({ turnoverDebit: v })} />
        </div>
        <div className="turnover-item">
          <span className="turnover-label">Оборот кредит</span>
          <EditableValue value={data.turnoverCredit ?? 0} onChange={(v) => updaters.updateData({ turnoverCredit: v })} />
        </div>
      </div>

      <div className="balance-row">
        <span className="balance-label">Сальдо конечное</span>
        <EditableValue value={data.closingBalance} onChange={(v) => updaters.updateData({ closingBalance: v })} />
      </div>

      {d && (
        <details>
          <summary>Диагностика AI</summary>
          <div className="details-code-panel">
            <div><strong>Модель:</strong> {d.model}</div>
            <div><strong>HTTP статус:</strong> {d.httpStatus ?? '---'}</div>
            <div><strong>Попыток:</strong> {d.attempts}</div>
            <div><strong>Длина ответа:</strong> {d.contentLength} символов</div>
            <div><strong>Ошибка:</strong> {d.errorMessage ?? '---'}</div>
            {d.rawPreview && (
              <pre className="details-pre">
                {d.rawPreview}
              </pre>
            )}
          </div>
        </details>
      )}

      <details>
        <summary>Raw JSON</summary>
        <pre className="details-json-pre">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
