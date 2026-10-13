import type { Metadata } from 'next';
import { SettingsAdmin } from '@/components/console/admin-system';
export const metadata: Metadata = { title: 'Cài đặt' };
export default function Page() {
  return <SettingsAdmin />;
}
