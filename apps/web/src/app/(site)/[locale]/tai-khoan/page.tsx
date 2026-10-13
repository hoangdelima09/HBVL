import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccountPage } from '@/components/site/account';
import { isLocale } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Tài khoản', robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AccountPage locale={locale} />;
}
