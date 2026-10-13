import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

const ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** Assigns a request id (echoed in the response) and writes one structured access log line per request. No bodies, no cookies. */
export function requestContext(log: Logger) {
  return (req: Request & { id?: string }, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    req.id = incoming && ID_RE.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (req.path.startsWith('/api/v1/health')) return;
      log.info({ requestId: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms * 10) / 10 }, 'request');
    });
    next();
  };
}
