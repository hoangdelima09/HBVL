import type { Metadata } from 'next';
import { ReportsQueue } from '@/components/console/moderation';
export const metadata: Metadata = { title: 'Bình luận bị tố cáo' };
export default function Page() {
  return <ReportsQueue />;
}
