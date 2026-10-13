import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ResetForm } from '@/components/site/auth-forms';
import { isLocale } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Đặt mật khẩu mới', robots: { index: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { token } = await searchParams;
  return <ResetForm locale={locale} token={(Array.isArray(token) ? token[0] : token) ?? ''} />;
}
