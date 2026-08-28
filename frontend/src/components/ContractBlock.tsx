import type { Contract, Transaction } from '../api';
import { EditableValue } from './EditableValue';
import { EditableText } from './EditableText';

interface ContractBlockProps {
  contract: Contract;
  contractIdx: number;
  updateContract: (idx: number, patch: Partial<Contract>) => void;
  updateTransaction: (contractIdx: number, txIdx: number, patch: Partial<Transaction>) => void;
  addTransaction: (contractIdx: number) => void;
  removeTransaction: (contractIdx: number, txIdx: number) => void;
  removeContract: (idx: number) => void;
}

export function ContractBlock({
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
