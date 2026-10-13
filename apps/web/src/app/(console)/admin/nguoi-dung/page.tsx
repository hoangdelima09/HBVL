import type { Metadata } from 'next';
import { UsersAdmin } from '@/components/console/admin-people';
export const metadata: Metadata = { title: 'Người dùng' };
export default function Page() {
  return <UsersAdmin />;
}
