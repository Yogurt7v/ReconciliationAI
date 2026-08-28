import { useCallback, useRef, useState } from 'react';

import { MAX_FILE_SIZE_BYTES } from '@recon/shared';

import { api } from '../api';
import { ApiError } from '../api';
import type { AiDebugInfo, ComparisonPair, ComparisonResult, ComparisonRow, DocType, Contract, DocumentData, PairStatus, Transaction, TestAnalyzeResponse } from '../api';
import { UploadCloudIcon, FileIcon } from '../components/icons';

const ACCEPT = '.xlsx,.xls,.pdf';
const MAX_MB = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));

interface Props {
  onBack: () => void;
}

interface FileSlot {
  file: File | null;
  busy: boolean;
  error: string | null;
  debugError: AiDebugInfo | null;
  result: TestAnalyzeResponse | null;
  data: DocumentData | null;
}

const emptySlot: FileSlot = {
  file: null,
  busy: false,
  error: null,
  debugError: null,
  result: null,
  data: null,
};

export default function TestScreen({ onBack }: Props) {
  const [slotA, setSlotA] = useState<FileSlot>(emptySlot);
  const [slotB, setSlotB] = useState<FileSlot>(emptySlot);
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

  const pickFile = (f: File, setSlot: React.Dispatch<React.SetStateAction<FileSlot>>) => {
    const problem = validate(f);
    if (problem) {
      setSlot((s) => ({ ...s, error: problem }));
      return;
    }
    setSlot({ ...emptySlot, file: f });
  };

  const analyzeSlot = useCallback(async (
    slot: FileSlot,
    setSlot: React.Dispatch<React.SetStateAction<FileSlot>>,
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
      analyzeSlot(slotA, setSlotA),
      analyzeSlot(slotB, setSlotB),
    ]);
  }, [slotA.file, slotB.file, analyzeSlot]);

  const updateDataA = (patch: Partial<DocumentData>) => {
    setSlotA((s) => s.data ? { ...s, data: { ...s.data, ...patch } } : s);
  };

  const updateDataB = (patch: Partial<DocumentData>) => {
    setSlotB((s) => s.data ? { ...s, data: { ...s.data, ...patch } } : s);
  };

  const updateContractA = (idx: number, patch: Partial<Contract>) => {
    setSlotA((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      contracts[idx] = { ...contracts[idx], ...patch } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const updateContractB = (idx: number, patch: Partial<Contract>) => {
    setSlotB((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      contracts[idx] = { ...contracts[idx], ...patch } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const updateTransactionA = (contractIdx: number, txIdx: number, patch: Partial<Transaction>) => {
    setSlotA((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      const contract = contracts[contractIdx];
      if (!contract) return s;
      const txs = [...contract.transactions];
      const tx = txs[txIdx];
      if (!tx) return s;
      txs[txIdx] = { ...tx, ...patch } as Transaction;
      contracts[contractIdx] = { ...contract, transactions: txs } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const updateTransactionB = (contractIdx: number, txIdx: number, patch: Partial<Transaction>) => {
    setSlotB((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      const contract = contracts[contractIdx];
      if (!contract) return s;
      const txs = [...contract.transactions];
      const tx = txs[txIdx];
      if (!tx) return s;
      txs[txIdx] = { ...tx, ...patch } as Transaction;
      contracts[contractIdx] = { ...contract, transactions: txs } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const addContractA = () => {
    setSlotA((s) => {
      if (!s.data) return s;
      return {
        ...s,
        data: {
          ...s.data,
          contracts: [
            ...s.data.contracts,
            { name: 'Новый договор', openingBalance: 0, closingBalance: 0, turnoverDebit: null, turnoverCredit: null, transactions: [] },
          ],
        },
      };
    });
  };

  const addContractB = () => {
    setSlotB((s) => {
      if (!s.data) return s;
      return {
        ...s,
        data: {
          ...s.data,
          contracts: [
            ...s.data.contracts,
            { name: 'Новый договор', openingBalance: 0, closingBalance: 0, turnoverDebit: null, turnoverCredit: null, transactions: [] },
          ],
        },
      };
    });
  };

  const removeContractA = (idx: number) => {
    setSlotA((s) => {
      if (!s.data) return s;
      return { ...s, data: { ...s.data, contracts: s.data.contracts.filter((_, i) => i !== idx) } };
    });
  };

  const removeContractB = (idx: number) => {
    setSlotB((s) => {
      if (!s.data) return s;
      return { ...s, data: { ...s.data, contracts: s.data.contracts.filter((_, i) => i !== idx) } };
    });
  };

  const addTransactionA = (contractIdx: number) => {
    setSlotA((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      const contract = contracts[contractIdx];
      if (!contract) return s;
      contracts[contractIdx] = { ...contract, transactions: [...contract.transactions, { date: '', document: '', debit: null, credit: null }] } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const addTransactionB = (contractIdx: number) => {
    setSlotB((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      const contract = contracts[contractIdx];
      if (!contract) return s;
      contracts[contractIdx] = { ...contract, transactions: [...contract.transactions, { date: '', document: '', debit: null, credit: null }] } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const removeTransactionA = (contractIdx: number, txIdx: number) => {
    setSlotA((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      const contract = contracts[contractIdx];
      if (!contract) return s;
      contracts[contractIdx] = { ...contract, transactions: contract.transactions.filter((_, i) => i !== txIdx) } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const removeTransactionB = (contractIdx: number, txIdx: number) => {
    setSlotB((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      const contract = contracts[contractIdx];
      if (!contract) return s;
      contracts[contractIdx] = { ...contract, transactions: contract.transactions.filter((_, i) => i !== txIdx) } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const compare = () => {
    const a = slotA.data;
    const b = slotB.data;
    if (!a || !b) return;

    const closingDiff = Math.abs(a.closingBalance - b.closingBalance);
    const balanceMatch = closingDiff < 0.02;

    const debitA = a.turnoverDebit ?? 0;
    const creditA = a.turnoverCredit ?? 0;
    const debitB = b.turnoverDebit ?? 0;
    const creditB = b.turnoverCredit ?? 0;

    const txsA: Transaction[] = [];
    const txsB: Transaction[] = [];
    for (const c of a.contracts) txsA.push(...c.transactions);
    for (const c of b.contracts) txsB.push(...c.transactions);

    const rowsA: ComparisonRow[] = [];
    const rowsB: ComparisonRow[] = [];
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <button className="btn btn-ghost btn-sm" onClick={onBack}>
              &larr; Назад
            </button>
            <h2>Тестовый анализ</h2>
          </div>
          <p className="muted" style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--text-sm)' }}>
            Загрузите два файла — ИИ извлечёт данные. Можно править вручную.
          </p>
        </div>

        <div className="upload-grid">
          <DropZone
            label="Файл А"
            file={slotA.file}
            busy={slotA.busy}
            over={overA}
            inputRef={inputRefA}
            onPick={(f) => pickFile(f, setSlotA)}
            onOver={setOverA}
          />
          <DropZone
            label="Файл Б"
            file={slotB.file}
            busy={slotB.busy}
            over={overB}
            inputRef={inputRefB}
            onPick={(f) => pickFile(f, setSlotB)}
            onOver={setOverB}
          />
        </div>

        <div className="upload-actions">
          <span className="muted">XLSX или PDF, до {MAX_MB} МБ</span>
          <button
            className="btn btn-primary"
            disabled={(!slotA.file && !slotB.file) || slotA.busy || slotB.busy}
            onClick={analyzeBoth}
          >
            {slotA.busy || slotB.busy ? 'Анализ…' : 'Анализировать'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="results-grid">
        <ResultColumn
          slot={slotA}
          label="А"
          updateData={updateDataA}
          updateContract={updateContractA}
          updateTransaction={updateTransactionA}
          addContract={addContractA}
          removeContract={removeContractA}
          addTransaction={addTransactionA}
          removeTransaction={removeTransactionA}
        />
        <ResultColumn
          slot={slotB}
          label="Б"
          updateData={updateDataB}
          updateContract={updateContractB}
          updateTransaction={updateTransactionB}
          addContract={addContractB}
          removeContract={removeContractB}
          addTransaction={addTransactionB}
          removeTransaction={removeTransactionB}
        />
      </div>

      {/* Compare button */}
      {slotA.data && slotB.data && (
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

/* ----------------------------- Drop Zone --------------------------------- */

function DropZone({
  label,
  file,
  busy,
  over,
  inputRef,
  onPick,
  onOver,
}: {
  label: string;
  file: File | null;
  busy: boolean;
  over: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (f: File) => void;
  onOver: (v: boolean) => void;
}) {
  const openPicker = () => inputRef.current?.click();

  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${file ? 'filled' : ''}`}
      onClick={openPicker}
      onDragOver={(e) => { e.preventDefault(); onOver(true); }}
      onDragLeave={() => onOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        onOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onPick(f);
      }}
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
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      {file ? (
        <>
          <FileIcon className="dropzone-icon" />
          <div className="dropzone-file">{file.name}</div>
          <div className="dropzone-hint">{busy ? 'Анализ…' : 'Нажмите или перетащите другой'}</div>
        </>
      ) : (
        <>
          <UploadCloudIcon className="dropzone-icon" />
          <div className="dropzone-label">{label}</div>
          <div className="dropzone-hint">Перетащите файл или нажмите</div>
        </>
      )}
    </div>
  );
}

/* ----------------------------- Result Column ----------------------------- */

interface ResultColumnProps {
  slot: FileSlot;
  label: string;
  updateData: (patch: Partial<DocumentData>) => void;
  updateContract: (idx: number, patch: Partial<Contract>) => void;
  updateTransaction: (contractIdx: number, txIdx: number, patch: Partial<Transaction>) => void;
  addContract: () => void;
  removeContract: (idx: number) => void;
  addTransaction: (contractIdx: number) => void;
  removeTransaction: (contractIdx: number, txIdx: number) => void;
}

function ResultColumn({
  slot,
  label,
  updateData,
  updateContract,
  updateTransaction,
  addContract,
  removeContract,
  addTransaction,
  removeTransaction,
}: ResultColumnProps) {
  if (slot.busy) {
    return (
      <div className="result-column">
        <div className="card" style={{ textAlign: 'center', padding: 'var(--sp-8)' }}>
          <div className="spinner" />
          <div style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--text-sm)' }}>Анализ файла {label}…</div>
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
        updateData={updateData}
        updateContract={updateContract}
        updateTransaction={updateTransaction}
        addContract={addContract}
        removeContract={removeContract}
        addTransaction={addTransaction}
        removeTransaction={removeTransaction}
      />
    </div>
  );
}

/* ----------------------------- Editable ---------------------------------- */

function EditableValue({
  value,
  onChange,
  mono = true,
}: {
  value: number;
  onChange: (v: number) => void;
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    setEditing(false);
    const parsed = parseFloat(draft.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isNaN(parsed)) {
      onChange(parsed);
    } else {
      setDraft(String(value));
    }
  };

  if (editing) {
    return (
      <input
        className="editable-input"
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setEditing(false);
            setDraft(String(value));
          }
        }}
        style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}
      />
    );
  }

  return (
    <span
      className="editable-value"
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}
    >
      {fmt(value)}
    </span>
  );
}

function EditableText({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft.trim()) {
      onChange(draft.trim());
    } else {
      setDraft(value);
    }
  };

  if (editing) {
    return (
      <input
        className="editable-input"
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setEditing(false);
            setDraft(value);
          }
        }}
      />
    );
  }

  return (
    <span
      className="editable-value"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}

/* ----------------------------- Debug Card -------------------------------- */

function DebugCard({ debug }: { debug: AiDebugInfo }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Диагностика AI</h2>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: '1.6' }}>
        <div><strong>Модель:</strong> {debug.model}</div>
        <div><strong>HTTP статус:</strong> {debug.httpStatus ?? '—'}</div>
        <div><strong>Попыток:</strong> {debug.attempts}</div>
        <div><strong>Длина ответа:</strong> {debug.contentLength} символов</div>
        <div><strong>Ошибка:</strong> {debug.errorMessage ?? '—'}</div>
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

/* ----------------------------- Result ------------------------------------ */

interface ResultCardProps {
  slot: FileSlot;
  label: string;
  updateData: (patch: Partial<DocumentData>) => void;
  updateContract: (idx: number, patch: Partial<Contract>) => void;
  updateTransaction: (contractIdx: number, txIdx: number, patch: Partial<Transaction>) => void;
  addContract: () => void;
  removeContract: (idx: number) => void;
  addTransaction: (contractIdx: number) => void;
  removeTransaction: (contractIdx: number, txIdx: number) => void;
}

function ResultCard({
  slot,
  label,
  updateData,
  updateContract,
  updateTransaction,
  addContract,
  removeContract,
  addTransaction,
  removeTransaction,
}: ResultCardProps) {
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
        <EditableValue value={data.openingBalance} onChange={(v) => updateData({ openingBalance: v })} />
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
              updateContract={updateContract}
              updateTransaction={updateTransaction}
              addTransaction={addTransaction}
              removeTransaction={removeTransaction}
              removeContract={removeContract}
            />
          ))}
        </div>
      )}

      <button className="btn btn-ghost btn-sm" onClick={addContract}>
        + Добавить договор
      </button>

      <div className="turnover-row">
        <div className="turnover-item">
          <span className="turnover-label">Оборот дебет</span>
          <EditableValue value={data.turnoverDebit ?? 0} onChange={(v) => updateData({ turnoverDebit: v })} />
        </div>
        <div className="turnover-item">
          <span className="turnover-label">Оборот кредит</span>
          <EditableValue value={data.turnoverCredit ?? 0} onChange={(v) => updateData({ turnoverCredit: v })} />
        </div>
      </div>

      <div className="balance-row">
        <span className="balance-label">Сальдо конечное</span>
        <EditableValue value={data.closingBalance} onChange={(v) => updateData({ closingBalance: v })} />
      </div>

      {d && (
        <details style={{ marginTop: 'var(--sp-3)' }}>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
            Диагностика AI
          </summary>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', background: 'var(--paper)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-md)', marginTop: 'var(--sp-2)', lineHeight: '1.6' }}>
            <div><strong>Модель:</strong> {d.model}</div>
            <div><strong>HTTP статус:</strong> {d.httpStatus ?? '—'}</div>
            <div><strong>Попыток:</strong> {d.attempts}</div>
            <div><strong>Длина ответа:</strong> {d.contentLength} символов</div>
            <div><strong>Ошибка:</strong> {d.errorMessage ?? '—'}</div>
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

/* ----------------------------- Contract Block ---------------------------- */

interface ContractBlockProps {
  contract: Contract;
  contractIdx: number;
  updateContract: (idx: number, patch: Partial<Contract>) => void;
  updateTransaction: (contractIdx: number, txIdx: number, patch: Partial<Transaction>) => void;
  addTransaction: (contractIdx: number) => void;
  removeTransaction: (contractIdx: number, txIdx: number) => void;
  removeContract: (idx: number) => void;
}

function ContractBlock({
  contract,
  contractIdx,
  updateContract,
  updateTransaction,
  addTransaction,
  removeTransaction,
  removeContract,
}: ContractBlockProps) {
  const hasOps = contract.transactions.length > 0;

  return (
    <div className="contract-block">
      <div className="contract-header">
        <EditableText
          value={contract.name}
          onChange={(v) => updateContract(contractIdx, { name: v })}
        />
        <button
          className="btn btn-ghost btn-xs contract-remove"
          onClick={() => removeContract(contractIdx)}
          title="Удалить договор"
        >
          &times;
        </button>
      </div>

      <div className="contract-body">
        <div className="contract-balance-line">
          <span className="contract-balance-label">Сальдо начальное:</span>{' '}
          <EditableValue
            value={contract.openingBalance}
            onChange={(v) => updateContract(contractIdx, { openingBalance: v })}
          />
        </div>

        {hasOps && (
          <div className="contract-ops">
            {contract.transactions.map((t, i) => (
              <div key={i} className="contract-op-line">
                <EditableText value={t.date} onChange={(v) => updateTransaction(contractIdx, i, { date: v })} />
                <EditableText value={t.document} onChange={(v) => updateTransaction(contractIdx, i, { document: v })} />
                <span className="contract-op-amt">
                  {t.debit !== null && (
                    <EditableValue
                      value={t.debit}
                      onChange={(v) => updateTransaction(contractIdx, i, { debit: v, credit: null })}
                    />
                  )}
                  {t.credit !== null && (
                    <EditableValue
                      value={t.credit}
                      onChange={(v) => updateTransaction(contractIdx, i, { credit: v, debit: null })}
                    />
                  )}
                </span>
                <button
                  className="btn btn-ghost btn-xs contract-op-remove"
                  onClick={() => removeTransaction(contractIdx, i)}
                  title="Удалить"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        <button className="btn btn-ghost btn-xs" onClick={() => addTransaction(contractIdx)}>
          + Добавить операцию
        </button>

        {(contract.turnoverDebit !== null || contract.turnoverCredit !== null) && (
          <div className="contract-turnovers-line">
            {contract.turnoverDebit !== null && (
              <span>Оборот дебет: <EditableValue value={contract.turnoverDebit} onChange={(v) => updateContract(contractIdx, { turnoverDebit: v })} /></span>
            )}
            {contract.turnoverCredit !== null && (
              <span>Оборот кредит: <EditableValue value={contract.turnoverCredit} onChange={(v) => updateContract(contractIdx, { turnoverCredit: v })} /></span>
            )}
          </div>
        )}

        <div className="contract-balance-line">
          <span className="contract-balance-label">Сальдо конечное:</span>{' '}
          <EditableValue
            value={contract.closingBalance}
            onChange={(v) => updateContract(contractIdx, { closingBalance: v })}
          />
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

/* ----------------------------- Doc Type Detection ------------------------- */

function detectDocType(doc: string): DocType {
  const lower = doc.toLowerCase();
  if (/продаж|реализ|выпис/.test(lower)) return 'продажа';
  if (/приход|поступл/.test(lower)) return 'приход';
  if (/оплат|перечислен|взнос/.test(lower)) return 'оплата';
  if (/остат|сальдо/.test(lower)) return 'остаток';
  return 'прочее';
}

const DOC_TYPE_MATCH: Record<DocType, DocType> = {
  'продажа': 'приход',
  'приход': 'продажа',
  'оплата': 'оплата',
  'остаток': 'остаток',
  'прочее': 'прочее',
};

function canMatchTypes(a: DocType, b: DocType): boolean {
  return DOC_TYPE_MATCH[a] === b || a === b;
}

/* ----------------------------- Build Pairs ------------------------------- */

function buildPairs(rows: ComparisonRow[]): ComparisonPair[] {
  const aRows = rows.filter((r) => r.side === 'A');
  const bRows = rows.filter((r) => r.side === 'B');
  const usedB = new Set<ComparisonRow>();
  const pairs: ComparisonPair[] = [];
  let idx = 0;

  for (const rowA of aRows) {
    const pairB = rowA.matchedWith ? bRows.find((r) => r.tx === rowA.matchedWith) : null;
    if (pairB && rowA.status === 'match') {
      usedB.add(pairB);
      pairs.push({
        index: ++idx,
        pairStatus: 'match',
        typeA: rowA.docType,
        typeB: pairB.docType,
        a: rowA,
        b: pairB,
      });
    } else if (pairB && rowA.status === 'partial') {
      usedB.add(pairB);
      pairs.push({
        index: ++idx,
        pairStatus: 'partial',
        typeA: rowA.docType,
        typeB: pairB.docType,
        a: rowA,
        b: pairB,
        diff: rowA.diff,
      });
    } else {
      pairs.push({
        index: ++idx,
        pairStatus: 'unmatched-a',
        typeA: rowA.docType,
        typeB: 'прочее',
        a: rowA,
        b: null,
      });
    }
  }

  for (const rowB of bRows) {
    if (usedB.has(rowB)) continue;
    pairs.push({
      index: ++idx,
      pairStatus: 'unmatched-b',
      typeA: 'прочее',
      typeB: rowB.docType,
      a: null,
      b: rowB,
    });
  }

  return pairs;
}

function pairStatusLabel(ps: PairStatus): string {
  switch (ps) {
    case 'match': return '✓ Совпало';
    case 'partial': return '⚠ Расхождение';
    case 'unmatched-a': return '✗ Не найдено в контрагенте';
    case 'unmatched-b': return '✗ Не найдено в нашей стороне';
  }
}

function pairTypeLabel(a: DocType, b: DocType, ps: PairStatus): string {
  if (ps === 'unmatched-a') return a;
  if (ps === 'unmatched-b') return b;
  if (a === b) return a;
  return `${a} ↔ ${b}`;
}

/* ----------------------------- Comparison Card ---------------------------- */

function ComparisonCard({ comparison }: { comparison: ComparisonResult }) {
  const { balanceCheck: bc, turnoverCheck: tc, rows } = comparison;
  const pairs = buildPairs(rows);
  const matched = pairs.filter((p) => p.pairStatus === 'match').length;
  const partial = pairs.filter((p) => p.pairStatus === 'partial').length;
  const unmatched = pairs.filter((p) => p.pairStatus.startsWith('unmatched')).length;

  return (
    <div className="card comparison-card">
      <h3 style={{ margin: '0 0 var(--sp-3)' }}>Результат сверки</h3>

      {/* Сальдо */}
      <div className="comparison-section">
        <div className="comparison-row">
          <span>Сальдо конечное:</span>
          <span className={bc.match ? 'match' : 'mismatch'}>
            {fmt(bc.closingA)} = {fmt(bc.closingB)}
            {bc.match ? ' ✓' : ` (разница: ${fmt(Math.abs(bc.diff))}) ✗`}
          </span>
        </div>
      </div>

      {/* Обороты */}
      <div className="comparison-section">
        <div className="comparison-row">
          <span>Дебет А = Дебет Б:</span>
          <span className={tc.debitA_eq_debitB ? 'match' : 'mismatch'}>
            {fmt(tc.debitA)} = {fmt(tc.debitB)}
            {tc.debitA_eq_debitB ? ' ✓' : ' ✗'}
          </span>
        </div>
        <div className="comparison-row">
          <span>Кредит А = Кредит Б:</span>
          <span className={tc.creditA_eq_creditB ? 'match' : 'mismatch'}>
            {fmt(tc.creditA)} = {fmt(tc.creditB)}
            {tc.creditA_eq_creditB ? ' ✓' : ' ✗'}
          </span>
        </div>
      </div>

      {/* Сводка */}
      <div className="comparison-section">
        <div className="comparison-row" style={{ fontWeight: 600 }}>
          <span>Документы:</span>
          <span>
            {matched} совпало, {partial} расхождение, {unmatched} непарных
          </span>
        </div>
      </div>

      {/* Пары */}
      <div className="comparison-pairs">
        {pairs.map((pair) => (
          <div
            key={pair.index}
            className={`comparison-pair comparison-pair--${pair.pairStatus}`}
          >
            <div className="comparison-pair-header">
              <span className="pair-number">#{pair.index}</span>
              <span className={`pair-status pair-status--${pair.pairStatus}`}>
                {pairStatusLabel(pair.pairStatus)}
              </span>
              <span className="pair-type">
                {pairTypeLabel(pair.typeA, pair.typeB, pair.pairStatus)}
              </span>
              <span className="pair-amount">
                {pair.a ? fmt(pair.a.tx.debit ?? pair.a.tx.credit) : ''}
                {pair.b && !pair.a ? fmt(pair.b.tx.debit ?? pair.b.tx.credit) : ''}
                {pair.diff !== undefined && pair.diff > 0 ? (
                  <span className="pair-diff"> Δ {fmt(pair.diff)}</span>
                ) : null}
              </span>
            </div>
            <div className="comparison-pair-body">
              {pair.a && (
                <div className={`pair-side ${pair.pairStatus === 'unmatched-a' ? 'pair-side--unmatched' : ''}`}>
                  <span className="pair-side-label">Наша сторона</span>
                  <span className="pair-side-date">{pair.a.tx.date}</span>
                  <span className="pair-side-doc">{pair.a.tx.document}</span>
                  <span className="pair-side-amt">{fmt(pair.a.tx.debit ?? pair.a.tx.credit)}</span>
                </div>
              )}
              {pair.b && (
                <div className={`pair-side ${pair.pairStatus === 'unmatched-b' ? 'pair-side--unmatched' : ''}`}>
                  <span className="pair-side-label">Контрагент</span>
                  <span className="pair-side-date">{pair.b.tx.date}</span>
                  <span className="pair-side-doc">{pair.b.tx.document}</span>
                  <span className="pair-side-amt">{fmt(pair.b.tx.debit ?? pair.b.tx.credit)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
