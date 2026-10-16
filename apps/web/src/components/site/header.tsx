'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown, Menu, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { localePath, tr, type Locale } from '@/lib/i18n';
import { categoryHref, type CategoryNode } from '@/lib/types';
import { AccountNav } from './account-nav';
import { LangSwitcher } from './lang-switcher';
import { useSession } from '@/lib/session';

const DESKTOP = '(min-width: 1280px)';

export function SiteHeader({ locale, tree, location, siteName, orgName }: { locale: Locale; tree: CategoryNode[]; location: string; siteName: string; orgName: string }) {
  const t = tr(locale);
  const pathname = usePathname();
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Mobile menu: close on route change, on Escape, and when the viewport grows to desktop. Body scroll is locked only while open and ALWAYS released.
  useEffect(() => {
    setOpen(false);
    setSub(null);
  }, [pathname]);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSub(null);
        toggleRef.current?.focus();
      }
    };
    mq.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    return () => {
      mq.removeEventListener('change', onChange);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const top =
    'whitespace-nowrap rounded-full px-3 py-1.5 min-[1280px]:px-2 min-[1440px]:px-3 text-[0.8rem] font-semibold tracking-wide text-ink-2 transition-colors hover:bg-brand-50 hover:text-brand-700';

  return (
    <>
      <div className="bg-brand-900 text-white border-b border-brand-700/40">
        <div className="mx-auto flex max-w-[82rem] items-center justify-between gap-3 px-4 py-1.5 text-xs sm:px-6">
          <span className="truncate text-white/85 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500 shrink-0" aria-hidden />
            {location}
          </span>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden sm:block">
              <AccountNav locale={locale} />
            </div>
            <div className="h-3 w-px bg-white/20 hidden sm:block" aria-hidden />
            <LangSwitcher locale={locale} tone="dark" />
          </div>
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b border-line/90 bg-white/95 shadow-subtle backdrop-blur-md">
        <div className="mx-auto flex max-w-[82rem] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href={localePath(locale, '/')} className="group flex min-w-0 items-center gap-3 transition-opacity hover:opacity-95 min-[1280px]:shrink-0">
            <Image
              src="/brand/dong-du-logo.jpg"
              alt=""
              width={44}
              height={44}
              priority
              className="h-11 w-11 rounded-xl object-contain shadow-subtle ring-1 ring-black/5 transition-transform group-hover:scale-105"
            />
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-serif text-xl font-bold tracking-tight text-brand-700 sm:text-2xl">{siteName}</span>
              <span className="block truncate text-xs font-medium text-muted">{orgName}</span>
            </span>
          </Link>

          <nav
            id="site-navigation"
            aria-label={t('Trình đơn chính', 'Primary')}
            className={cn(
              'min-[1280px]:static min-[1280px]:inset-auto min-[1280px]:flex min-[1280px]:items-center min-[1280px]:gap-0.5 min-[1280px]:overflow-visible min-[1280px]:border-0 min-[1280px]:bg-transparent min-[1280px]:p-0 min-[1280px]:shadow-none',
              'absolute inset-x-0 top-full z-30 max-h-[calc(100dvh-4.25rem)] overflow-y-auto border-t border-line bg-white p-4 shadow-floating min-[1280px]:max-h-none',
              open ? 'block' : 'hidden min-[1280px]:flex',
            )}
          >
            <ul className="flex flex-col gap-1 min-[1280px]:flex-row min-[1280px]:items-center min-[1280px]:gap-0.5">
              <li>
                <Link className={top} href={localePath(locale, '/')}>
                  {t('Trang chủ', 'Home')}
                </Link>
              </li>
              {tree.map((g) => (
                <li key={g.slug} className="group relative">
                  <div className="flex items-center">
                    <Link className={cn(top, 'flex-1')} href={localePath(locale, categoryHref(g))}>
                      {g.navLabel}
                    </Link>
                    <button
                      type="button"
                      aria-label={`${g.navLabel}: ${t('mục con', 'sub-sections')}`}
                      aria-expanded={sub === g.slug}
                      aria-controls={`sub-${g.slug}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-brand-50"
                      onClick={() => setSub(sub === g.slug ? null : g.slug)}
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', sub === g.slug && 'rotate-180')} aria-hidden />
                    </button>
                  </div>
                  <ul
                    id={`sub-${g.slug}`}
                    className={cn(
                      'ml-4 mt-1 space-y-0.5 border-l-2 border-brand-100 pl-3',
                      'min-[1280px]:absolute min-[1280px]:left-0 min-[1280px]:top-full min-[1280px]:z-50 min-[1280px]:ml-0 min-[1280px]:mt-0 min-[1280px]:w-72 min-[1280px]:rounded-xl min-[1280px]:border min-[1280px]:border-line min-[1280px]:bg-white min-[1280px]:p-2.5 min-[1280px]:shadow-floating',
                      sub === g.slug ? 'block' : 'hidden min-[1280px]:group-hover:block min-[1280px]:group-focus-within:block',
                    )}
                  >
                    {g.children.map((c) => (
                      <li key={c.slug}>
                        <Link
                          className="block rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-brand-50 hover:text-brand-700"
                          href={localePath(locale, categoryHref(c))}
                        >
                          {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {user && (
                <li>
                  <Link className={top} href={localePath(locale, '/gui-bai')}>
                    {t('Đăng bài', 'New post')}
                  </Link>
                </li>
              )}
              <li>
                <Link className={top} href={localePath(locale, '/lien-he')}>
                  {t('Liên hệ', 'Contact')}
                </Link>
              </li>
              <li>
                <form role="search" action={localePath(locale, '/tim-kiem')} method="get" className="relative mt-2 min-[1280px]:mt-0 min-[1280px]:ml-2">
                  <label htmlFor="nav-search" className="sr-only">
                    {t('Tìm kiếm', 'Search')}
                  </label>
                  <input
                    id="nav-search"
                    name="q"
                    type="search"
                    autoComplete="off"
                    maxLength={100}
                    placeholder={t('Tìm kiếm…', 'Search…')}
                    className="h-9 w-full rounded-full border border-slate-300/90 bg-paper/60 pl-3.5 pr-10 text-xs placeholder:text-slate-500 shadow-subtle transition-all focus:bg-white focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 min-[1280px]:w-32 min-[1440px]:w-44"
                  />
                  <button
                    type="submit"
                    aria-label={t('Tìm', 'Search')}
                    className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-white shadow-subtle transition-all hover:bg-brand-700 active:scale-95"
                  >
                    <Search className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </form>
              </li>
              <li className="mt-3 border-t border-line pt-3 sm:hidden">
                <AccountNavMobile locale={locale} />
              </li>
            </ul>
          </nav>

          <button
            ref={toggleRef}
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition-colors hover:bg-paper-2 min-[1280px]:hidden"
            aria-controls="site-navigation"
            aria-expanded={open}
            aria-label={open ? t('Đóng trình đơn', 'Close menu') : t('Mở trình đơn', 'Open menu')}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </header>
    </>
  );
}

function AccountNavMobile({ locale }: { locale: Locale }) {
  return (
    <div className="rounded-lg bg-brand-900 p-2">
      <AccountNav locale={locale} />
    </div>
  );
}
