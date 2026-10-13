import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge of the web app (Next 16 "proxy", Node runtime):
 *  1. Per-request CSP nonce (strict script policy, no 'unsafe-inline' for scripts).
 *  2. Locale routing: VI has NO prefix (legacy URLs stay valid) and is rewritten internally to /vi; EN lives under /en, JA under /ja.
 *     `/vi/...` is redirected to the unprefixed URL so every page has exactly one canonical URL.
 *  3. A remembered EN/JA preference sends only the bare entry point ("/") to that language; explicit URLs always win.
 *     The first-visit language prompt (no cookie yet) is a client component, so crawlers and shared links always get a normal page.
 */
const dev = process.env.NODE_ENV !== 'production';
const CONSOLE = /^\/(admin|cong-tac-vien)(\/|$)/;
/** Locales that live under a URL prefix (Vietnamese, the default, has none). */
const PREFIXED = ['en', 'ja'];

function csp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com https://www.openstreetmap.org',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Same-origin API: `/api/v1/*` is forwarded to the NestJS API. Resolved at REQUEST time from API_INTERNAL_URL
  // (next.config `rewrites()` would freeze the destination at build time). A production reverse proxy normally routes /api/v1 directly.
  if (pathname.startsWith('/api/v1/')) {
    const base = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3101').replace(/\/$/, '');
    return NextResponse.rewrite(new URL(`${base}${pathname}${search}`));
  }
  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('content-security-policy', policy);

  const finish = (res: NextResponse) => {
    res.headers.set('Content-Security-Policy', policy);
    // Pages are dynamic and anonymous; the CDN may cache them briefly (stale-while-revalidate), never per user.
    return res;
  };

  if (pathname === '/vi' || pathname.startsWith('/vi/')) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.slice(3) || '/';
    return NextResponse.redirect(url, 308);
  }
  if (CONSOLE.test(pathname)) return finish(NextResponse.next({ request: { headers: reqHeaders } }));

  const prefixed = PREFIXED.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  const preferred = req.cookies.get('hbvl_lang')?.value;
  if (!prefixed && pathname === '/' && preferred && PREFIXED.includes(preferred)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${preferred}`;
    const res = NextResponse.redirect(url, 307);
    res.headers.set('Cache-Control', 'private, no-store');
    res.headers.append('Vary', 'Cookie');
    return res;
  }
  if (prefixed) return finish(NextResponse.next({ request: { headers: reqHeaders } }));

  const url = req.nextUrl.clone();
  url.pathname = `/vi${pathname === '/' ? '' : pathname}`;
  url.search = search;
  return finish(NextResponse.rewrite(url, { request: { headers: reqHeaders } }));
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|media/|brand/|robots.txt|sitemap.xml|.*\\..*).*)'],
};
