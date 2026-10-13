import type { Metadata } from 'next';
import { CommentModeration } from '@/components/console/lists';
export const metadata: Metadata = { title: 'Bình luận' };
export default function Page() {
  return <CommentModeration />;
}
