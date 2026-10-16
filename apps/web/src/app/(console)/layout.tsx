import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import '../globals.css';
import { ExtensionAttributeGuard } from '@/components/extension-attribute-guard';
import { SessionProvider } from '@/lib/session';

// Strict CSP uses a per-request nonce, which only works for dynamically rendered pages (static HTML would carry no nonce and scripts would be blocked).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: { default: 'Khu vực quản lý', template: '%s · Quản lý HBVL' }, robots: { index: false, follow: false } };

/** Consoles (admin / collaborator) are Vietnamese-only internal tools with their own layout; they never share chrome with the public site. */
export default function ConsoleRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="bg-slate-50" suppressHydrationWarning>
        <ExtensionAttributeGuard />
        <SessionProvider>
          {children}
          <Toaster richColors closeButton position="top-center" />
        </SessionProvider>
      </body>
    </html>
  );
}
