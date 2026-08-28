/**
 * HTTP API backend'а (Fastify 5).
 *
 * Маршруты:
 *  POST /api/test/analyze — AI-анализ одного файла
 *
 * Запуск: PORT из окружения (по умолчанию 5057, т.к. 5000 занят AirPlay на macOS), CORS открыт для dev-фронта.
 */

import { config } from 'dotenv';
config({ path: new URL('../../.env', import.meta.url) });

import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';

import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '@recon/shared';

import { parseExcel } from './parsers/excelParser.js';
import { parsePdf } from './parsers/pdfParser.js';
import { rateLimiter } from './rateLimit.js';
import { aiConfigFromEnv } from './services/ai/client.js';
import { testAnalyze } from './services/ai/testAnalyze.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: true } },
  },
});

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 2 },
});

app.addHook('onRequest', rateLimiter);

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
  const p = part as { filename: string; toBuffer(): Promise<Buffer> };
  return { filename: p.filename, buffer: await p.toBuffer() };
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

  if (source.needsOcr) {
    return reply.code(422).send({
      error: 'Файл похож на скан (нет текстового слоя). OCR пока не поддерживается на тестовой странице.',
    });
  }

  if (source.grid.length === 0) {
    return reply.code(422).send({ error: 'Файл не содержит данных (пустая таблица).' });
  }

  const config = aiConfigFromEnv();

  try {
    const { result, debug } = await testAnalyze(source.grid, config);
    return reply.send({
      fileName: uploaded.filename,
      sourceKind: source.kind,
      sheetName: source.sheetName,
      pages: source.pages,
      result,
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

app.get('/api/health', async () => ({ ok: true }));

/* ---------------------------------- Старт --------------------------------- */

process.on('unhandledRejection', (err) => {
  app.log.error(err, 'Unhandled rejection');
});

const port = Number(process.env.PORT ?? 5057);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
