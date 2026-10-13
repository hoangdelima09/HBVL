import type { Metadata } from 'next';
import { KindDetail } from '@/components/site/kind-pages';
import { apiGet } from '@/lib/api';
import { isLocale } from '@/lib/i18n';
import type { PostDetail } from '@/lib/types';

type Props = { params: Promise<{ locale: string; slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const p = await apiGet<PostDetail>(`/events/${slug}?locale=${isLocale(locale) ? locale : 'vi'}`);
  return { title: p.title, description: p.excerpt };
}
export default function Page(props: Props) {
  return <KindDetail kind="EVENT" {...props} />;
}
