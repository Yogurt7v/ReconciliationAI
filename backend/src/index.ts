/**
 * HTTP API backend'а (Fastify 5).
 *
 * Маршруты:
 *  POST /api/upload            — поля ours/partner (.xlsx/.xls/.pdf) → { id }
 *  GET  /api/jobs/:id/status   — JobStatus (progress, stage, ETA, reasoning…)
 *  POST /api/jobs/:id/mapping  — ConfirmPayload: подтверждение структуры
 *  GET  /api/jobs/:id/report   — JSON | ?format=html | xlsx | pdf
 *  POST /api/jobs/:id/cancel   — отмена задания
 *
 * Запуск: PORT из окружения (по умолчанию 5000), CORS открыт для dev-фронта.
 */

import 'dotenv/config';

import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';

import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '@recon/shared';
import type { ConfirmPayload } from '@recon/shared';

import { createJob, getJob, toStatus, confirmMapping, requestCancel } from './jobs/store.js';
import { runPipeline } from './jobs/pipeline.js';
import { buildHtmlReport } from './services/export/htmlReport.js';
import { buildXlsxReport } from './services/export/xlsxReport.js';
import { buildPdfReport, PdfFontError } from './services/export/pdfReport.js';

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

app.post('/api/upload', async (req, reply) => {
  const found: Partial<Record<'ours' | 'partner', UploadedFile>> = {};

  for await (const part of req.parts()) {
    if (part.type !== 'file') continue;
    if (part.fieldname !== 'ours' && part.fieldname !== 'partner') continue;
    if (found[part.fieldname]) {
      return reply.code(400).send({ error: `Поле «${part.fieldname}» указано дважды.` });
    }
    try {
      found[part.fieldname] = await readUploadFile(part);
    } catch (err) {
      // Превышение лимита размера внутри multipart-парсера
      const message =
        err instanceof Error && /limit/i.test(err.message)
          ? `Файл «${part.filename}» больше ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} МБ.`
          : `Не удалось прочитать файл «${part.filename}».`;
      return reply.code(413).send({ error: message });
    }
  }

  if (!found.ours || !found.partner) {
    return reply
      .code(400)
      .send({ error: 'Нужны оба файла: поля ours («ваш файл») и partner («файл контрагента»).' });
  }

  for (const key of ['ours', 'partner'] as const) {
    const problem = validateFile(found[key]!);
    if (problem) return reply.code(400).send({ error: problem });
  }

  const job = createJob(
    { ours: found.ours!.filename, partner: found.partner!.filename },
    { ours: found.ours!.buffer, partner: found.partner!.buffer },
  );
  void runPipeline(job.id);

  return reply.code(201).send({ id: job.id });
});

/* --------------------------------- Статус --------------------------------- */

app.get<{ Params: { id: string } }>('/api/jobs/:id/status', async (req, reply) => {
  const job = getJob(req.params.id);
  if (!job) return reply.code(404).send({ error: 'Задание не найдено.' });
  return toStatus(job);
});

/* ------------------------------- Подтверждение ---------------------------- */

app.post<{ Params: { id: string }; Body: ConfirmPayload }>('/api/jobs/:id/mapping', async (req, reply) => {
  const job = getJob(req.params.id);
  if (!job) return reply.code(404).send({ error: 'Задание не найдено.' });
  if (job.stage !== 'awaiting_confirmation') {
    return reply.code(409).send({ error: 'Задание сейчас не ждёт подтверждения структуры.' });
  }

  const body = req.body;
  if (
    typeof body?.headerRowIndex !== 'number' ||
    typeof body?.dataStartRowIndex !== 'number' ||
    !body.columns ||
    typeof body.columns !== 'object'
  ) {
    return reply.code(400).send({
      error: 'Ожидается { headerRowIndex, dataStartRowIndex, columns: { docNumber, docDate, amount, debit, credit } }.',
    });
  }

  const ok = confirmMapping(job.id, body);
  if (!ok) return reply.code(409).send({ error: 'Не удалось применить подтверждение.' });
  return { ok: true };
});

/* ---------------------------------- Отчёт --------------------------------- */

app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
  '/api/jobs/:id/report',
  async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Задание не найдено.' });
    if (!job.reportReady || !job.report) {
      return reply.code(409).send({ error: 'Отчёт ещё не готов.', stage: job.stage });
    }

    const format = (req.query.format ?? 'json').toLowerCase();

    switch (format) {
      case 'json':
        return job.report;

      case 'html': {
        const html = buildHtmlReport(job.report);
        return reply
          .header('content-type', 'text/html; charset=utf-8')
          .header('content-disposition', `inline; filename="report-${job.id}.html"`)
          .send(html);
      }

      case 'xlsx': {
        const buf = await buildXlsxReport(job.report);
        return reply
          .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('content-disposition', `attachment; filename="report-${job.id}.xlsx"`)
          .send(buf);
      }

      case 'pdf': {
        try {
          const buf = await buildPdfReport(job.report);
          return reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', `attachment; filename="report-${job.id}.pdf"`)
            .send(buf);
        } catch (err) {
          if (err instanceof PdfFontError) {
            return reply.code(503).send({ error: err.message });
          }
          throw err;
        }
      }

      default:
        return reply.code(400).send({ error: `Неизвестный формат «${format}». Доступны: json, html, xlsx, pdf.` });
    }
  },
);

/* ---------------------------------- Отмена -------------------------------- */

app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (req, reply) => {
  const ok = requestCancel(req.params.id);
  if (!ok) return reply.code(409).send({ error: 'Задание не найдено или уже завершено.' });
  return { ok: true };
});

/* ---------------------------------- Здоровье ------------------------------ */

app.get('/api/health', async () => ({ ok: true }));

/* ---------------------------------- Старт --------------------------------- */

const port = Number(process.env.PORT ?? 5000);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
