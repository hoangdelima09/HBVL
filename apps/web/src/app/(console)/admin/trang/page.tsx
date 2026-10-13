import type { Metadata } from 'next';
import { PagesAdmin } from '@/components/console/admin-content';
export const metadata: Metadata = { title: 'Trang tĩnh' };
export default function Page() {
  return <PagesAdmin />;
}
