import type { Metadata } from 'next';
import { DirectoryAdmin } from '@/components/console/admin-system';
export const metadata: Metadata = { title: 'Danh bạ tỉnh' };
export default function Page() {
  return <DirectoryAdmin />;
}
