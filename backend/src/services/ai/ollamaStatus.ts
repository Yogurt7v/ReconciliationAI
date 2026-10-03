/**
 * Четырёхзначный вердикт о доступности локальной модели Ollama.
 *
 * checkOllama (backend/src/preflight.ts) различает «модель не скачана» и «Ollama
 * недоступна», но внутри «недоступна» причина терялась: и отказ соединения, и
 * сбой DNS дают один и тот же текст «fetch failed», а собственная отмена
 * проверки по таймауту — «This operation was aborted». Причина лежит в causeCode,
 * поэтому вердикт строится по коду, а не по тексту: текст зависит от локали и
 * версии Node, код — нет.
 *
 * Модуль чистый: без сети, без настроек, без побочных эффектов. Вердикт ничего
 * не блокирует — он решает только, какие подсказки показать в интерфейсе.
 * Запуск задания недоступность локальной модели не блокирует никогда.
 */

import type { OllamaCheck } from '../../preflight.js';

export type OllamaVerdict = 'ready' | 'model-missing' | 'not-listening' | 'unresponsive';

/**
 * Коды, по которым точно известно, что по этому адресу никто не слушает:
 * соединение отклонено или имя хоста не найдено.
 *
 * Сюда намеренно не входит прерывание по таймауту: холодный старт локальной
 * Ollama занимает секунды, и «не ответила» — это не «не установлена».
 */
const NOT_LISTENING_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND']);

/**
 * Переводит результат checkOllama в вердикт для интерфейса.
 *
 * Всё нераспознанное — «не ответила» (unresponsive), а не «не установлена»:
 * причина неизвестна, а ложное «не установлена» отключило бы рабочий выбор.
 */
export function classifyOllamaCheck(check: OllamaCheck): OllamaVerdict {
  if (check.ok) return 'ready';
  if (check.reason === 'model-missing') return 'model-missing';
  if (check.causeCode !== undefined && NOT_LISTENING_CODES.has(check.causeCode)) {
    return 'not-listening';
  }
  return 'unresponsive';
}