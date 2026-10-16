import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ResetForm } from '@/components/site/auth-forms';
import { isLocale } from '@/lib/i18n';
import { portalFromQuery } from '@/lib/portal';

export const metadata: Metadata = { title: 'Đặt mật khẩu mới', robots: { index: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const q = await searchParams;
  return <ResetForm locale={locale} token={(Array.isArray(q.token) ? q.token[0] : q.token) ?? ''} portal={portalFromQuery(q)} />;
}
