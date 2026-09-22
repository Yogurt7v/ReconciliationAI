import { useState, useEffect } from 'react';
import { DEFAULT_MODEL, API_KEY_STORAGE_KEY } from '../config';

export function useModelSetting() {
  const [model, setModel] = useState<string>(() => {
    return localStorage.getItem('selected_ai_model') || DEFAULT_MODEL;
  });

  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  });

  useEffect(() => {
    localStorage.setItem('selected_ai_model', model);
  }, [model]);

  useEffect(() => {
    if (apiKey) {
      localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  }, [apiKey]);

  return [model, setModel, apiKey, setApiKey] as const;
}
