import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ForgotForm } from '@/components/site/auth-forms';
import { isLocale } from '@/lib/i18n';
import { portalFromQuery } from '@/lib/portal';

export const metadata: Metadata = { title: 'Quên mật khẩu', robots: { index: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ForgotForm locale={locale} portal={portalFromQuery(await searchParams)} />;
}
