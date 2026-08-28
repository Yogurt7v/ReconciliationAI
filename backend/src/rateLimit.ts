import type { FastifyRequest, FastifyReply } from 'fastify';

import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from '@recon/shared';

const hits = new Map<string, { count: number; resetAt: number }>();

export async function rateLimiter(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    reply.code(429).send({ error: 'Слишком много запросов. Попробуйте через минуту.' });
  }
}

// Периодическая очистка устаревших записей
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now > entry.resetAt) hits.delete(ip);
  }
}, 5 * 60_000);
cleanupTimer.unref();
