/**
 * Тело ответа `POST /api/test/analyze` в случае неудачи — здесь, а не в хендлере
 * по той же причине, что и `runCompare`: `index.ts` зовёт `await app.listen()` на
 * уровне модуля, поэтому ни один HTTP-вызов оттуда недостижим из теста
 * (GAP-27). Проверяемым остаётся ровно то, что вынесено в обычную функцию.
 */

import type { AiDebugInfo } from '@recon/shared';

import { AiUnavailableError, remoteProviderCause } from '../services/ai/client.js';
import type { AiConfig } from '../services/ai/client.js';

/**
 * Неудачный разбор: ни данных, ни подписи о модели — только названная причина.
 *
 * Отдельная форма, а не пустой `TestAnalyzeResponse`: разбора не было, и отдать
 * вместо него заглушку с нулями значило бы показать оператору расчёт, которого
 * никто не делал. `statusCode` рядом — по той же причине, что в `runCompare`.
 */
export interface AnalyzeFailure {
  statusCode: number;
  body: {
    error: string;
    debug: AiDebugInfo | undefined;
  };
}

/**
 * Диагностика неудачного вызова снимается с ошибки, а не с провайдера: у
 * локальной модели это может быть и постороннее исключение, у которого поля
 * `debug` просто нет. Неизвестное значение трактуется как «диагностики нет» —
 * выдумывать её содержимое здесь незачем.
 */
function debugOf(err: unknown): AiDebugInfo | undefined {
  if (typeof err !== 'object' || err === null || !('debug' in err)) return undefined;
  const { debug } = err as { debug: unknown };
  return typeof debug === 'object' && debug !== null ? (debug as AiDebugInfo) : undefined;
}

/**
 * Причина неудачи `/api/test/analyze`.
 *
 * Отказ удалённого шлюза получает ту же формулировку, что `/api/jobs` и
 * `/api/compare` (`remoteProviderCause`): одна строка на все три точки входа —
 * иначе README не смог бы сослаться ни на одну из них.
 *
 * Граница — `terminal`, а не сам факт ошибки от шлюза: перегрузку (429) и
 * сетевой сбой никто не отклонял, и «провайдер отклонил запрос» было бы о них
 * неправдой. Локальная модель оставляет прежний текст побайтно.
 */
export function analyzeFailure(config: AiConfig, err: unknown): AnalyzeFailure {
  if (config.provider === 'openrouter' && err instanceof AiUnavailableError && err.terminal) {
    return { statusCode: 502, body: { error: remoteProviderCause(err), debug: err.debug } };
  }

  const message = err instanceof Error ? err.message : 'Неизвестная ошибка AI';
  const detail = err instanceof Error && 'detail' in err ? (err as { detail?: unknown }).detail : undefined;
  const fullMessage = detail ? `${message} (${detail})` : message;
  return {
    statusCode: 502,
    body: { error: `AI-анализ не удался: ${fullMessage}`, debug: debugOf(err) },
  };
}