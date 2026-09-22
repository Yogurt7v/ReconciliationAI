import { useState, useCallback, useEffect } from 'react';

import { DEFAULT_MODEL, MODEL_STORAGE_KEY, API_KEY_STORAGE_KEY } from '../config';

function readStoredModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

function readStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function useModelSetting() {
  const [model, setModelState] = useState<string>(readStoredModel);
  const [apiKey, setApiKeyState] = useState<string>(readStoredApiKey);

  useEffect(() => {
    // Синхронизация при монтировании (если данные изменились в другом месте)
    setModelState(readStoredModel());
    setApiKeyState(readStoredApiKey());
  }, []);

  const setModel = useCallback((next: string) => {
    const value = next.trim() || DEFAULT_MODEL;
    setModelState(value);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, value);
    } catch { /* noop */ }
  }, []);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    try {
      localStorage.setItem(API_KEY_STORAGE_KEY, key);
    } catch { /* noop */ }
  }, []);

  return [model, setModel, apiKey, setApiKey] as const;
}
