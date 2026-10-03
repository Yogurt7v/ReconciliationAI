/**
 * HTTP-маршруты полного пайплайна сверки.
 *
 * Жизненный цикл задания:
 *   POST   /api/jobs              — загрузить пару файлов, запустить пайплайн
 *   GET    /api/jobs/:id          — статус и прогресс (фронт опрашивает)
 *   POST   /api/jobs/:id/confirm  — подтвердить структуру таблицы
 *   POST   /api/jobs/:id/cancel   — прервать задание
 *   GET    /api/jobs/:id/report   — отчёт в JSON
 *   GET    /api/jobs/:id/report.html — отчёт в HTML
 *
 * Здесь же две проверки подключения для окна настроек модели:
 *   POST   /api/ai/verify         — ключ OpenRouter и наличие модели в каталоге
 *   GET    /api/ollama/status     — доступность локальной модели прямо сейчас
 *
 * Задания живут в памяти (см. jobs/store.ts) и удаляются по TTL.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '@recon/shared';
import type { ConfirmPayload } from '@recon/shared';

import type { Settings } from '../settings.js';
import { runPipeline } from '../jobs/pipeline.js';
import { confirmMapping, createJob, getJob, requestCancel, toStatus } from '../jobs/store.js';
import { buildHtmlReport } from '../services/export/htmlReport.js';
import { aiConfigFromRemoteProfile, aiConfigFromSettings, type AiConfig } from '../services/ai/client.js';
import { resolveClientProfile, type ProfileRejection } from '../services/ai/profile.js';
import { checkLocalAvailability, verifyRemoteProfile } from '../services/ai/verify.js';

/** backend/src/routes → ../../reports */
const REPORTS_DIR = fileURLToPath(new URL('../../reports', import.meta.url));

const EXT_RE = new RegExp(
  `(${ALLOWED_EXTENSIONS.map((e) => e.replace('.', '\\.')).join('|')})$`,
  'i',
);

interface SideUpload {
  filename: string;
  buffer: Buffer;
}

/** Читает файл из multipart-поля; null, если поле не файл или его нет */
async function readSide(part: unknown): Promise<SideUpload | null> {
  if (!part || typeof part !== 'object') return null;
  const p = part as {
    type?: string;
    fieldname?: string;
    filename?: string;
    toBuffer?(): Promise<Buffer>;
  };
  if (p.type !== 'file' || !p.filename || !p.toBuffer) return null;
  return { filename: p.filename, buffer: await p.toBuffer() };
}

function fileProblem(file: SideUpload): string | null {
  if (!EXT_RE.test(file.filename)) {
    return `Недопустимый тип файла «${file.filename}». Разрешены: ${ALLOWED_EXTENSIONS.join(', ')}.`;
  }
  if (file.buffer.length === 0) return `Файл «${file.filename}» пуст.`;
  return null;
}

/**
 * Поля запроса, которыми браузер выбирает удалённую модель. Одно и то же имя
 * в multipart-запросе и в JSON-теле: фронтенд собирает профиль в одном месте,
 * и разные имена в двух форматах означали бы, что маршруты разъезжаются.
 */
export interface RequestAiProfileInput {
  aiModel?: unknown;
  aiApiKey?: unknown;
}

export type RequestAiConfig =
  | { ok: true; config: AiConfig }
  | { ok: false; message: string; reason: ProfileRejection };

/**
 * Превращает поля запроса в конфигурацию модели этого запуска.
 *
 * Единственное место, где профиль из запроса становится `AiConfig`: три
 * маршрута с AI-вызовом (`/api/jobs`, `/api/test/analyze`, `/api/compare`)
 * пользуются этой функцией, поэтому правило «профиль настоящий — работает
 * удалённый шлюз, профиля нет — работает локальная Ollama» не может
 * разойтись между ними.
 *
 * Отсутствие полей — не ошибка, а прежнее поведение: конфиг собирается из
 * settings.txt, и запрос с ним уходит на локальную модель побайтно так же,
 * как до появления профилей. Половина профиля (модель без ключа или наоборот) —
 * уже не отсутствие, а ошибка оператора, и она возвращается названной
 * причиной: тихий возврат к локальной модели отправил бы документ не туда,
 * куда оператор выбрал, и тот об этом не узнал бы.
 */
