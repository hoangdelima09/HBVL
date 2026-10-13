import type { Metadata } from 'next';
import { MembersAdmin } from '@/components/console/admin-system';
export const metadata: Metadata = { title: 'Học viên' };
export default function Page() {
  return <MembersAdmin />;
}
