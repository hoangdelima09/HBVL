import Link from 'next/link';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Alert({ kind = 'info', children, className, title }: { kind?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode; className?: string; title?: string }) {
  const styles = {
    info: 'bg-brand-50 text-brand-900 border-brand-200',
    error: 'bg-danger-50 text-danger-600 border-red-200',
    success: 'bg-ok-50 text-ok-600 border-green-200',
    warning: 'bg-accent-100 text-amber-900 border-amber-300',
  }[kind];
  const Icon = { info: Info, error: AlertCircle, success: CheckCircle2, warning: AlertCircle }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-md border px-4 py-3 text-sm', styles, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'leaf'; className?: string }) {
  const t = {
    neutral: 'bg-slate-100 text-slate-800',
    brand: 'bg-brand-100 text-brand-900',
    ok: 'bg-ok-50 text-ok-600 ring-1 ring-green-200',
    warn: 'bg-accent-100 text-amber-900',
    danger: 'bg-danger-50 text-danger-600 ring-1 ring-red-200',
    leaf: 'bg-leaf-50 text-leaf-700',
  }[tone];
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', t, className)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-slate-200/80', className)} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <Inbox className="mx-auto h-10 w-10 text-slate-400" aria-hidden />
      <h3 className="mt-3 text-lg font-semibold text-ink">{title}</h3>
      {children && <p className="mx-auto mt-1 max-w-md text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Server-rendered pagination using plain links (works without JS, shareable URLs, back/forward friendly). */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  labels,
}: {
  page: number;
  totalPages: number;
  hrefFor: (p: number) => string;
  labels: { prev: string; next: string; nav: string; page: string };
}) {
  if (totalPages <= 1) return null;
  const around = new Set([1, totalPages, page - 1, page, page + 1]);
  const nums = [...around].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const items: (number | '…')[] = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1]! > 1) items.push('…');
    items.push(n);
  });
  const base = 'inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm font-semibold';
  return (
    <nav aria-label={labels.nav} className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={cn(base, 'border border-line bg-white hover:bg-brand-50')}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {labels.prev}
        </Link>
      ) : null}
      {items.map((n, i) =>
        n === '…' ? (
          <span key={`e${i}`} aria-hidden className="px-1 text-muted">
            …
          </span>
        ) : (
          <Link
            key={n}
            href={hrefFor(n)}
            aria-label={`${labels.page} ${n}`}
            aria-current={n === page ? 'page' : undefined}
            className={cn(base, n === page ? 'bg-brand-600 text-white' : 'border border-line bg-white hover:bg-brand-50')}
          >
            {n}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} rel="next" className={cn(base, 'border border-line bg-white hover:bg-brand-50')}>
          {labels.next}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </nav>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-xs font-bold uppercase tracking-[0.14em] text-leaf-700', className)}>{children}</span>;
}
