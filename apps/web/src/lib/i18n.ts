import { JA, JA_PROVINCES } from './ja';

export const LOCALES = ['vi', 'en', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'vi';
export const isLocale = (v: string): v is Locale => (LOCALES as readonly string[]).includes(v);

/** Cookie that remembers the visitor's language choice (1 year). Its absence means "never chosen" and triggers the first-visit language prompt. */
export const LANG_COOKIE = 'hbvl_lang';

/** Display names (own language), BCP-47 tags and Open Graph locales. */
export const LOCALE_INFO: Record<Locale, { label: string; short: string; bcp47: string; og: string }> = {
  vi: { label: 'Tiếng Việt', short: 'VI', bcp47: 'vi-VN', og: 'vi_VN' },
  en: { label: 'English', short: 'EN', bcp47: 'en-GB', og: 'en_US' },
  ja: { label: '日本語', short: 'JA', bcp47: 'ja-JP', og: 'ja_JP' },
};

/**
 * Inline translation like the legacy `charity_t()`: Vietnamese (source) and English sit at the call site, so a missing translation is visible in review.
 * Japanese: an explicit third argument wins, otherwise the dictionary in `ja.ts` (keyed by the Vietnamese string) is used, otherwise English.
 */
export type T = (vi: string, en: string, ja?: string) => string;
export const tr =
  (locale: Locale): T =>
  (vi, en, ja) => {
    if (locale === 'vi') return vi;
    if (locale === 'en') return en;
    return ja ?? JA[vi] ?? JA_PROVINCES[vi] ?? en;
  };

/** Pick a value per locale (Japanese falls back to English, then Vietnamese). */
export const byLocale = <V>(locale: Locale, v: { vi: V; en?: V; ja?: V }): V => (locale === 'ja' ? (v.ja ?? v.en ?? v.vi) : locale === 'en' ? (v.en ?? v.vi) : v.vi);

/** VI is the default locale and has no prefix (legacy URLs keep working); EN lives under /en and JA under /ja. */
export function localePath(locale: Locale, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return p;
  return p === '/' ? `/${locale}` : `/${locale}${p}`;
}

export function stripLocale(pathname: string): { locale: Locale; path: string } {
  for (const l of LOCALES) {
    if (l === DEFAULT_LOCALE) continue;
    if (pathname === `/${l}` || pathname.startsWith(`/${l}/`)) return { locale: l, path: pathname.slice(l.length + 1) || '/' };
  }
  return { locale: 'vi', path: pathname || '/' };
}

export function formatDate(locale: Locale, iso: string | Date | null | undefined, withTime = false): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(LOCALE_INFO[locale].bcp47, {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d);
}

export const siteOrigin = () => (process.env.PUBLIC_ORIGIN ?? 'http://localhost:3100').replace(/\/$/, '');

/** `hreflang` alternates for a path, used by the page metadata. */
export const languageAlternates = (path: string): Record<string, string> => ({
  vi: localePath('vi', path),
  en: localePath('en', path),
  ja: localePath('ja', path),
  'x-default': localePath('vi', path),
});
