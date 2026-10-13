import type { Metadata } from 'next';
import { ContentAdmin } from '@/components/console/admin-content';
export const metadata: Metadata = { title: 'Sự kiện' };
export default function Page() {
  return <ContentAdmin kind="events" />;
}
