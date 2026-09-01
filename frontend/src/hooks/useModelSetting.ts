import { useState, useCallback } from 'react';

import { DEFAULT_MODEL, MODEL_STORAGE_KEY } from '../config';

function readStored(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function useModelSetting() {
  const [model, setModelState] = useState<string>(readStored);

  const setModel = useCallback((next: string) => {
    const value = next.trim() || DEFAULT_MODEL;
    setModelState(value);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, value);
    } catch { /* noop */ }
  }, []);

  return [model, setModel] as const;
}
