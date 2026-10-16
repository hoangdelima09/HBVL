'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  FileText,
  KeyRound,
  Flag,
  FolderTree,
  GraduationCap,
  History,
  Inbox,
  LogOut,
  Mail,
  Map as MapIcon,
  Menu,
  MessageSquare,
  Newspaper,
  Repeat,
  Settings,
  ShieldCheck,
  Users,
  X,
  ClipboardList,
} from 'lucide-react';
import { Alert, Skeleton } from '@/components/ui/misc';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { ConsoleNotifications } from './notifications';
import { cn } from '@/lib/utils';

type Area = 'admin' | 'staff';
interface Item {
  href: string;
  label: string;
  icon: typeof BarChart3;
  exact?: boolean;
}

const ADMIN_NAV: { group: string; items: Item[] }[] = [
  { group: 'Tổng quan', items: [{ href: '/admin', label: 'Bảng điều khiển', icon: BarChart3, exact: true }] },
  {
    group: 'Nội dung',
    items: [
      { href: '/admin/bai-viet', label: 'Bài viết & duyệt bài', icon: Newspaper },
      { href: '/admin/chuyen-muc', label: 'Chuyên mục', icon: FolderTree },
      { href: '/admin/trang', label: 'Trang tĩnh', icon: FileText },
      { href: '/admin/su-kien', label: 'Sự kiện', icon: CalendarDays },
      { href: '/admin/chuong-trinh', label: 'Chương trình học bổng', icon: BookOpen },
    ],
  },
  {
    group: 'Cộng đồng',
    items: [
      { href: '/admin/hoc-vien', label: 'Học viên & bản đồ', icon: GraduationCap },
      { href: '/admin/danh-ba', label: 'Danh bạ tỉnh', icon: MapIcon },
      { href: '/admin/gop-y', label: 'Ý kiến thành viên', icon: MessageSquare },
      { href: '/admin/lien-he', label: 'Liên hệ', icon: Mail },
      { href: '/admin/binh-luan', label: 'Bình luận', icon: Inbox },
      { href: '/admin/to-cao', label: 'Bình luận bị tố cáo', icon: Flag },
    ],
  },
  {
    group: 'Hệ thống',
    items: [
      { href: '/admin/nguoi-dung', label: 'Người dùng & vai trò', icon: Users },
      { href: '/admin/yeu-cau-xac-thuc', label: 'Yêu cầu gỡ xác thực 2 lớp', icon: KeyRound },
      { href: '/admin/cai-dat', label: 'Cài đặt & trang chủ', icon: Settings },
      { href: '/admin/chuyen-huong', label: 'Chuyển hướng URL cũ', icon: Repeat },
      { href: '/admin/nhat-ky', label: 'Nhật ký hệ thống', icon: History },
    ],
  },
];
const STAFF_NAV: { group: string; items: Item[] }[] = [
  { group: 'Tổng quan', items: [{ href: '/cong-tac-vien', label: 'Bảng điều khiển', icon: BarChart3, exact: true }] },
  {
    group: 'Biên tập',
    items: [
      { href: '/cong-tac-vien/hang-cho', label: 'Hàng chờ duyệt', icon: ClipboardList },
      { href: '/cong-tac-vien/bai-viet', label: 'Quản lý bài viết', icon: Newspaper },
    ],
  },
  {
    group: 'Cộng đồng',
    items: [
      { href: '/cong-tac-vien/gop-y', label: 'Ý kiến thành viên', icon: MessageSquare },
      { href: '/cong-tac-vien/binh-luan', label: 'Kiểm duyệt bình luận', icon: Inbox },
      { href: '/cong-tac-vien/to-cao', label: 'Bình luận bị tố cáo', icon: Flag },
      { href: '/cong-tac-vien/thanh-vien', label: 'Thành viên', icon: Users },
    ],
  },
];

