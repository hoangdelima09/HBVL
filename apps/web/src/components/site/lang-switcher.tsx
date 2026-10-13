'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LANG_COOKIE, LOCALES, LOCALE_INFO, localePath, stripLocale, tr, type Locale } from '@/lib/i18n';

export const rememberLocale = (l: Locale) => {
  document.cookie = `${LANG_COOKIE}=${l}; Path=/; Max-Age=31536000; SameSite=Lax`;
};

/** Switches language at any time while staying on the same page (same path + query). The choice is remembered in a cookie (1 year). */
export function LangSwitcher({ locale, className, tone = 'light' }: { locale: Locale; className?: string; tone?: 'light' | 'dark' }) {
  const pathname = usePathname() ?? '/';
  const sp = useSearchParams();
  const { path } = stripLocale(pathname);
  const qs = sp?.toString();
  const t = tr(locale);
  return (
    <div role="group" aria-label={t('Ngôn ngữ', 'Language', '言語')} className={cn('inline-flex items-center gap-1', className)}>
      {LOCALES.map((l) => (
        <Link
          key={l}
          href={`${localePath(l, path)}${qs ? `?${qs}` : ''}`}
          hrefLang={l}
          lang={l}
          title={LOCALE_INFO[l].label}
          aria-current={locale === l ? 'true' : undefined}
          onClick={() => rememberLocale(l)}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-bold',
            locale === l ? 'bg-white text-brand-900' : tone === 'dark' ? 'text-white/80 hover:text-white' : 'text-ink-2 hover:bg-paper-2',
          )}
        >
          {LOCALE_INFO[l].short}
        </Link>
      ))}
    </div>
  );
}
