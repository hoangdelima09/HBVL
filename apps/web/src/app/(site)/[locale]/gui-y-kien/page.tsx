import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FeedbackForm } from '@/components/site/forms-pages';
import { isLocale } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Gửi ý kiến', robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <FeedbackForm locale={locale} />;
}
