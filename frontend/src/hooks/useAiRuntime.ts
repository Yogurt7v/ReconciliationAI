import { useEffect, useState } from 'react';

import { api, type AiRuntimeInfo } from '../api';

/**
 * Фактическая AI-конфигурация backend.
 *
 * Нужна, потому что выбранная в UI модель может не совпадать с реально
 * применяемой: в режиме REQUIRE_LOCAL_ONLY облачные ID игнорируются, и
 * backend подставляет локальную модель из OLLAMA_MODEL.
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
