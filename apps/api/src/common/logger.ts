import { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

/** Structured logger. Secrets/PII are redacted by path; never log request bodies. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'hbvl' },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.token',
        '*.code',
        '*.email',
      ],
      censor: '[redacted]',
    },
  });
}

/** Bridges Nest's LoggerService to pino. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly pino: Logger) {}
  log(message: unknown, ...rest: unknown[]) {
    this.pino.info({ ctx: ctx(rest) }, str(message));
  }
  error(message: unknown, ...rest: unknown[]) {
    this.pino.error({ ctx: ctx(rest), trace: rest[0] }, str(message));
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.pino.warn({ ctx: ctx(rest) }, str(message));
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.pino.debug({ ctx: ctx(rest) }, str(message));
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.pino.trace({ ctx: ctx(rest) }, str(message));
  }
}
const ctx = (rest: unknown[]) => (typeof rest[rest.length - 1] === 'string' ? rest[rest.length - 1] : undefined);
const str = (m: unknown) => (typeof m === 'string' ? m : JSON.stringify(m));
