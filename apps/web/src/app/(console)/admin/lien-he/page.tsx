import type { Metadata } from 'next';
import { ContactAdmin } from '@/components/console/admin-people';
export const metadata: Metadata = { title: 'Liên hệ' };
export default function Page() {
  return <ContactAdmin />;
}
