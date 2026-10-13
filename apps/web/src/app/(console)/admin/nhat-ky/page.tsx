import type { Metadata } from 'next';
import { AuditAdmin } from '@/components/console/admin-system';
export const metadata: Metadata = { title: 'Nhật ký' };
export default function Page() {
  return <AuditAdmin />;
}
