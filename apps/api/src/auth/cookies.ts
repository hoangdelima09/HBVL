import type { Response } from 'express';
import type { Env } from '../config/env';

export function cookieNames(env: Env) {
  const prefix = env.COOKIE_SECURE ? '__Host-' : '';
  return { session: `${prefix}${env.SESSION_COOKIE_NAME}`, csrf: `${prefix}hbvl_csrf` };
}

export function setSessionCookie(res: Response, env: Env, token: string, persistentMs: number | null): void {
  res.cookie(cookieNames(env).session, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    ...(persistentMs ? { maxAge: persistentMs } : {}),
  });
}

export function clearSessionCookie(res: Response, env: Env): void {
  res.clearCookie(cookieNames(env).session, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/' });
}

/** The CSRF cookie is readable by JS on purpose (double-submit pattern); it carries no authority on its own. */
export function setCsrfCookie(res: Response, env: Env, token: string): void {
  res.cookie(cookieNames(env).csrf, token, { httpOnly: false, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/' });
}
