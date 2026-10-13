import type { Metadata } from 'next';
import { PostReview } from '@/components/console/post-review';
export const metadata: Metadata = { title: 'Biên tập bài' };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostReview id={id} area="staff" />;
}
