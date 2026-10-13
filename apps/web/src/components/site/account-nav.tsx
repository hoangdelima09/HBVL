'use client';

import Link from 'next/link';
import { LogOut, MessageSquare, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { localePath, tr, type Locale } from '@/lib/i18n';
import { Skeleton } from '@/components/ui/misc';

/** Personal part of the header — rendered only in the browser from /auth/me so the page HTML stays user-agnostic. */
export function AccountNav({ locale }: { locale: Locale }) {
  const t = tr(locale);
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const link = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white/90 hover:bg-white/10 hover:text-white';
  if (loading) return <Skeleton className="h-5 w-28 bg-white/20" />;
  if (!user) {
    return (
      <Link className={link} href={localePath(locale, '/dang-nhap-thanh-vien')}>
        <UserRound className="h-3.5 w-3.5" aria-hidden />
        {t('Đăng nhập', 'Sign in')}
      </Link>
    );
  }
  const home = user.role === 'ADMIN' ? '/admin' : user.role === 'COLLABORATOR' ? '/cong-tac-vien' : localePath(locale, '/tai-khoan');
  return (
    <div className="flex items-center gap-1" data-testid="account-nav">
      <Link className={link} href={home}>
        <UserRound className="h-3.5 w-3.5" aria-hidden />
        <span className="max-w-32 truncate">{user.displayName}</span>
      </Link>
      <Link className={link} href={localePath(locale, '/gui-y-kien')}>
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        {t('Gửi ý kiến', 'Feedback')}
      </Link>
      <button
        type="button"
        className={link}
        onClick={async () => {
          await logout();
          router.push(localePath(locale, '/'));
          router.refresh();
        }}
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        {t('Đăng xuất', 'Sign out')}
      </button>
    </div>
  );
}
