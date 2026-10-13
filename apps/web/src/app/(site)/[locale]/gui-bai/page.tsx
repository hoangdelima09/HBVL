import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PostEditor } from '@/components/site/post-editor';
import { isLocale, localePath } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Gửi bài', robots: { index: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ article?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { article } = await searchParams;
  if (article && /^[0-9a-f-]{36}$/i.test(article)) redirect(localePath(locale, `/gui-bai/${article}`)); // legacy `?article=ID`
  return <PostEditor locale={locale} />;
}
