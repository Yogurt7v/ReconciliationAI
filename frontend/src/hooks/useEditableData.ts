import { useState } from 'react';

import type { AiDebugInfo, Contract, DocumentData, TestAnalyzeResponse, Transaction } from '../api';

export interface FileSlot {
  file: File | null;
  busy: boolean;
  error: string | null;
  debugError: AiDebugInfo | null;
  result: TestAnalyzeResponse | null;
  data: DocumentData | null;
}

export const emptySlot: FileSlot = {
  file: null,
  busy: false,
  error: null,
  debugError: null,
  result: null,
  data: null,
};

export function useEditableData() {
  const [slot, setSlot] = useState<FileSlot>(emptySlot);

  const updateData = (patch: Partial<DocumentData>) => {
    setSlot((s) => s.data ? { ...s, data: { ...s.data, ...patch } } : s);
  };

  const updateContract = (idx: number, patch: Partial<Contract>) => {
    setSlot((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      contracts[idx] = { ...contracts[idx], ...patch } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const updateTransaction = (contractIdx: number, txIdx: number, patch: Partial<Transaction>) => {
    setSlot((s) => {
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

  const addContract = () => {
    setSlot((s) => {
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

  const removeContract = (idx: number) => {
    setSlot((s) => {
      if (!s.data) return s;
      return { ...s, data: { ...s.data, contracts: s.data.contracts.filter((_, i) => i !== idx) } };
    });
  };

  const addTransaction = (contractIdx: number) => {
    setSlot((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      const contract = contracts[contractIdx];
      if (!contract) return s;
      contracts[contractIdx] = { ...contract, transactions: [...contract.transactions, { date: '', document: '', debit: null, credit: null }] } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  const removeTransaction = (contractIdx: number, txIdx: number) => {
    setSlot((s) => {
      if (!s.data) return s;
      const contracts = [...s.data.contracts];
      const contract = contracts[contractIdx];
      if (!contract) return s;
      contracts[contractIdx] = { ...contract, transactions: contract.transactions.filter((_, i) => i !== txIdx) } as Contract;
      return { ...s, data: { ...s.data, contracts } };
    });
  };

  return {
    slot,
    setSlot,
    updateData,
    updateContract,
    updateTransaction,
    addContract,
    removeContract,
    addTransaction,
    removeTransaction,
  };
}
