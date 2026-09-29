/**
 * HTTP API backend'а (Fastify 5).
 *
 * Один процесс отдаёт и API, и собранный фронтенд:
 *  POST /api/test/analyze  — AI-анализ одного файла (быстрый режим)
 *  POST /api/compare       — сверка двух распознанных документов
 *  GET  /api/health        — фактически применяемая модель
 *  /api/jobs*              — полный пайплайн сверки (см. routes/jobs.ts)
 *  GET  /config.js         — рантайм-конфигурация для фронтенда
 *  GET  /*                 — статика frontend/dist с SPA-fallback
 *
 * Все настройки приходят из settings.txt (см. src/settings.ts).
 * CORS открыт: приложение рассчитано на локальный запуск и доступ из сети.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import type { TransportTargetOptions } from 'pino';

import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '@recon/shared';

import { parseExcel } from './parsers/excelParser.js';
import { parsePdf } from './parsers/pdfParser.js';
import { rateLimiter } from './rateLimit.js';
import { loadSettings } from './settings.js';
import { aiConfigFromSettings, type AiConfig } from './services/ai/client.js';
import { testAnalyze } from './services/ai/testAnalyze.js';
import { fullReconciliation } from './services/ai/reconciliation.js';
import { registerJobRoutes } from './routes/jobs.js';
import { checkOllama, describeOllama, openBrowser } from './preflight.js';

const settings = loadSettings();
const aiConfig: AiConfig = aiConfigFromSettings(settings);

/** Каталог собранного фронтенда: backend/src → ../../frontend/dist */
const frontendDist = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
const hasFrontend = existsSync(frontendDist);

// Уровень логов задаётся в settings.txt; тот же уровень фильтрует и запросы.
const app = Fastify({ logger: buildLoggerOptions() });

/* ------------------------------- Логирование ------------------------------ */

/**
 * В консоль пишем всегда: при запуске двойным кликом это единственное место,
 * где пользователь видит, что происходит. Файл подключается сверху, если
 * задан LOG_FILE. Читаемый вывод даёт pino-pretty, но в переносимой сборке
 * dev-зависимостей нет, поэтому там остаются JSON-строки.
 */
function buildLoggerOptions(): FastifyServerOptions['logger'] {
  const targets: TransportTargetOptions[] = [];

  if (hasPinoPretty()) {
    targets.push({
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: true },
    });
  } else {
    // pino/file без destination пишет в stdout.
    targets.push({ target: 'pino/file' });
  }

  if (settings.logFile) {
    // pino/file не создаёт каталоги: без этого старт падает на LOG_FILE=logs/x.log.
    mkdirSync(dirname(resolve(settings.logFile)), { recursive: true });
    targets.push({ target: 'pino/file', options: { destination: settings.logFile } });
  }

  return { level: settings.logLevel, transport: { targets } };
}

function hasPinoPretty(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------- Плагины -------------------------------- */

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 2 },
});

