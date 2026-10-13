import { ConsoleShell } from '@/components/console/shell';

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell area="staff">{children}</ConsoleShell>;
}
