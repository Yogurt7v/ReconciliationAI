/**
 * Ответ `POST /api/compare` собирается здесь, а не в хендлере: `index.ts` зовёт
 * `await app.listen()` на уровне модуля, поэтому ни один HTTP-вызов из него
 * недостижим из теста (GAP-27), и проверяемым остаётся только то, что вынесено
 * в обычную функцию.
 */

import type { AiDebugInfo, CompareResult } from '@recon/shared';

import { AiUnavailableError, remoteProviderCause } from '../services/ai/client.js';
import type { AiConfig } from '../services/ai/client.js';
import { fullReconciliation } from '../services/ai/reconciliation.js';
import type { DocumentData } from '../services/ai/testAnalyze.js';

/**
 * Тело ответа — **объединение двух форм**, а не одна с необязательными полями.
 *
 * `502` физически не может нести `CompareResult`: сверки не было, а выдумывать
 * в ответе `matched: []` значило бы отдать оператору карточку сравнения, которой
 * никто не считал. Обратная крайность — сузить тело до одной формы с
 * `error?: string`: тогда отказ нельзя выразить вовсе, и компилятор начал бы
 * требовать `summary`/`matched`/`onlyInYour`/`onlyInPartner` даже там, где
 * ответа от модели нет.
 */
export interface CompareOutcome {
  statusCode: number;
  body: CompareResponse | CompareRefusal;
}

/** Успешный ответ карточки сравнения; `debug` — всегда, в обеих ветках 200 */
export interface CompareResponse extends CompareResult {
  debug: AiDebugInfo;
}

/** Отказ: ни сравнения, ни подписи о модели, только названная причина */
export interface CompareRefusal {
  /** Причина отказа удалённого шлюза; уже обезличена в `client.ts` */
  error: string;
  debug: AiDebugInfo | undefined;
}

/**
 * Диагностика для карточки: то, что вернул AI, иначе — честная «ничего не
 * ответили». Заполняется здесь, а не в `fullReconciliation`, потому что у того
 * диагностика опциональна (без конфига AI не зовётся вовсе), а контракт
 * маршрута обещает `debug` в **обоих** ответах `200`.
 */
function cardDebug(
  debug: AiDebugInfo | undefined,
  errorMessage: string | null,
  config: AiConfig,
): AiDebugInfo {
  return (
    debug ?? {
      model: config.model,
      provider: config.provider,
      effectiveModel: null,
      httpStatus: null,
      contentLength: 0,
      errorMessage,
      rawPreview: null,
      attempts: 0,
    }
  );
}

/**
 * Сверка двух распознанных документов.
 *
 * Конфиг — тот, что пришёл из профиля браузера: два браузера на одном backend'е
 * обязаны считать разными моделями.
 */
export async function runCompare(
  ours: DocumentData,
  partner: DocumentData,
  config: AiConfig,
): Promise<CompareOutcome> {
  try {
    const { result, debug } = await fullReconciliation(ours, partner, config);
    return { statusCode: 200, body: { ...result, debug: cardDebug(debug, null, config) } };
  } catch (err) {
    // Провайдер отказал так, что ни повтор, ни расчёт без модели не помогут.
    // Раньше здесь был второй вызов с тем же конфигом — вторая одинаково
    // отвергаемая платная попытка, — и он бросал наружу из самого catch, то
    // есть маршрут отвечал пятисоткой без причины. Теперь это 502 с
    // названной причиной: карточка сравнения с «Сравнение недоступно.»
    // выглядела бы для оператора обычным результатом.
    if (config.provider === 'openrouter' && err instanceof AiUnavailableError && err.terminal) {
      return { statusCode: 502, body: { error: remoteProviderCause(err), debug: err.debug } };
    }

    console.error('[api/compare] Reconciliation failed:', err);
    const message = err instanceof Error ? err.message : String(err);

    // Запасной расчёт — только правилами и **без** конфига: вызов с конфигом
    // снова соединился бы с платным шлюзом, а подписать расчёт именем модели,
    // которая его не считала, — значит соврать в диагностике.
    const { result } = await fullReconciliation(ours, partner);
    const debug = err instanceof AiUnavailableError ? err.debug : undefined;
    return {
      statusCode: 200,
      body: { ...result, debug: cardDebug(debug, message, config) },
    };
  }
}
