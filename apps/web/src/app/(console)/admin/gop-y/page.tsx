import type { Metadata } from 'next';
import { FeedbackInbox } from '@/components/console/lists';
export const metadata: Metadata = { title: 'Ý kiến thành viên' };
export default function Page() {
  return <FeedbackInbox />;
}
