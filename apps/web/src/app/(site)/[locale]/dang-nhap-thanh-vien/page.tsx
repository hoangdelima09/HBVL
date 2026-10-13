import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LoginPortal } from '@/components/site/auth-forms';
import { isLocale } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Đăng nhập thành viên', robots: { index: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // `redirect_to` is the parameter name the WordPress theme used.
  return <LoginPortal portal="MEMBER" locale={locale} returnTo={pick(sp.returnTo) ?? pick(sp.redirect_to)} />;
}
