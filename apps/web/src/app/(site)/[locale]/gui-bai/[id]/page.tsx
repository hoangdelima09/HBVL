import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PostEditor } from '@/components/site/post-editor';
import { isLocale } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Sửa bài', robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <PostEditor locale={locale} postId={id} />;
}