/** Own layout + sidebar per area; menu items are a convenience only — every API call is authorised on the server. */
export function ConsoleShell({ area, children }: { area: Area; children: ReactNode }) {
  const { user, mfaVerified, loading, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const h = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener('change', h);
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', k);
    return () => {
      mq.removeEventListener('change', h);
      document.removeEventListener('keydown', k);
    };
  }, []);

  const loginHref = area === 'admin' ? '/dang-nhap-quan-tri' : '/dang-nhap-cong-tac-vien';
  if (loading)
    return (
      <div className="p-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-6 h-72 w-full" />
      </div>
    );
  if (user?.mustChangePassword) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24">
        <Alert kind="warning" title="Bạn cần đổi mật khẩu trước">
          Quản trị viên đã đặt lại mật khẩu của bạn về mật khẩu tạm thời. Hãy đổi mật khẩu rồi quay lại khu vực này.
        </Alert>
        <div className="mt-4">
          <Button asChild>
            <Link href="/tai-khoan">Đổi mật khẩu</Link>
          </Button>
        </div>
      </div>
    );
  }
  const allowed = user && (area === 'admin' ? user.role === 'ADMIN' : user.role === 'COLLABORATOR' || user.role === 'ADMIN');
  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24">
        <Alert kind={user ? 'error' : 'info'} title={user ? 'Bạn không có quyền vào khu vực này' : 'Cần đăng nhập'}>
          {user ? 'Tài khoản hiện tại không thuộc vai trò phù hợp.' : 'Vui lòng đăng nhập bằng cổng dành cho vai trò của bạn.'}
        </Alert>
        <div className="mt-4 flex gap-3">
          <Button asChild>
            <Link href={`${loginHref}?returnTo=${encodeURIComponent(pathname ?? '/')}`}>Đăng nhập</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Về trang chủ</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (area === 'admin' && (!user.mfaEnabled || !mfaVerified)) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24">
        <Alert kind="warning" title="Cần xác thực hai lớp (MFA)">
          {!user.mfaEnabled
            ? 'Tài khoản quản trị bắt buộc bật xác thực hai lớp. Hãy bật MFA trong Tài khoản, sau đó đăng nhập lại.'
            : 'Phiên hiện tại chưa hoàn tất bước xác thực hai lớp. Hãy đăng nhập lại và nhập mã.'}
        </Alert>
        <div className="mt-4 flex gap-3">
          {!user.mfaEnabled ? (
            <Button asChild>
              <Link href="/tai-khoan">Bật MFA trong Tài khoản</Link>
            </Button>
          ) : (
            <Button
              onClick={async () => {
                await logout();
                router.push(loginHref);
              }}
            >
              Đăng nhập lại
            </Button>
          )}
        </div>
      </div>
    );
  }

  const nav = area === 'admin' ? ADMIN_NAV : STAFF_NAV;
  const sidebar = (
    <nav aria-label={area === 'admin' ? 'Trình đơn quản trị' : 'Trình đơn cộng tác viên'} className="space-y-6">
      {nav.map((g) => (
        <div key={g.group}>
          <p className="px-3 text-xs font-bold uppercase tracking-wider text-slate-400">{g.group}</p>
          <ul className="mt-2 space-y-0.5">
            {g.items.map((i) => {
              const active = i.exact ? pathname === i.href : pathname === i.href || pathname?.startsWith(`${i.href}/`);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                      active ? 'bg-brand-600 text-white shadow-sm font-semibold' : 'text-slate-300 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <i.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-[#f8f9fb] lg:grid lg:grid-cols-[17rem_1fr]" data-area={area}>
      <a href="#console-main" className="sr-only z-[100] rounded-md bg-white px-4 py-2 font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Bỏ qua tới nội dung
      </a>
      <aside className="hidden bg-slate-950 p-4 border-r border-slate-800/80 lg:block">
        <Link
          href={area === 'admin' ? '/admin' : '/cong-tac-vien'}
          className="mb-6 flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 font-serif text-xl font-bold text-white tracking-tight"
        >
          <ShieldCheck className="h-5 w-5 text-accent-400" aria-hidden />
          {area === 'admin' ? 'Quản trị HBVL' : 'Cộng tác viên'}
        </Link>
        {sidebar}
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Trình đơn">
          <button type="button" className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" aria-label="Đóng trình đơn" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-slate-950 p-4 border-r border-slate-800">
            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="mb-4 ml-auto block rounded-full p-2 text-white hover:bg-white/10">
              <X className="h-5 w-5" aria-hidden />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line/80 bg-white/95 backdrop-blur-md px-5 py-3 shadow-subtle">
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-white shadow-subtle hover:bg-paper lg:hidden"
            aria-label="Mở trình đơn"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <div className="hidden items-center gap-2 lg:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{area === 'admin' ? 'Khu vực quản trị' : 'Khu vực cộng tác viên'}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <ConsoleNotifications area={area} />
            <Link href="/" className="font-semibold text-brand-700 hover:text-brand-900 transition-colors">
              Xem website
            </Link>
            <span className="hidden items-center gap-1.5 max-w-48 text-xs font-medium text-muted bg-paper-2 border border-line pl-1 pr-2.5 py-1 rounded-full sm:inline-flex">
              <Avatar src={user.avatarUrl} name={user.displayName} size={20} />
              <span className="truncate">{user.displayName}</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await logout();
                router.push(loginHref);
              }}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              Đăng xuất
            </Button>
          </div>
        </header>
        <main id="console-main" tabIndex={-1} className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
