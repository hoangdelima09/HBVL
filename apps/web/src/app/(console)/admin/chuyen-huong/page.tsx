import type { Metadata } from 'next';
import { RedirectsAdmin } from '@/components/console/admin-system';
export const metadata: Metadata = { title: 'Chuyển hướng' };
export default function Page() {
  return <RedirectsAdmin />;
}
