import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, type ErrorCode } from './errors';

interface Envelope {
  error: { code: ErrorCode | string; message: string; requestId?: string; details?: unknown };
}

/** Single error envelope: `{ error: { code, message, requestId, details? } }`. Never leaks stack traces or SQL. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string }>();
    const requestId = req.id;

    let status = 500;
    let body: Envelope = { error: { code: 'INTERNAL', message: 'Đã xảy ra lỗi hệ thống.', requestId } };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      const r = exception.getResponse() as { code: string; message: string; details?: unknown };
      body = { error: { code: r.code, message: r.message, details: r.details, requestId } };
      if (status === 429) {
        const retry = (r.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
        if (retry) res.setHeader('Retry-After', String(retry));
      }
    } else if (exception instanceof ZodError) {
      status = 400;
      body = { error: { code: 'VALIDATION', message: 'Dữ liệu không hợp lệ.', details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })), requestId } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? exception.message);
      const code =
        status === 401
          ? 'UNAUTHENTICATED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : status === 413
                ? 'PAYLOAD_TOO_LARGE'
                : status === 429
                  ? 'RATE_LIMITED'
                  : status === 400
                    ? 'VALIDATION'
                    : 'INTERNAL';
      body = { error: { code, message: Array.isArray(message) ? message.join('; ') : String(message), requestId } };
      if (status === 429) res.setHeader('Retry-After', '60');
    } else {
      const e = exception as { code?: string; type?: string; status?: number };
      if (e?.type === 'entity.too.large' || e?.status === 413) {
        status = 413;
        body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Dữ liệu gửi lên quá lớn.', requestId } };
      } else if (e?.type === 'entity.parse.failed') {
        status = 400;
        body = { error: { code: 'VALIDATION', message: 'JSON không hợp lệ.', requestId } };
      } else if (e?.code === 'P2002') {
        status = 409;
        body = { error: { code: 'CONFLICT', message: 'Dữ liệu đã tồn tại.', requestId } };
      } else if (e?.code === 'P2025') {
        status = 404;
        body = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy.', requestId } };
      } else {
        this.log.error(
          { requestId, err: exception instanceof Error ? { name: exception.name, message: exception.message, stack: exception.stack } : exception },
          'Unhandled exception',
        );
      }
    }

    res.status(status).json(body);
  }
}
