import { useEffect, useState } from 'react';

import { api, type AiRuntimeInfo } from '../api';

/**
 * Фактическая AI-конфигурация backend — чтобы показать пользователю, какая
 * модель применяется на самом деле (OLLAMA_MODEL из settings.txt) и предупредить,
 * если backend недоступен.
 */
export function useAiRuntime(): AiRuntimeInfo | null {
  const [info, setInfo] = useState<AiRuntimeInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .health()
      .then((res) => {
        if (alive) setInfo(res.ai);
      })
      .catch(() => {
        // backend недоступен или старая версия без поля ai — не критично
        if (alive) setInfo(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return info;
}
