import type { Metadata } from 'next';
import { MembersModeration } from '@/components/console/moderation';
export const metadata: Metadata = { title: 'Thành viên' };
export default function Page() {
  return <MembersModeration />;
}
