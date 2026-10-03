/**
 * Адрес OpenRouter и правило каталога для идентификатора модели.
 *
 * Модуль чистый: без сети, без настроек, без побочных эффектов. Он не выбирает
 * модель и не проверяет подключение — только хранит адрес и решает, как
 * сопоставить набранный оператором идентификатор с записью в каталоге.
 *
 * Адрес намеренно лежит здесь, на сервере, и не приходит из запроса: если бы
 * браузер мог прислать свой baseUrl, локальный backend превратился бы в
 * открытый прокси к произвольным хостам, несущий ключ оператора в заголовке
 * Authorization. Клиент не имеет права выбирать, куда уходит запрос с ключом.
 *
 * Про суффиксы после двоеточия. Идентификаторы OpenRouter неоднородны:
 *  - `:free` и `:batch` — самостоятельные записи каталога со своими ценами и
 *    контекстом. Снять такой суффикс нельзя: проверка `a/b` против каталога
 *    нашла бы платную модель и описала не ту, которую оператор выбрал;
 *  - `:nitro`, `:floor`, `:exacto`, `:online` — маршрутизация, а не позиции
 *    каталога. В каталоге их нет, поэтому поиск по ним даёт ложное «не найдено».
 *
 * Устаревшие `:thinking` и `:extended` сюда намеренно не входят: они ничего не
 * меняют в семантике поиска, а добавление «на всякий случай» превращает
 * правило в перечень, который нечем проверить.
 */

import type { AiProvider } from '@recon/shared';

/** Единственный адрес, к которому приложение ходит к OpenRouter */
export const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Провайдер, которому принадлежит этот адрес */
export const OPENROUTER_PROVIDER: AiProvider = 'openrouter';

/**
 * Суффиксы маршрутизации: в каталоге провайдера таких записей нет, поэтому перед
 * поиском их обязательно нужно снять.
 */
const ROUTING_SUFFIXES = new Set([':nitro', ':floor', ':exacto', ':online']);

/**
 * Что удалось сказать об идентификаторе после сверки с каталогом.
 *
 * `inconclusive` — обязательная третьтья величина, а не синоним `absent`:
 * когда каталог пуст или идентификатор пуст, сказать «модели нет» нельзя, но
 * и проверить было нечем. Схлопывать это в `absent` нельзя — интерфейс покажет
 * оператору ложное «модель не найдена» там, где на самом деле каталог просто
 * не пришёл.
 */
export type ModelIdVerdict = 'present' | 'absent' | 'inconclusive';

/**
 * Готовит идентификатор к поиску в каталоге: убирает пробелы по краям и
 * снимает суффикс маршрутизации.
 *
 * Суффиксы каталога (`:free`, `:batch`) сохраняются дословно — они часть
 * идентификатора, который оператор ввёл.
 */
export function normalizeModelIdForCatalogLookup(id: string): string {
  const trimmed = id.trim();
  const separator = trimmed.lastIndexOf(':');
  if (separator < 0) return trimmed;

  const suffix = trimmed.slice(separator);
  return ROUTING_SUFFIXES.has(suffix) ? trimmed.slice(0, separator) : trimmed;
}

/**
 * Сверяет идентификатор с каталогом провайдера.
 *
 * Сравнение регистронезависимое: каталог отдаётся как есть, и заглавная буква в
 * одном из двух идентификаторов не должна превращать проверку в ложное «нет».
 *
 * Вердикт `present` ставится и при точном совпадении сырого идентификатора, и
 * при совпадении после снятия суффикса маршрутизации: если каталог всё-таки
 * перечисляет `a/b:nitro`, это тоже существующая модель, и отрицать её неверно.
 */
export function classifyModelId(id: string, catalogIds: readonly string[]): ModelIdVerdict {
  const trimmed = id.trim();
  if (trimmed === '' || catalogIds.length === 0) return 'inconclusive';

  const haystack = new Set(catalogIds.map((entry) => entry.trim().toLowerCase()));
  const wanted = [trimmed, normalizeModelIdForCatalogLookup(trimmed)].map((value) => value.toLowerCase());
  return wanted.some((value) => haystack.has(value)) ? 'present' : 'absent';
}
