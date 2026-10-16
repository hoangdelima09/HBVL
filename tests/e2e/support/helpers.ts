import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { base32Decode, hotp, totpCounter } from '../../../apps/api/src/auth/totp';
import { MAILPIT, repoRoot } from './env';
import type { E2EUsers } from './global-setup';

export const users = (): E2EUsers => JSON.parse(readFileSync(resolve(repoRoot(), '.runtime/e2e-users.json'), 'utf8'));

export const PORTAL_PATH = { ADMIN: '/dang-nhap-quan-tri', COLLABORATOR: '/dang-nhap-cong-tac-vien', MEMBER: '/dang-nhap-thanh-vien' } as const;

// = 0;
/**
 * Sign-ins as admin happen many times inside one 30 s TOTP step (a step can be consumed only once — replay protection), so the suite uses
 * single-use recovery codes by default; `totp: true` is used by the one test that exercises the real authenticator path.
 */
export function mfaCodeFor(u: { mfaSecret?: string; recoveryCodes?: string[] }, opts: { totp?: boolean } = {}): string {
  if (opts.totp && u.mfaSecret) return hotp(base32Decode(u.mfaSecret), totpCounter(Date.now()));
  // Cross-worker counter: a mkdir lock serialises read-increment-write so no two sign-ins ever receive the same code.
  const file = resolve(repoRoot(), '.runtime/recovery-idx.json');
  const lock = `${file}.lock`;
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (i > 2000) {
        rmSync(lock, { recursive: true, force: true });
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  let idx = 0;
  try {
    idx = Number(JSON.parse(readFileSync(file, 'utf8'))) || 0;
  } catch {
    /* first use */
  }
  writeFileSync(file, String(idx + 1));
  rmSync(lock, { recursive: true, force: true });
  const code = u.recoveryCodes![idx];
  if (!code) throw new Error(`E2E recovery codes exhausted (index ${idx})`);
  return code;
}
export const totpFor = (secret: string) => hotp(base32Decode(secret), totpCounter(Date.now()));

/** Real sign-in through the UI form (used by the acceptance flows). */
export async function uiLogin(page: Page, key: keyof E2EUsers, opts: { returnTo?: string; totp?: boolean } = {}) {
  const u = users()[key]!;
  await page.goto(`${PORTAL_PATH[u.role as keyof typeof PORTAL_PATH]}${opts.returnTo ? `?returnTo=${encodeURIComponent(opts.returnTo)}` : ''}`);
  await page.getByLabel(/Tên đăng nhập hoặc email/).fill(u.username);
  await page
    .getByLabel(/^Mật khẩu/)
    .first()
    .fill(u.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
  if (u.mfaSecret) {
    // The account may have had two-factor authentication removed meanwhile (recovery tests): then there is no code form.
    const codeField = page.getByLabel(/Mã xác thực/);
    const asked = await Promise.race([
      codeField.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true),
      page.waitForURL((url) => !url.pathname.includes('dang-nhap'), { timeout: 15_000 }).then(() => false),
    ]);
    if (asked) {
      await codeField.fill(mfaCodeFor(u, { totp: opts.totp }));
      await page.getByRole('button', { name: 'Xác nhận' }).click();
    }
  }
  // Wait until the sign-in really completed (navigated away from the portal) so later navigations do not abort it.
  await page.waitForURL((url) => !url.pathname.includes('dang-nhap'), { timeout: 15_000 });
}

/** Session cookie obtained through the real login endpoint (faster than the UI for tests that are not about sign-in). */
export async function apiLogin(context: BrowserContext, key: keyof E2EUsers): Promise<void> {
  const u = users()[key]!;
  const base = 'http://localhost:3200';
  const req = context.request;
  // Double-submit CSRF: the header must equal the CURRENT cookie. A page that is open in the same context may re-issue the cookie between
  // our requests, so read it right before sending and retry once on a CSRF refusal (exactly what the web client does at send time).
  const currentCsrf = async () => {
    await req.get(`${base}/api/v1/auth/csrf`);
    return (await context.cookies(base)).find((c) => c.name === 'hbvl_csrf')?.value ?? '';
  };
  let res = await req.post(`${base}/api/v1/auth/login`, {
    headers: { origin: base, 'x-csrf-token': await currentCsrf() },
    data: { portal: u.role, identifier: u.username, password: u.password },
  });
  if (res.status() === 403)
    res = await req.post(`${base}/api/v1/auth/login`, {
      headers: { origin: base, 'x-csrf-token': await currentCsrf() },
      data: { portal: u.role, identifier: u.username, password: u.password },
    });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  if (body.mfaRequired) {
    const v = await req.post(`${base}/api/v1/auth/mfa/verify`, { headers: { origin: base, 'x-csrf-token': body.csrfToken }, data: { code: mfaCodeFor(u) } });
    expect(v.status(), await v.text()).toBe(200);
  }
}

/** An API client that holds its own cookie jar and CSRF token (for permission probes that bypass the UI on purpose). */
export async function apiClient(request: APIRequestContext, key: keyof E2EUsers) {
  const base = 'http://localhost:3200';
  const u = users()[key]!;
  let csrf = (await (await request.get(`${base}/api/v1/auth/csrf`)).json()).csrfToken as string;
  const login = await request.post(`${base}/api/v1/auth/login`, {
    headers: { origin: base, 'x-csrf-token': csrf },
    data: { portal: u.role, identifier: u.username, password: u.password },
  });
  expect(login.status()).toBe(200);
  const body = await login.json();
  csrf = body.csrfToken;
  if (body.mfaRequired) {
    const v = await request.post(`${base}/api/v1/auth/mfa/verify`, { headers: { origin: base, 'x-csrf-token': csrf }, data: { code: mfaCodeFor(u) } });
    csrf = (await v.json()).csrfToken;
  }
  const h = (extra: Record<string, string> = {}) => ({ origin: base, 'x-csrf-token': csrf, ...extra });
  return {
    get: (p: string) => request.get(`${base}/api/v1${p}`),
    post: (p: string, data?: unknown, extra?: Record<string, string>) => request.post(`${base}/api/v1${p}`, { headers: h(extra), data }),
    patch: (p: string, data?: unknown, extra?: Record<string, string>) => request.patch(`${base}/api/v1${p}`, { headers: h(extra), data }),
    delete: (p: string, extra?: Record<string, string>) => request.delete(`${base}/api/v1${p}`, { headers: h(extra) }),
  };
}

export const mail = {
  async all(): Promise<{ ID: string; Subject: string; To: { Address: string }[] }[]> {
    return ((await (await fetch(`${MAILPIT}/messages`)).json()) as { messages: never[] }).messages;
  },
  async waitFor(match: (m: { Subject: string; To: { Address: string }[] }) => boolean, ms = 20_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = (await mail.all()).find(match);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('expected e-mail did not arrive');
  },
  async text(id: string): Promise<string> {
    return ((await (await fetch(`${MAILPIT}/message/${id}`)).json()) as { Text: string }).Text;
  },
};

/** Collects console errors, page errors and failed same-origin requests so tests can assert a clean page. */
export function watchErrors(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === 'http://localhost:3200' && r.status() >= 500) problems.push(`HTTP ${r.status()} ${u.pathname}`);
  });
  return problems;
}

export async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}
