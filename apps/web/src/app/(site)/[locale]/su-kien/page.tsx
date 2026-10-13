import type { Metadata } from 'next';
import { KindList } from '@/components/site/kind-pages';

export const metadata: Metadata = { title: 'Sự kiện' };
export default function Page(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string }> }) {
  return <KindList kind="EVENT" {...props} />;
}
