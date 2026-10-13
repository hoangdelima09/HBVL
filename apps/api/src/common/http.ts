import type { Request, Response } from 'express';
import { AppError, E } from './errors';

/** `If-Match: "3"` / `W/"3"` / `3` → 3. Missing header → 428 so clients can never blindly overwrite. */
export function parseIfMatch(req: Request): number {
  const raw = req.header('if-match');
  if (!raw) throw new AppError(428, 'VALIDATION', 'Thiếu header If-Match (phiên bản bài viết).');
  const m = /^(?:W\/)?"?(\d{1,9})"?$/.exec(raw.trim());
  if (!m) throw E.validation([{ path: 'If-Match', message: 'If-Match không hợp lệ.' }]);
  return Number(m[1]);
}

export const setEtag = (res: Response, version: number) => res.setHeader('ETag', `"${version}"`);

/** Marks responses that are safe for shared caches/CDNs: anonymous, locale-explicit, no cookies involved. */
export const publicCache = (res: Response, sMaxAge = 30, swr = 120) => res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`);
