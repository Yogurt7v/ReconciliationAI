/**
 * Проверки перед стартом и открытие браузера.
 *
 * Модуль проверяет локальную модель Ollama: у модели, выбранной по умолчанию,
 * самые частые проблемы первого запуска — это «Ollama не запущена» и «модель не
 * скачана». Проверяем обе и говорим об этом в консоль до открытия интерфейса.
 * Удалённая модель OpenRouter выбирается в браузере и на старте не проверяется:
 * её наличие и ключ серверу неизвестны.
 */

import { spawn } from 'node:child_process';

import type { Settings } from './settings.js';

export type OllamaCheck =
  | { ok: true; models: string[] }
  // causeCode — код сетевой ошибки из err.cause.code ('ECONNREFUSED', 'ENOTFOUND').
  // Он различает «Ollama не запущена» и «Ollama не ответила»: в detail обе причины
  // выглядят одинаково («fetch failed»), и сверка по тексту зависит от локали.
  | { ok: false; reason: 'unreachable'; detail: string; causeCode?: string }
  | { ok: false; reason: 'model-missing'; detail: string; models: string[] };

/**
 * Код сетевой ошибки из err.cause.
 *
 * Текст ошибки не разбираем: он зависит от локали и версии Node. Берём код, потому
 * что он единственный признак, по которому «не запущена» отличается от «не ответила».
 * Node при двойном стеке (localhost резолвится и в IPv6, и в IPv4) оборачивает
 * отказ в AggregateError: сам агрегат код может не нести, тогда смотрим errors[0].
 */
function causeCodeOf(err: unknown): string | undefined {
  const cause = (err as { cause?: unknown } | null | undefined)?.cause;
  if (typeof cause !== 'object' || cause === null) return undefined;

  const aggregate = cause as { code?: unknown; errors?: unknown };
  if (typeof aggregate.code === 'string') return aggregate.code;

  const first = Array.isArray(aggregate.errors) ? (aggregate.errors as unknown[])[0] : undefined;
  const nested = (first as { code?: unknown } | null | undefined)?.code;
  return typeof nested === 'string' ? nested : undefined;
}

/** Имя модели в тегах Ollama: «qwen2.5:7b-instruct» → «qwen2.5:7b-instruct» */
function baseTag(model: string): string {
  return model.trim();
}

/** «qwen2.5:7b» и «qwen2.5:7b-instruct» считаем разными моделями */
function hasModel(tags: string[], wanted: string): boolean {
  return tags.some((t) => baseTag(t) === baseTag(wanted));
}

export async function checkOllama(
  settings: Pick<Settings, 'ollamaBaseUrl' | 'ollamaModel' | 'aiTimeoutSec'>,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaCheck> {
  const base = settings.ollamaBaseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  // Проверка не должна висеть дольше самой модели: 5 секунд или AI_TIMEOUT_SEC
  const timer = setTimeout(() => controller.abort(), Math.min(5000, settings.aiTimeoutSec * 1000));

  try {
    const res = await fetchImpl(`${base}/api/tags`, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, reason: 'unreachable', detail: `HTTP ${res.status}` };
    }

    const body = (await res.json().catch(() => null)) as {
      models?: { name?: string; model?: string }[];
    } | null;

    const models = (body?.models ?? [])
      .map((m) => m.name ?? m.model ?? '')
      .filter(Boolean);

    if (!hasModel(models, settings.ollamaModel)) {
      return { ok: false, reason: 'model-missing', detail: settings.ollamaModel, models };
    }
    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      reason: 'unreachable',
      detail: err instanceof Error ? err.message : String(err),
      causeCode: causeCodeOf(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Человекочитаемое объяснение результата проверки */
export function describeOllama(check: OllamaCheck, settings: Pick<Settings, 'ollamaBaseUrl' | 'ollamaModel'>): string {
  const base = settings.ollamaBaseUrl.replace(/\/+$/, '');

  if (check.ok) return `Ollama отвечает, модель ${settings.ollamaModel} доступна.`;

  if (check.reason === 'unreachable') {
    return [
      `Ollama недоступна по адресу ${base} (${check.detail}).`,
      'Запустите её: откройте Ollama на этом компьютере (или выполните «ollama serve»).',
      'Без модели приложение продолжит работу, но будет использовать только эвристики.',
    ].join(' ');
  }

  return [
    `Ollama отвечает, но модель ${settings.ollamaModel} не скачана.`,
    `Выполните: ollama pull ${settings.ollamaModel}`,
    check.models.length
      ? `Доступные модели: ${check.models.slice(0, 8).join(', ')}.`
      : 'В Ollama пока нет ни одной модели.',
  ].join(' ');
}

/** Открывает URL в системном браузере. Ошибки игнорируем: это необязательный шаг. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [command, args] =
    platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];

  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Нет браузера / нет команды — интерфейс всё равно доступен по URL
  }
}