if (hasFrontend) {
  await app.register(staticFiles, {
    root: frontendDist,
    index: ['index.html'],
    // Хешированные имена в /assets — можно кэшировать навсегда
    setHeaders(reply, filePath) {
      if (filePath.includes('assets')) {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
} else {
  app.log.warn(
    `Каталог ${frontendDist} не найден — интерфейс не будет отдан. Выполните «pnpm build».`,
  );
}

app.addHook('onRequest', rateLimiter);

/* ---------------------------- Рантайм-конфиг ----------------------------- */

/**
 * Конфигурация для фронтенда. Отдаётся отдельным скриптом, а не вшивается в
 * сборку: меняете settings.txt — перезапускаете — интерфейс подхватывает новое
 * значение без пересборки. Пустой apiBaseUrl = запросы идут на тот же origin.
 */
app.get('/config.js', async (_req, reply) => {
  reply.header('Cache-Control', 'no-store');
  reply.type('application/javascript; charset=utf-8');
  return `window.__RECON_CONFIG__=${JSON.stringify({ apiBaseUrl: settings.apiBaseUrl })};`;
});

/**
 * SPA-fallback: неизвестный путь отдаёт index.html, чтобы работали
 * прямые ссылки и обновление страницы. Ошибки внутри /api не маскируются.
 */
app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api/') || req.url === '/api') {
    return reply.code(404).send({ error: `Маршрут ${req.method} ${req.url} не найден.` });
  }
  if (hasFrontend && (req.method === 'GET' || req.method === 'HEAD')) {
    return reply.type('text/html; charset=utf-8').sendFile('index.html');
  }
  return reply.code(404).send({ error: 'Интерфейс не собран. Выполните «pnpm build».' });
});

/* --------------------------------- Upload --------------------------------- */

interface UploadedFile {
  filename: string;
  buffer: Buffer;
}

const EXT_RE = new RegExp(`(${ALLOWED_EXTENSIONS.map((e) => e.replace('.', '\\.')).join('|')})$`, 'i');

function validateFile(file: UploadedFile): string | null {
  if (!EXT_RE.test(file.filename)) {
    return `Недопустимый тип файла «${file.filename}». Разрешены: ${ALLOWED_EXTENSIONS.join(', ')}.`;
  }
  if (file.buffer.length === 0) return `Файл «${file.filename}» пуст.`;
  return null;
}

async function readUploadFile(part: unknown): Promise<UploadedFile> {
  const p = part as { filename: string; toBuffer?(): Promise<Buffer>; arrayBuffer?(): Promise<ArrayBuffer> };

  if (p.toBuffer) {
    return { filename: p.filename, buffer: await p.toBuffer() };
  }

  // Fallback для multipart без toBuffer
  if (p.arrayBuffer) {
    const arrayBuffer = await p.arrayBuffer();
    return { filename: p.filename, buffer: Buffer.from(arrayBuffer) };
  }

  throw new Error('Не удалось прочитать файл: нет метода toBuffer или arrayBuffer');
}

/* ----------------------------- Тестовый анализ ---------------------------- */

app.post('/api/test/analyze', async (req, reply) => {
  let uploaded: UploadedFile | null = null;

  for await (const part of req.parts()) {
    if (part.type === 'file' && part.fieldname === 'file') {
      try {
        uploaded = await readUploadFile(part);
      } catch (err) {
        const message =
          err instanceof Error && /limit/i.test(err.message)
            ? `Файл больше ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} МБ.`
            : 'Не удалось прочитать файл.';
        return reply.code(413).send({ error: message });
      }
    }
  }

  if (!uploaded) {
    return reply.code(400).send({ error: 'Поле file обязательно.' });
  }

  const problem = validateFile(uploaded);
  if (problem) return reply.code(400).send({ error: problem });

  const ext = uploaded.filename.toLowerCase();
  let source;

  try {
    if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      source = parseExcel(uploaded.buffer, uploaded.filename);
    } else if (ext.endsWith('.pdf')) {
      source = await parsePdf(uploaded.buffer, uploaded.filename);
    } else {
      return reply.code(400).send({ error: 'Неподдерживаемый формат файла.' });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ошибка парсинга файла';
    return reply.code(422).send({ error: `Не удалось распарсить файл: ${message}` });
  }

  // OCR в этом маршруте не выполняется: он реализован в пайплайне сверки.
  if (source.needsOcr) {
    return reply.code(422).send({
      error:
        'Файл похож на скан: нет текстового слоя. Быстрый режим распознаёт только XLSX и PDF с текстом — переключитесь на режим «Сверка», там работает OCR.',
    });
  }

  if (source.grid.length === 0) {
    return reply.code(422).send({ error: 'Файл не содержит данных (пустая таблица).' });
  }

  try {
    const { result, warnings, debug } = await testAnalyze(source.grid, aiConfig);
    return reply.send({
      fileName: uploaded.filename,
      sourceKind: source.kind,
      sheetName: source.sheetName,
      pages: source.pages,
      result,
      warnings,
      debug,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка AI';
    const detail = err instanceof Error && 'detail' in err ? (err as { detail?: unknown }).detail : undefined;
    const debug = err instanceof Error && 'debug' in err ? (err as { debug?: unknown }).debug : undefined;
    const fullMessage = detail ? `${message} (${detail})` : message;
    return reply.code(502).send({ error: `AI-анализ не удался: ${fullMessage}`, debug });
  }
});

/* ---------------------------------- Здоровье ------------------------------ */

app.get('/api/health', async () => {
  // Фронтенд показывает здесь реально применяемую модель.
  return {
    ok: true,
    ai: {
      provider: 'ollama' as const,
      model: aiConfig.model,
    },
  };
});

/* ----------------------------- Сверка ------------------------------------ */

interface CompareBody {
  ours: import('./services/ai/testAnalyze.js').DocumentData;
  partner: import('./services/ai/testAnalyze.js').DocumentData;
}

app.post('/api/compare', async (req, reply) => {
  const body = req.body as CompareBody | undefined;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'Тело запроса обязательно.' });
  }

  const { ours, partner } = body;

  if (!ours || !partner) {
    return reply.code(400).send({ error: 'Поля "ours" и "partner" обязательны.' });
  }

  try {
    const { result, debug } = await fullReconciliation(ours, partner, aiConfig);
    return reply.send({ ...result, debug });
  } catch (err) {
    console.error('[api/compare] Reconciliation failed:', err);
    app.log.warn(err, 'Reconciliation failed');
    const { result } = await fullReconciliation(ours, partner);
    return reply.send({
      ...result,
      debug: {
        model: aiConfig.model,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
  }
});

/* ------------------------------ Пайплайн сверки -------------------------- */

await registerJobRoutes(app, settings);

/* ---------------------------------- Старт --------------------------------- */

process.on('unhandledRejection', (err) => {
  app.log.error(err, 'Unhandled rejection');
});

try {
  await app.listen({ port: settings.appPort, host: settings.appHost });
} catch (err) {
  app.log.error(err, `Не удалось занять ${settings.appHost}:${settings.appPort} — порт занят?`);
  process.exit(1);
}

app.log.info(
  { model: aiConfig.model, ollama: settings.ollamaBaseUrl },
  'Reconciliation AI запущен',
);

// Проверяем Ollama до открытия браузера: частая причина «ничего не работает» —
// забытый «ollama serve» или нескачанная модель из settings.txt.
const ollama = await checkOllama(settings);
if (ollama.ok) {
  app.log.info(describeOllama(ollama, settings));
} else {
  app.log.warn(describeOllama(ollama, settings));
}

// Адрес для браузера: тот, по которому открыт интерфейс, либо 127.0.0.1
const browserUrl = settings.apiBaseUrl || `http://localhost:${settings.appPort}`;
if (settings.openBrowser) openBrowser(browserUrl);
else app.log.info(`Интерфейс: ${browserUrl}`);
