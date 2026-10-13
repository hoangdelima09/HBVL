import { ConsoleShell } from '@/components/console/shell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell area="admin">{children}</ConsoleShell>;
}
