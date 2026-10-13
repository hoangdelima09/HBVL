import type { Metadata } from 'next';
import { ContentAdmin } from '@/components/console/admin-content';
export const metadata: Metadata = { title: 'Chương trình' };
export default function Page() {
  return <ContentAdmin kind="programs" />;
}
