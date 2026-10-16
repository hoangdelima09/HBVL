'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { type ApiError, get } from '@/lib/client';
import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-2">
      <div>
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm sm:text-base text-muted leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn('rounded-2xl border border-line bg-white p-6 shadow-card transition-shadow', className)}>
      {(title || actions) && (
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-line/70 pb-3.5">
          {title && <h2 className="font-serif text-xl font-bold tracking-tight text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export const POST_STATUS: Record<string, { label: string; tone: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  PENDING_REVIEW: { label: 'Chờ duyệt', tone: 'brand' },
  CHANGES_REQUESTED: { label: 'Cần sửa', tone: 'warn' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  PUBLISHED: { label: 'Đã đăng', tone: 'ok' },
  PRIVATE: { label: 'Riêng tư', tone: 'neutral' },
  SCHEDULED: { label: 'Đã lên lịch', tone: 'brand' },
  TRASHED: { label: 'Đã xóa', tone: 'neutral' },
};
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={POST_STATUS[status]?.tone ?? 'neutral'}>{POST_STATUS[status]?.label ?? status}</Badge>;

export const fmt = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—';

/** Data loading with abort + latest-wins semantics, honest loading/error states and a retry. */
export function useQuery<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | Error | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const seq = useRef(0);
  const run = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await get<T>(path);
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (id === seq.current) setState((s) => ({ ...s, error: e as Error, loading: false }));
    }
  }, [path]);
  useEffect(() => {
    void run();
  }, [run]);
  return { ...state, reload: run };
}

export function QueryBoundary<T>({ q, children, empty }: { q: ReturnType<typeof useQuery<T>>; children: (d: T) => ReactNode; empty?: (d: T) => boolean }) {
  if (q.loading && !q.data)
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  if (q.error && !q.data)
    return (
      <Alert kind="error">
        {q.error.message}{' '}
        <Button size="sm" variant="outline" className="ml-2" onClick={() => void q.reload()}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Thử lại
        </Button>
      </Alert>
    );
  if (!q.data) return null;
  if (empty?.(q.data)) return <EmptyState title="Chưa có dữ liệu" />;
  return <>{children(q.data)}</>;
}

export interface Column<R> {
  key: string;
  header: string;
  cell: (r: R) => ReactNode;
  className?: string;
}
export function DataTable<R extends object>({ rows, columns, caption, rowKey }: { rows: R[]; columns: Column<R>[]; caption: string; rowKey?: (r: R) => string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-card">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-slate-50/90 text-xs font-bold uppercase tracking-wider text-slate-600">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-4.5 py-3.5', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {rows.map((r, i) => (
            <tr key={rowKey?.(r) ?? (r as { id?: string }).id ?? i} className="align-top transition-colors hover:bg-slate-50/70">
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4.5 py-3.5', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, totalPages, total, onPage }: { page: number; totalPages: number; total?: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted">
      <span aria-live="polite">
        {total !== undefined ? `${total} mục · ` : ''}Trang {page}/{totalPages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Trước
        </Button>
        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Tiếp
        </Button>
      </div>
    </div>
  );
}

export function Stat({ label, value, href, tone }: { label: string; value: ReactNode; href?: string; tone?: 'warn' | 'danger' }) {
  const body = (
    <div
      className={cn(
        'group rounded-2xl border border-line bg-white p-6 shadow-card transition-all duration-200',
        href && 'hover:border-brand-200 hover:shadow-lift hover:-translate-y-0.5',
        tone === 'warn' && 'border-amber-300 bg-amber-50/60',
        tone === 'danger' && 'border-red-200 bg-danger-50/60',
      )}
    >
      <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 font-serif text-4xl font-bold tracking-tight text-ink" data-testid={`stat-${label}`}>
        {value}
      </p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
