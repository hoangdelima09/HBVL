import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PostCardView } from '@/components/site/post-card';
import { EmptyState, Pagination } from '@/components/ui/misc';
import { apiGet } from '@/lib/api';
import { isLocale, localePath, tr } from '@/lib/i18n';
import type { CategoryNode, Paged, PostCard } from '@/lib/types';
import { cn, pageHref } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ category?: string; page?: string }> };
export const metadata: Metadata = { title: 'Thông báo & Tin tức' };

/** Filter and pagination happen on the SERVER (URL: ?category=&page=), so every page of every category is reachable — unlike the legacy client-side filter over 12 posts. */
export default async function Announcements({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw;
  const t = tr(locale);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const category = sp.category && /^[a-z0-9-]{1,100}$/.test(sp.category) ? sp.category : undefined;
  const [{ items: tree }, posts] = await Promise.all([
    apiGet<{ items: CategoryNode[] }>(`/categories?locale=${locale}`),
    apiGet<Paged<PostCard>>(`/posts?locale=${locale}&page=${page}&pageSize=12${category ? `&category=${category}` : ''}`),
  ]);
  const base = localePath(locale, '/thong-bao');
  const tab = (active: boolean) =>
    cn('rounded-full px-4 py-2 text-sm font-semibold', active ? 'bg-brand-600 text-white' : 'border border-line bg-white text-ink-2 hover:bg-brand-50');
  return (
    <div className="mx-auto max-w-[82rem] px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl font-semibold sm:text-5xl">{t('Thông Báo & Tin Tức', 'Announcements & News')}</h1>
      <p className="mt-2 text-lg text-ink-2">{t('Cập nhật thông tin mới nhất từ Quỹ Khuyến Học Đông Du', 'Latest updates from the Dong Du Study Encouragement Fund')}</p>
      <nav aria-label={t('Lọc theo chuyên mục', 'Filter by section')} className="mt-8 flex flex-wrap gap-2">
        <Link href={base} className={tab(!category)} aria-current={!category ? 'page' : undefined}>
          {t('Tất cả', 'All')}
        </Link>
        {tree.map((g) => (
          <Link key={g.slug} href={`${base}?category=${g.slug}`} className={tab(category === g.slug)} aria-current={category === g.slug ? 'page' : undefined}>
            {g.name}
          </Link>
        ))}
      </nav>
      {posts.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState title={t('Không có thông báo nào', 'No announcements found')}>
            {t('Chưa có bài viết nào trong danh mục đã chọn.', 'There are no announcements in the selected category.')}
          </EmptyState>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-muted" aria-live="polite">
            {posts.total} {t('bài viết', 'posts')}
          </p>
          <div className="mt-4 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.items.map((p) => (
              <PostCardView key={p.id} p={p} locale={locale} variant="CARD" />
            ))}
          </div>
          <Pagination
            page={posts.page}
            totalPages={posts.totalPages}
            hrefFor={(n) => pageHref(base, { category }, n)}
            labels={{ prev: t('Trước', 'Previous'), next: t('Tiếp', 'Next'), nav: t('Phân trang', 'Pagination'), page: t('Trang', 'Page') }}
          />
        </>
      )}
    </div>
  );
}
