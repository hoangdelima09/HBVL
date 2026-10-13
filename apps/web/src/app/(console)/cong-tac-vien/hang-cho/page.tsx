import type { Metadata } from 'next';
import { PostsList } from '@/components/console/lists';
export const metadata: Metadata = { title: 'Hàng chờ duyệt' };
export default function Page() {
  return <PostsList area="staff" queue />;
}
