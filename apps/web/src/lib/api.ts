import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

const BASE = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3101').replace(/\/$/, '');

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code?: string,
    message?: string,
  ) {
    super(message ?? `API ${status}`);
  }
}

/**
 * Server-side GET for PUBLIC data. Cookies are deliberately NOT forwarded: public HTML must be identical for everyone (cacheable by a CDN),
 * personal UI is hydrated in the browser from /auth/me. The real client IP is forwarded so API rate limits are per visitor, not per web server.
 */
export async function apiGet<T>(path: string, opts: { notFoundOn404?: boolean } = { notFoundOn404: true }): Promise<T> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '127.0.0.1';
  const res = await fetch(`${BASE}/api/v1${path}`, { cache: 'no-store', headers: { 'x-forwarded-for': ip, accept: 'application/json' } });
  if (res.status === 404 && opts.notFoundOn404 !== false) notFound();
  if (!res.ok) {
    let code: string | undefined;
    try {
      code = ((await res.json()) as { error?: { code?: string } }).error?.code;
    } catch {
      /* not JSON */
    }
    throw new ApiFailure(res.status, code);
  }
  return (await res.json()) as T;
}

/** Same, but returns null on 404 (used to probe optional resources such as redirects). */
export async function apiTry<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path, { notFoundOn404: false });
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null;
    throw e;
  }
}
