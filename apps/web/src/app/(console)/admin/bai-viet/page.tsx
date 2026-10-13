import type { Metadata } from 'next';
import { PostsList } from '@/components/console/lists';
export const metadata: Metadata = { title: 'Bài viết' };
export default function Page() {
  return <PostsList area="admin" />;
}
