import type { Metadata } from 'next';
import { AdminDashboard } from '@/components/console/lists';
export const metadata: Metadata = { title: 'Bảng điều khiển' };
export default function Page() {
  return <AdminDashboard />;
}
