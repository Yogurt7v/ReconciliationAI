import { useEffect, useState } from 'react';

import { api, type AiRuntimeInfo } from '../api';

/**
 * Конфигурация backend по умолчанию — то, чем считалось бы задание **без**
 * сохранённого в браузере профиля.
 *
 * Значок модели в шапке отсюда больше не берётся: маршрут `/api/health` общий для
 * всех, кто зашёл на этот backend, а профиль и удалённый запуск живут в конкретном
 * браузере и в конкретном задании (см. `useAiModelBadge`). Осталось это как запасной
 * вариант и как признак «backend недоступен».
 *
 * Значение — снимок на момент монтирования, и это здесь уместно: настройки
 * сервера меняются перезапуском, а не сохранением профиля.
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
