'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { get, post } from '@/lib/client';
import { cn } from '@/lib/utils';
import { fmt } from './kit';

interface Notice {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: { feedbackId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

/** Where a staff notification leads. */
const target = (n: Notice, area: 'admin' | 'staff') => {
  const root = area === 'admin' ? '/admin' : '/cong-tac-vien';
  if (n.type === 'comment.reported') return `${root}/to-cao`;
  if (n.type === 'feedback.new') return `${root}/gop-y${n.data?.feedbackId ? `?open=${n.data.feedbackId}` : ''}`;
  if (n.type === 'post.submitted') return area === 'admin' ? '/admin/bai-viet' : '/cong-tac-vien/hang-cho';
  return '/tai-khoan';
};

/** Bell in the console header: unread count + the latest notifications (report alerts, new submissions). Polls every 30 s. */
export function ConsoleNotifications({ area }: { area: 'admin' | 'staff' }) {
  const [data, setData] = useState<{ unread: number; items: Notice[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      setData(await get<{ unread: number; items: Notice[] }>('/me/notifications'));
    } catch {
      /* the bell is a convenience; the queues themselves are authoritative */
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const markRead = async () => {
    await post('/me/notifications/read').catch(() => undefined);
    void load();
  };
  // A notification disappears once it has been read; opening it counts as reading it.
  const readOne = (id: string) => {
    setData((d) => ({ unread: Math.max(0, d.unread - 1), items: d.items.filter((i) => i.id !== id) }));
    void post(`/me/notifications/${id}/read`).catch(() => undefined);
  };
  const unread = data.items.filter((i) => !i.readAt);
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className="relative grid h-10 w-10 place-items-center rounded-md border border-line hover:bg-slate-50"
        aria-label={`Thông báo${data.unread ? ` (${data.unread} chưa đọc)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        data-testid="bell"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {data.unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-xs font-bold text-white" data-testid="bell-count">
            {data.unread > 99 ? '99+' : data.unread}
          </span>
        )}
      </button>
      {open && (
        <div role="region" aria-label="Thông báo" className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-line bg-white p-3 shadow-lift">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold">Thông báo</p>
            {data.unread > 0 && (
              <button className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => void markRead()}>
                Đánh dấu đã đọc
              </button>
            )}
          </div>
          {unread.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Không có thông báo mới.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {unread.slice(0, 15).map((n) => (
                <li key={n.id}>
                  <Link
                    href={target(n, area)}
                    onClick={() => {
                      readOne(n.id);
                      setOpen(false);
                    }}
                    className={cn('block rounded-md px-2 py-2 text-sm hover:bg-slate-50', 'bg-brand-50/60')}
                  >
                    <span className="block font-semibold">{n.title}</span>
                    {n.body && <span className="block text-muted">{n.body}</span>}
                    <span className="block text-xs text-muted">{fmt(n.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
