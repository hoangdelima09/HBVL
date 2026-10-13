import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { E } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { safeEqual } from './crypto';
import { cookieNames, setCsrfCookie } from './cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated writes, two independent layers:
 *  1. Origin/Referer must be one of our origins (browsers always send Origin on cross-site POST).
 *  2. Double-submit token: header `X-CSRF-Token` must equal the CSRF cookie AND carry a valid HMAC bound to the current session
 *     (or to "anon" before login), so a token minted for one session is useless for another.
 */
@Injectable()
export class CsrfService {
  private readonly allowedOrigins: Set<string>;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.allowedOrigins = new Set(
      [env.PUBLIC_ORIGIN, ...env.EXTRA_ALLOWED_ORIGINS.split(',')]
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => new URL(o).origin),
    );
  }

  mint(sessionId?: string): string {
    const nonce = randomBytes(18).toString('base64url');
    return `${nonce}.${this.mac(nonce, sessionId)}`;
  }

  issue(res: Response, sessionId?: string): string {
    const token = this.mint(sessionId);
    setCsrfCookie(res, this.env, token);
    return token;
  }

  private mac(nonce: string, sessionId?: string): string {
    return createHmac('sha256', this.env.CSRF_SECRET)
      .update(`${nonce}|${sessionId ?? 'anon'}`)
      .digest('base64url');
  }

  /** Reuses the CSRF cookie when it is still valid for this session binding; mints a new one otherwise. Avoids rotating the token on every read. */
  ensure(req: Request, res: Response, sessionId?: string): string {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.env).csrf];
    if (cookie) {
      const [nonce, mac] = cookie.split('.');
      if (nonce && mac && safeEqual(mac, this.mac(nonce, sessionId))) return cookie;
    }
    return this.issue(res, sessionId);
  }

  isTrustedOrigin(req: Request): boolean {
    const origin = req.header('origin');
    if (origin) return this.allowedOrigins.has(origin);
    const referer = req.header('referer');
    if (referer) {
      try {
        return this.allowedOrigins.has(new URL(referer).origin);
      } catch {
        return false;
      }
    }
    return false;
  }

  verify(req: Request): boolean {
    if (!this.isTrustedOrigin(req)) return false;
    const header = req.header('x-csrf-token');
    const cookie = (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.env).csrf];
    if (!header || !cookie || !safeEqual(header, cookie)) return false;
    const [nonce, mac] = header.split('.');
    if (!nonce || !mac) return false;
    return safeEqual(mac, this.mac(nonce, req.auth?.session.id));
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrf: CsrfService) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (!this.csrf.verify(req)) throw E.csrf();
    return true;
  }
}
