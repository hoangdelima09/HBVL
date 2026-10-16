import type { Metadata } from 'next';
import { MfaRequestsAdmin } from '@/components/console/mfa-requests';
export const metadata: Metadata = { title: 'Yêu cầu gỡ xác thực 2 lớp' };
export default function Page() {
  return <MfaRequestsAdmin />;
}
