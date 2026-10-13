import type { Metadata } from 'next';
import { PostsList } from '@/components/console/lists';
export const metadata: Metadata = { title: 'Quản lý bài viết' };
export default function Page() {
  return <PostsList area="staff" />;
}