export function resolveRequestAiConfig(
  input: RequestAiProfileInput,
  settings: Pick<Settings, 'ollamaBaseUrl' | 'ollamaModel' | 'aiTimeoutSec'>,
): RequestAiConfig {
  if (input.aiModel === undefined && input.aiApiKey === undefined) {
    return { ok: true, config: aiConfigFromSettings(settings) };
  }

  const resolution = resolveClientProfile(
    { model: input.aiModel, apiKey: input.aiApiKey },
    { timeoutMs: settings.aiTimeoutSec * 1000 },
  );

  return resolution.ok
    ? { ok: true, config: aiConfigFromRemoteProfile(resolution.profile) }
    : { ok: false, message: resolution.message, reason: resolution.reason };
}

export async function registerJobRoutes(
  app: FastifyInstance,
  settings: Settings,
): Promise<void> {
  /* ------------------------- Создание задания --------------------------- */

  app.post('/api/jobs', async (req, reply) => {
    let ours: SideUpload | null = null;
    let partner: SideUpload | null = null;
    let twoSidedRequested = false;
    let aiModel: unknown;
    let aiApiKey: unknown;

    try {
      for await (const part of req.parts()) {
        if (part.type === 'file' && part.fieldname === 'ours') {
          ours = await readSide(part);
        } else if (part.type === 'file' && part.fieldname === 'partner') {
          partner = await readSide(part);
        } else if (part.type === 'field' && part.fieldname === 'twoSided') {
          twoSidedRequested = part.value === 'true' || part.value === '1';
        } else if (part.type === 'field' && part.fieldname === 'aiModel') {
          aiModel = part.value;
        } else if (part.type === 'field' && part.fieldname === 'aiApiKey') {
          aiApiKey = part.value;
        }
      }
    } catch (err) {
      const tooBig = err instanceof Error && /limit file size/i.test(err.message);
      return reply.code(413).send({
        error: tooBig
          ? `Файл больше ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} МБ.`
          : 'Не удалось прочитать загруженные файлы.',
      });
    }

    if (!ours || !partner) {
      return reply
        .code(400)
        .send({ error: 'Нужны два файла: ours и partner (наш и контрагента).' });
    }

    for (const file of [ours, partner]) {
      const problem = fileProblem(file);
      if (problem) return reply.code(400).send({ error: problem });
    }

    const ai = resolveRequestAiConfig({ aiModel, aiApiKey }, settings);
    if (!ai.ok) {
      return reply.code(400).send({ error: ai.message, reason: ai.reason });
    }

    let job;
    try {
      job = createJob(
        { ours: ours.filename, partner: partner.filename },
        { ours: ours.buffer, partner: partner.buffer },
        twoSidedRequested,
        { provider: ai.config.provider, model: ai.config.model },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось создать задание.';
      return reply.code(503).send({ error: message });
    }

    // Пайплайн идёт в фоне: клиент следит за прогрессом опросом статуса.
    void runPipeline(job.id, settings, ai.config).catch((err) => {
      req.log.error({ err, jobId: job.id }, 'Pipeline crashed');
    });

    return reply.code(202).send(toStatus(job));
  });

  /* ------------------------------ Статус -------------------------------- */

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Задание не найдено (возможно, истекло).' });
    return reply.send(toStatus(job));
  });

  /* -------------------- Подтверждение структуры (HITL) ------------------- */

  app.post<{ Params: { id: string } }>('/api/jobs/:id/confirm', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Задание не найдено.' });
    if (!job.pendingConfirmation) {
      return reply
        .code(409)
        .send({ error: 'Сейчас структура не запрашивается — подтверждение не требуется.' });
    }

    const ok = confirmMapping(req.params.id, req.body as ConfirmPayload);
    if (!ok) {
      return reply.code(400).send({
        error: 'Некорректный маппинг: проверьте номера строк и колонок (у колонок должны быть разные номера).',
      });
    }
    return reply.send(toStatus(job));
  });

  /* ------------------------------ Отмена -------------------------------- */

  app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (req, reply) => {
    const ok = requestCancel(req.params.id);
    if (!ok) return reply.code(404).send({ error: 'Задание не найдено или уже завершено.' });
    return reply.send(toStatus(getJob(req.params.id)!));
  });

  /* ------------------------------- Отчёты -------------------------------- */

  app.get<{ Params: { id: string } }>('/api/jobs/:id/report', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Задание не найдено.' });
    if (!job.report) {
      return reply
        .code(409)
        .send({ error: 'Отчёт ещё не готов.', stage: job.stage, message: job.message });
    }

    // Пишем на диск при первом обращении, чтобы отчёт пережил перезапуск.
    try {
      mkdirSync(REPORTS_DIR, { recursive: true });
      writeFileSync(
        path.join(REPORTS_DIR, `report-${job.id}.json`),
        JSON.stringify(job.report, null, 2),
        'utf8',
      );
    } catch (err) {
      req.log.warn({ err }, 'Не удалось сохранить отчёт на диск');
    }

    return reply.send(job.report);
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/report.html', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Задание не найдено.' });
    if (!job.report) {
      return reply
        .code(409)
        .send({ error: 'Отчёт ещё не готов.', stage: job.stage, message: job.message });
    }

    const html = buildHtmlReport(job.report);

    try {
      mkdirSync(REPORTS_DIR, { recursive: true });
      writeFileSync(path.join(REPORTS_DIR, `report-${job.id}.html`), html, 'utf8');
    } catch (err) {
      req.log.warn({ err }, 'Не удалось сохранить HTML-отчёт на диск');
    }

    return reply.type('text/html; charset=utf-8').send(html);
  });

  /* ---------------------- Проверки подключения (окно настроек) ------------ */

  /**
   * POST /api/ai/verify — бесплатная проверка ключа и идентификатора модели.
   *
   * Тело — JSON `{ model, apiKey }`, ответ — вердикт и текст для диалога.
   * Проверки не вызывают модель и не тратят кредит, поэтому оператор узнаёт об
   * опечатке в модели или отвергнутом ключе за секунды, а не посреди пайплайна.
   *
   * На отказ профиля — 400 с названной причиной, а не тихий возврат к локальной
   * модели: оператор верит, что выбрал OpenRouter, и не должен отправить документ
   * локальной модели вместо этого.
   *
   * Ключ не выходит наружу: он уходит только в заголовок Authorization запроса к
   * /key, а в ответе, сообщении и логе не встречается — вся разборка и все тексты
   * живут в services/ai/verify.ts.
   */
  app.post('/api/ai/verify', async (req, reply) => {
    const resolution = resolveClientProfile(req.body, { timeoutMs: settings.aiTimeoutSec * 1000 });
    if (!resolution.ok) {
      return reply.code(400).send({ error: resolution.message, reason: resolution.reason });
    }

    return reply.send(await verifyRemoteProfile(resolution.profile));
  });

  /**
   * GET /api/ollama/status — доступность локальной модели «сейчас».
   *
   * GET ограничителем частоты не считается, поэтому окно зовёт маршрут при каждом
   * открытии. Ни один вердикт не запрещает запуск задания: локальная модель —
   * вариант по умолчанию, и её недоступность приложение переживает деградацией к
   * правилам.
   */
  app.get('/api/ollama/status', async (_req, reply) => {
    return reply.send(await checkLocalAvailability(settings));
  });
}
