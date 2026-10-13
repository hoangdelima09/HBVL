import type { Metadata } from 'next';
import { CategoriesAdmin } from '@/components/console/admin-content';
export const metadata: Metadata = { title: 'Chuyên mục' };
export default function Page() {
  return <CategoriesAdmin />;
}
