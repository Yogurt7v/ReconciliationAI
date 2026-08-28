import { useCallback, useRef, useState } from 'react';

import { MAX_FILE_SIZE_BYTES } from '@recon/shared';

import { api, ApiError } from '../api';
import type { ComparisonResult, DocumentData } from '../api';
import { useEditableData, emptySlot } from '../hooks/useEditableData';
import { DropZone } from '../components/DropZone';
import { DebugCard } from '../components/DebugCard';
import { ContractBlock } from '../components/ContractBlock';
import { EditableValue } from '../components/EditableValue';
import { ComparisonCard } from '../components/ComparisonCard';

const MAX_MB = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));

interface Props {
  onBack?: () => void;
}

export default function MainScreen({ onBack }: Props) {
  const slotA = useEditableData();
  const slotB = useEditableData();
  const [overA, setOverA] = useState(false);
  const [overB, setOverB] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
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
      const res = await api.testAnalyze(slot.file);
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
  }, []);

  const analyzeBoth = useCallback(async () => {
    await Promise.all([
      analyzeSlot(slotA.slot, slotA.setSlot),
      analyzeSlot(slotB.slot, slotB.setSlot),
    ]);
  }, [slotA.slot.file, slotB.slot.file, analyzeSlot]);

  const compare = () => {
    const a = slotA.slot.data;
    const b = slotB.slot.data;
    if (!a || !b) return;

    const closingDiff = Math.abs(a.closingBalance - b.closingBalance);
    const balanceMatch = closingDiff < 0.02;

    const debitA = a.turnoverDebit ?? 0;
    const creditA = a.turnoverCredit ?? 0;
    const debitB = b.turnoverCredit ?? 0;
    const creditB = b.turnoverDebit ?? 0;

    const txsA = a.contracts.flatMap((c) => c.transactions);
    const txsB = b.contracts.flatMap((c) => c.transactions);

    const rowsA: import('../api').ComparisonRow[] = [];
    const rowsB: import('../api').ComparisonRow[] = [];
    const usedB = new Set<number>();

    for (const txA of txsA) {
      const typeA = detectDocType(txA.document);
      const amtA = txA.debit ?? txA.credit ?? 0;

      let bestJ = -1;
      let bestDiff = Infinity;
      for (let j = 0; j < txsB.length; j++) {
        if (usedB.has(j)) continue;
        const txB = txsB[j];
        if (!txB) continue;
        const typeB = detectDocType(txB.document);
        if (!canMatchTypes(typeA, typeB)) continue;
        const amtB = txB.debit ?? txB.credit ?? 0;
        const diff = Math.abs(amtA - amtB);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestJ = j;
        }
      }

      if (bestJ >= 0 && bestDiff < 0.02) {
        const txB = txsB[bestJ];
        if (txB) {
          rowsA.push({ side: 'A', tx: txA, docType: typeA, matchedWith: txB, status: 'match' });
          rowsB.push({ side: 'B', tx: txB, docType: detectDocType(txB.document), matchedWith: txA, status: 'match' });
          usedB.add(bestJ);
        }
      } else if (bestJ >= 0 && bestDiff < 1) {
        const txB = txsB[bestJ];
        if (txB) {
          rowsA.push({ side: 'A', tx: txA, docType: typeA, matchedWith: txB, status: 'partial', diff: bestDiff });
          rowsB.push({ side: 'B', tx: txB, docType: detectDocType(txB.document), matchedWith: txA, status: 'partial', diff: bestDiff });
          usedB.add(bestJ);
        }
      } else {
        rowsA.push({ side: 'A', tx: txA, docType: typeA, matchedWith: null, status: 'unmatched' });
      }
    }

    for (let j = 0; j < txsB.length; j++) {
      if (usedB.has(j)) continue;
      const txB = txsB[j];
      if (txB) {
        rowsB.push({ side: 'B', tx: txB, docType: detectDocType(txB.document), matchedWith: null, status: 'unmatched' });
      }
    }

    setComparison({
      balanceCheck: {
        closingA: a.closingBalance,
        closingB: b.closingBalance,
        match: balanceMatch,
        diff: a.closingBalance - b.closingBalance,
      },
      turnoverCheck: {
        debitA,
        creditA,
        debitB,
        creditB,
        debitA_eq_debitB: Math.abs(debitA - debitB) < 0.02,
        creditA_eq_creditB: Math.abs(creditA - creditB) < 0.02,
      },
      rows: [...rowsA, ...rowsB],
    });
  };

  return (
    <div>
      {/* Upload zone */}
      <div className="card">
        <div className="card-header">
          <h2>ИИ Анализ актов сверок</h2>
          <p className="muted" style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--text-sm)' }}>
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
        />
        <ResultColumn
          slot={slotB.slot}
          label="Б"
          updaters={slotB}
        />
      </div>

      {/* Compare button */}
      {slotA.slot.data && slotB.slot.data && (
        <div style={{ textAlign: 'center', margin: 'var(--sp-4) 0' }}>
          <button className="btn btn-primary" onClick={compare}>
            Сверить
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
}

function ResultColumn({ slot, label, updaters }: ResultColumnProps) {
  if (slot.busy) {
    return (
      <div className="result-column">
        <div className="card" style={{ textAlign: 'center', padding: 'var(--sp-8)' }}>
          <div className="spinner" />
          <div style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--text-sm)' }}>Анализ файла {label}...</div>
        </div>
      </div>
    );
  }

  if (slot.error) {
    return (
      <div className="result-column">
        <div className="banner banner-error">{slot.error}</div>
        {slot.debugError && <DebugCard debug={slot.debugError} />}
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
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <h2 style={{ fontSize: 'var(--text-base)' }}>Файл {label}</h2>
          <span className="badge badge-info">{slot.result?.fileName}</span>
          {slot.result?.sheetName && <span className="badge badge-info">{slot.result.sheetName}</span>}
        </div>
      </div>

      <div className="balance-row">
        <span className="balance-label">Сальдо начальное</span>
        <EditableValue value={data.openingBalance} onChange={(v) => updaters.updateData({ openingBalance: v })} />
      </div>

      {data.contracts.length === 0 ? (
        <div className="empty-state">Договоры не найдены</div>
      ) : (
        <div style={{ marginBottom: 'var(--sp-3)' }}>
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
        <details style={{ marginTop: 'var(--sp-3)' }}>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
            Диагностика AI
          </summary>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', background: 'var(--paper)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-md)', marginTop: 'var(--sp-2)', lineHeight: '1.6' }}>
            <div><strong>Модель:</strong> {d.model}</div>
            <div><strong>HTTP статус:</strong> {d.httpStatus ?? '---'}</div>
            <div><strong>Попыток:</strong> {d.attempts}</div>
            <div><strong>Длина ответа:</strong> {d.contentLength} символов</div>
            <div><strong>Ошибка:</strong> {d.errorMessage ?? '---'}</div>
            {d.rawPreview && (
              <pre style={{ margin: 'var(--sp-2) 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '100px', overflow: 'auto' }}>
                {d.rawPreview}
              </pre>
            )}
          </div>
        </details>
      )}

      <details style={{ marginTop: 'var(--sp-2)' }}>
        <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
          Raw JSON
        </summary>
        <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', background: 'var(--paper)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-md)', overflow: 'auto', maxHeight: '200px', marginTop: 'var(--sp-2)' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/* ----------------------------- Helpers ----------------------------------- */

function detectDocType(doc: string): import('../api').DocType {
  const lower = doc.toLowerCase();
  if (/продаж|реализ|выпис/.test(lower)) return 'продажа';
  if (/приход|поступл/.test(lower)) return 'приход';
  if (/оплат|перечислен|взнос/.test(lower)) return 'оплата';
  if (/остат|сальдо/.test(lower)) return 'остаток';
  return 'прочее';
}

const DOC_TYPE_MATCH: Record<import('../api').DocType, import('../api').DocType> = {
  'продажа': 'приход',
  'приход': 'продажа',
  'оплата': 'оплата',
  'остаток': 'остаток',
  'прочее': 'прочее',
};

function canMatchTypes(a: import('../api').DocType, b: import('../api').DocType): boolean {
  return DOC_TYPE_MATCH[a] === b || a === b;
}
