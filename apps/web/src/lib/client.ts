'use client';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** field → message map for form errors (from zod issues) */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) for (const d of this.details as { path?: string; message?: string }[]) if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
    return out;
  }
}

let csrf: string | undefined; // fallback only (cookies unreadable); the live source of truth is the cookie itself
let csrfInFlight: Promise<string> | undefined;

async function fetchCsrf(): Promise<string> {
  csrfInFlight ??= fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => r.json())
    .then((j: { csrfToken: string }) => (csrf = j.csrfToken))
    .finally(() => {
      csrfInFlight = undefined;
    });
  return csrfInFlight;
}
export const setCsrfToken = (t: string | undefined) => {
  if (t) csrf = t;
};

/** Double-submit pattern: the header must equal the CSRF cookie *as it is now*. Reading the cookie at send time avoids races between concurrent first requests that each mint a token. */
function readCsrfCookie(): string | undefined {
  const m = /(?:^|;\s*)(?:__Host-)?hbvl_csrf=([^;]*)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : undefined;
}
async function currentCsrf(): Promise<string> {
  const c = readCsrfCookie();
  if (c) return c;
  await fetchCsrf();
  return readCsrfCookie() ?? csrf ?? '';
}

export interface RequestOpts {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  form?: FormData;
}

export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: RequestOpts = {},
): Promise<T & { _headers?: Headers }> {
  const unsafe = method !== 'GET';
  const run = async (retry: boolean): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    if (unsafe) headers['X-CSRF-Token'] = await currentCsrf();
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`/api/v1${path}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store', signal: opts.signal });
    if (res.status === 403 && unsafe && retry) {
      const peek = (await res
        .clone()
        .json()
        .catch(() => null)) as { error?: { code?: string } } | null;
      if (peek?.error?.code === 'CSRF') {
        csrf = undefined;
        await fetchCsrf();
        return run(false);
      }
    }
    return res;
  };
  const res = await run(true);
  if (!res.ok) {
    let e: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      e = await res.json();
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, e.error?.code ?? 'INTERNAL', e.error?.message ?? 'Đã xảy ra lỗi. Vui lòng thử lại.', e.error?.details);
  }
  if (res.status === 204) return { _headers: res.headers } as T & { _headers?: Headers };
  const json = (await res.json()) as T & { csrfToken?: string };
  if (json && typeof json === 'object' && 'csrfToken' in json && json.csrfToken) csrf = json.csrfToken;
  Object.defineProperty(json, '_headers', { value: res.headers, enumerable: false });
  return json;
}

export const get = <T>(path: string, o?: RequestOpts) => api<T>('GET', path, undefined, o);
export const post = <T>(path: string, body?: unknown, o?: RequestOpts) => api<T>('POST', path, body, o);
export const put = <T>(path: string, body?: unknown, o?: RequestOpts) => api<T>('PUT', path, body, o);
export const patch = <T>(path: string, body?: unknown, o?: RequestOpts) => api<T>('PATCH', path, body, o);
export const del = <T>(path: string, o?: RequestOpts) => api<T>('DELETE', path, undefined, o);

export const newIdempotencyKey = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`) + '-key';
export const etagVersion = (h?: Headers): number | undefined => {
  const v = h?.get('etag')?.replace(/[^0-9]/g, '');
  return v ? Number(v) : undefined;
};
