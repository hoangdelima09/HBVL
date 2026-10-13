import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ForgotForm } from '@/components/site/auth-forms';
import { isLocale } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Quên mật khẩu', robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ForgotForm locale={locale} />;
}
