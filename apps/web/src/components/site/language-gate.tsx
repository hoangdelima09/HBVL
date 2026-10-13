'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/dialog';
import { LANG_COOKIE, LOCALES, LOCALE_INFO, localePath, stripLocale, type Locale } from '@/lib/i18n';
import { rememberLocale } from './lang-switcher';

const hasChosen = () => {
  try {
    return new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=(?:vi|en|ja)(?:;|$)`).test(document.cookie);
  } catch {
    return true; // cookies unavailable: never nag
  }
};

/**
 * First visit: ask which language to use. The answer is stored in a cookie (so we never ask again) and the visitor can switch at any time
 * with the header switcher. Closing the prompt keeps the language of the page they are on. Rendered after hydration only, so crawlers and
 * shared links always receive the normal page.
 */
export function LanguageGate({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? '/';
  const sp = useSearchParams();
  const { path } = stripLocale(pathname);
  const qs = sp?.toString();
  useEffect(() => {
    if (!hasChosen()) setOpen(true);
  }, []);
  const close = () => {
    rememberLocale(locale);
    setOpen(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      title="Chọn ngôn ngữ · Choose your language · 言語を選択"
      description="Học Bổng Vươn Lên — Rise Up Scholarship — ライズアップ奨学金"
      closeLabel="Đóng · Close · 閉じる"
    >
      <ul className="grid gap-3" data-testid="language-gate">
        {LOCALES.map((l) => (
          <li key={l}>
            <Link
              href={`${localePath(l, path)}${qs ? `?${qs}` : ''}`}
              hrefLang={l}
              lang={l}
              data-testid={`lang-${l}`}
              onClick={() => {
                rememberLocale(l);
                setOpen(false);
              }}
              className="flex items-center justify-between rounded-xl border-2 border-line bg-white px-5 py-4 text-lg font-semibold text-ink hover:border-brand-500 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span>{LOCALE_INFO[l].label}</span>
              <span className="rounded-full bg-paper-2 px-2.5 py-0.5 text-xs font-bold text-ink-2">{LOCALE_INFO[l].short}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
