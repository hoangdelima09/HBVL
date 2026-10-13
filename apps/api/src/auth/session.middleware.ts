import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env';
import { cookieNames } from './cookies';
import type { SessionService } from './session.service';

/** Resolves the session cookie (if any) into `req.auth` for every request. Never throws: invalid cookies are treated as anonymous. */
export function sessionMiddleware(sessions: SessionService, env: Env) {
  const name = cookieNames(env).session;
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[name];
    if (token && token.length >= 20 && token.length <= 200) {
      try {
        const ctx = await sessions.resolve(token);
        if (ctx) req.auth = ctx;
      } catch {
        /* DB hiccup: fall through as anonymous; protected routes will answer 401 */
      }
    }
    next();
  };
}
