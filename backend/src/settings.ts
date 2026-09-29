/**
 * Загрузка настроек приложения из settings.txt.
 *
 * Формат — плоский список `КЛЮЧ=ЗНАЧЕНИЕ`:
 *   - `#` в начале строки — комментарий;
 *   - `#` после пробела в значении — тоже комментарий (`KEY=value # пояснение`);
 *   - пустые строки игнорируются;
 *   - ключи регистронезависимы, значения сохраняют регистр;
 *   - пробелы вокруг ключа и значения обрезаются.
 *
 * Путь к файлу: `../../settings.txt` относительно этого модуля, то есть
 *   - при разработке — корень репозитория;
 *   - в переносимой сборке — папка `app/` рядом с `start.cmd`.
 * Один и тот же путь работает в обоих случаях, переключать ничего не нужно.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Все ключи, которые понимает приложение */
export const SETTINGS_KEYS = [
  'APP_HOST',
  'APP_PORT',
  'API_BASE_URL',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'AI_TIMEOUT_SEC',
  'LOG_LEVEL',
  'LOG_FILE',
  'OPEN_BROWSER',
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];

export interface Settings {
  /** Интерфейс прослушивания сервера: 127.0.0.1 (только локально) или 0.0.0.0 (доступен по сети) */
  appHost: string;
  /** Порт HTTP-сервера */
  appPort: number;
  /** Адрес, по которому браузер обращается к API. Пусто — тот же origin, откуда открыт интерфейс */
  apiBaseUrl: string;
  /** Адрес Ollama без слэша на конце */
  ollamaBaseUrl: string;
  /** Имя модели в Ollama */
  ollamaModel: string;
  /** Таймаут одного запроса к модели, секунд */
  aiTimeoutSec: number;
  /** Уровень логов fastify */
  logLevel: string;
  /** Путь к файлу лога. Пусто — писать только в консоль */
  logFile: string;
  /** Открывать браузер после старта */
  openBrowser: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  appHost: '127.0.0.1',
  appPort: 8080,
  apiBaseUrl: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5:7b-instruct',
  aiTimeoutSec: 30,
  logLevel: 'info',
  logFile: '',
  openBrowser: true,
};

/** Ошибка конфигурации: понятный текст + номер строки, где всё сломалось */
export class SettingsError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line === undefined ? message : `Строка ${line}: ${message}`);
    this.name = 'SettingsError';
  }
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

const TRUE_WORDS = new Set(['true', 'yes', 'on', '1', 'да']);
const FALSE_WORDS = new Set(['false', 'no', 'off', '0', 'нет']);

/** Базовый путь: `backend/src/settings.ts` → `../../settings.txt` */
export const DEFAULT_SETTINGS_PATH = fileURLToPath(new URL('../../settings.txt', import.meta.url));

/**
 * Убирает BOM (Windows-редакторы его добавляют) и инлайн-комментарий.
 * Инлайн-комментарий начинается только с `#`, перед которым есть пробел или
 * таб — иначе `#` остаётся частью значения.
 */
function stripInlineComment(line: string): string {
  const match = /[ \t]#/.exec(line);
  return (match ? line.slice(0, match.index) : line).trim();
}

/** Разбирает текст файла в Map «ключ → значение» (значения обрезаны) */
function readRaw(text: string): Map<string, { value: string; line: number }> {
  const raw = new Map<string, { value: string; line: number }>();

  text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .forEach((rawLine, index) => {
      const lineNumber = index + 1;
      const line = stripInlineComment(rawLine);
      if (line === '' || line.startsWith('#')) return;

      const eq = line.indexOf('=');
      if (eq === -1) {
        throw new SettingsError(
          `ожидалась строка вида КЛЮЧ=ЗНАЧЕНИЕ, получено «${line}»`,
          lineNumber,
        );
      }

      const key = line.slice(0, eq).trim().toUpperCase();
      const value = line.slice(eq + 1).trim();

      if (key === '') {
        throw new SettingsError('пустое имя ключа', lineNumber);
      }
      if (raw.has(key)) {
        throw new SettingsError(`ключ ${key} указан дважды`, lineNumber);
      }
      raw.set(key, { value, line: lineNumber });
    });

  return raw;
}

function requireString(
  raw: Map<string, { value: string; line: number }>,
  key: SettingsKey,
  fallback: string,
): string {
  const entry = raw.get(key);
  if (entry === undefined) return fallback;

  if (entry.value === '') {
    throw new SettingsError(`${key} не может быть пустым`, entry.line);
  }
  return entry.value;
}

