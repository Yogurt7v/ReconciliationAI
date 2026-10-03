import type { AiDebugInfo } from '../api';
import { providerLabel } from '../hooks/useAiModelBadge';

interface AiDebugRowsProps {
  debug: AiDebugInfo;
}

/**
 * Строки диагностики одного AI-вызова — общие для карточки отказа и для
 * свёрнутого блока под результатом, чтобы «что за модель» и «сколько токенов»
 * читались на обоих экранах одинаково.
 *
 * Две строки о модели, а не одна, — потому что это **разные** значения:
 * `effectiveModel` — та, что реально ответила, `model` — та, что запрошена.
 * На отказе первая пуста, и одна строка «Модель» вынужденно показала бы
 * запрошенную, то есть подписывала бы отказ именем модели, которая его не
 * обрабатывала.
 *
 * Токены — только число. Арифметики по деньгам здесь нет и быть не должно: цену
 * назначает провайдер, а любое вычисленное в интерфейсе число быстро станет
 * ложью. `null` показывается как «—», а не как ноль: провайдер не сообщил и
 * сообщил ноль — не одно и то же.
 */
export function AiDebugRows({ debug }: AiDebugRowsProps) {
  return (
    <>
      <div><strong>Ответила модель:</strong> {debug.effectiveModel ?? 'ещё не ответила'}</div>
      <div><strong>Запрошено:</strong> {debug.model}</div>
      {debug.provider && <div><strong>Провайдер:</strong> {providerLabel(debug.provider)}</div>}
      <div><strong>HTTP статус:</strong> {debug.httpStatus ?? '---'}</div>
      <div><strong>Попыток:</strong> {debug.attempts}</div>
      <div><strong>Токенов:</strong> {debug.totalTokens ?? '—'}</div>
      <div><strong>Длина ответа:</strong> {debug.contentLength} символов</div>
      <div><strong>Ошибка:</strong> {debug.errorMessage ?? '---'}</div>
    </>
  );
}