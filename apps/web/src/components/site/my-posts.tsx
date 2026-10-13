'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { get } from '@/lib/client';
import { formatDate, localePath, tr, type Locale } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { STATUS } from './post-editor';

interface Row {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  slug: string | null;
  feedback: { action: string; reason: string } | null;
}
interface Data {
  items: Row[];
  page: number;
  totalPages: number;
  total: number;
}

export function MyPosts({ locale }: { locale: Locale }) {
  const t = tr(locale);
  const { user, loading } = useSession();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      setData(await get<Data>(`/me/posts?page=${page}&pageSize=10`));
    } catch {
      setError(true);
    }
  }, [page]);
  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (loading)
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!user)
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Alert kind="info">
          {t('Vui lòng đăng nhập để xem bài của bạn.', 'Please sign in to see your posts.')}{' '}
          <Link className="font-semibold underline" href={`${localePath(locale, '/dang-nhap-thanh-vien')}?returnTo=${encodeURIComponent(localePath(locale, '/bai-cua-toi'))}`}>
            {t('Đăng nhập', 'Sign in')}
          </Link>
        </Alert>
      </div>
    );
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-4xl font-semibold">{t('Bài của tôi', 'My posts')}</h1>
        <Button asChild>
          <Link href={localePath(locale, '/gui-bai')}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('Viết bài mới', 'New post')}
          </Link>
        </Button>
      </div>
      {error ? (
        <Alert kind="error" className="mt-6">
          {t('Không tải được danh sách.', 'Could not load the list.')}{' '}
          <button className="font-semibold underline" onClick={() => void load()}>
            {t('Thử lại', 'Retry')}
          </button>
        </Alert>
      ) : !data ? (
        <Skeleton className="mt-6 h-48 w-full" />
      ) : data.items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t('Bạn chưa có bài viết.', 'You have no posts yet.')}
            action={
              <Button asChild>
                <Link href={localePath(locale, '/gui-bai')}>{t('Viết bài đầu tiên', 'Write your first post')}</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {data.items.map((r) => {
              const s = STATUS[r.status];
              const editable = r.status === 'DRAFT' || r.status === 'CHANGES_REQUESTED';
              return (
                <li key={r.id} className="rounded-lg border border-line bg-white p-5 shadow-card" data-testid="my-post">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-serif text-xl font-semibold">{r.title || t('(chưa có tiêu đề)', '(untitled)')}</h2>
                      <p className="mt-1 text-sm text-muted">
                        {t('Cập nhật', 'Updated')} {formatDate(locale, r.updatedAt, true)}
                      </p>
                    </div>
                    <Badge tone={s?.tone}>{t(s?.vi ?? r.status, s?.en ?? r.status)}</Badge>
                  </div>
                  {r.feedback && (
                    <p className="mt-3 whitespace-pre-wrap rounded-md bg-accent-100 px-3 py-2 text-sm text-amber-900">
                      <strong>{r.feedback.action === 'REJECT' ? t('Từ chối: ', 'Rejected: ') : t('Yêu cầu sửa: ', 'Changes requested: ')}</strong>
                      {r.feedback.reason}
                    </p>
                  )}
                  <div className="mt-3 flex gap-4 text-sm font-semibold">
                    {editable && (
                      <Link className="inline-flex items-center gap-1 text-brand-700 underline" href={localePath(locale, `/gui-bai/${r.id}`)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        {t('Sửa / viết tiếp', 'Edit / continue')}
                      </Link>
                    )}
                    {r.status === 'PUBLISHED' && r.slug && (
                      <Link className="text-brand-700 underline" href={localePath(locale, `/bai-viet/${r.slug}`)}>
                        {t('Xem bài đã đăng', 'View published post')}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {data.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('Trước', 'Previous')}
              </Button>
              <span className="text-sm">
                {page}/{data.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                {t('Tiếp', 'Next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
