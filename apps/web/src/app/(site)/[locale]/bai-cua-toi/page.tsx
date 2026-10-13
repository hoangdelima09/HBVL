import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MyPosts } from '@/components/site/my-posts';
import { isLocale } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Bài của tôi', robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <MyPosts locale={locale} />;
}
