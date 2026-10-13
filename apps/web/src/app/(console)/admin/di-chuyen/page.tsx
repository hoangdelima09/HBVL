import type { Metadata } from 'next';
import { MigrationAdmin } from '@/components/console/admin-system';
export const metadata: Metadata = { title: 'Di chuyển WordPress' };
export default function Page() {
  return <MigrationAdmin />;
}