/** Целое число в диапазоне [min, max] */
function requireInt(
  raw: Map<string, { value: string; line: number }>,
  key: SettingsKey,
  fallback: number,
  min: number,
  max: number,
): number {
  const entry = raw.get(key);
  if (entry === undefined) return fallback;

  if (!/^-?\d+$/.test(entry.value)) {
    throw new SettingsError(`${key} должен быть целым числом, получено «${entry.value}»`, entry.line);
  }
  const parsed = Number(entry.value);
  if (parsed < min || parsed > max) {
    throw new SettingsError(
      `${key} должен быть в диапазоне ${min}..${max}, получено ${parsed}`,
      entry.line,
    );
  }
  return parsed;
}

function requireEnum(
  raw: Map<string, { value: string; line: number }>,
  key: SettingsKey,
  allowed: readonly string[],
): string {
  const entry = raw.get(key)!;
  const lower = entry.value.toLowerCase();
  const match = allowed.find((a) => a === lower);
  if (match === undefined) {
    throw new SettingsError(
      `${key}: значение «${entry.value}» недопустимо, ожидается одно из: ${allowed.join(', ')}`,
      entry.line,
    );
  }
  return match;
}

function requireBoolean(
  raw: Map<string, { value: string; line: number }>,
  key: SettingsKey,
  fallback: boolean,
): boolean {
  const entry = raw.get(key);
  if (entry === undefined) return fallback;

  const lower = entry.value.toLowerCase();
  if (TRUE_WORDS.has(lower)) return true;
  if (FALSE_WORDS.has(lower)) return false;
  throw new SettingsError(
    `${key}: значение «${entry.value}» недопустимо, ожидается true или false`,
    entry.line,
  );
}

/**
 * URL без завершающего слэша. Пустое значение допустимо только там, где
 * это осмысленно (API_BASE_URL); адрес Ollama обязателен.
 */
function requireUrl(
  raw: Map<string, { value: string; line: number }>,
  key: SettingsKey,
  fallback: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string {
  const entry = raw.get(key);
  if (entry === undefined) return fallback;

  if (entry.value === '') {
    if (allowEmpty) return '';
    throw new SettingsError(`${key} не может быть пустым`, entry.line);
  }

  const url = entry.value.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SettingsError(
      `${key}: «${entry.value}» не похоже на адрес (ожидается http://хост:порт)`,
      entry.line,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SettingsError(
      `${key}: схема «${parsed.protocol}» не поддерживается, используйте http или https`,
      entry.line,
    );
  }
  return url;
}

/**
 * Разбирает содержимое settings.txt.
 * Отсутствующие ключи берутся из DEFAULT_SETTINGS, лишние — ошибка.
 */
export function parseSettings(text: string): Settings {
  const raw = readRaw(text);

  for (const key of raw.keys()) {
    if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
      const entry = raw.get(key)!;
      throw new SettingsError(
        `неизвестный ключ ${key}. Допустимые ключи: ${SETTINGS_KEYS.join(', ')}`,
        entry.line,
      );
    }
  }

  return {
    appHost: requireString(raw, 'APP_HOST', DEFAULT_SETTINGS.appHost),
    appPort: requireInt(raw, 'APP_PORT', DEFAULT_SETTINGS.appPort, 1, 65535),
    apiBaseUrl: requireUrl(raw, 'API_BASE_URL', DEFAULT_SETTINGS.apiBaseUrl, { allowEmpty: true }),
    ollamaBaseUrl: requireUrl(raw, 'OLLAMA_BASE_URL', DEFAULT_SETTINGS.ollamaBaseUrl),
    ollamaModel: requireString(raw, 'OLLAMA_MODEL', DEFAULT_SETTINGS.ollamaModel),
    aiTimeoutSec: requireInt(raw, 'AI_TIMEOUT_SEC', DEFAULT_SETTINGS.aiTimeoutSec, 1, 3600),
    logLevel: raw.has('LOG_LEVEL')
      ? requireEnum(raw, 'LOG_LEVEL', LOG_LEVELS)
      : DEFAULT_SETTINGS.logLevel,
    logFile: raw.get('LOG_FILE')?.value ?? DEFAULT_SETTINGS.logFile,
    openBrowser: requireBoolean(raw, 'OPEN_BROWSER', DEFAULT_SETTINGS.openBrowser),
  };
}

/** Читает и разбирает файл настроек */
export function loadSettings(path: string = DEFAULT_SETTINGS_PATH): Settings {
  let text: string;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SettingsError(`не удалось прочитать файл настроек ${path}: ${reason}`);
  }

  try {
    return parseSettings(text);
  } catch (err) {
    if (err instanceof SettingsError) {
      throw new SettingsError(`${path}\n${err.message}`, err.line);
    }
    throw err;
  }
}
