import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapExplorer } from '@/components/site/map-explorer';
import { PostCardView } from '@/components/site/post-card';
import { Button } from '@/components/ui/button';
import { EmptyState, Pagination } from '@/components/ui/misc';
import { apiGet } from '@/lib/api';
import { isLocale, localePath, tr, type Locale } from '@/lib/i18n';
import { categoryHref, type CategoryNode, type MapSummary, type Paged, type PostCard } from '@/lib/types';
import { pageHref } from '@/lib/utils';

type Props = { params: Promise<{ locale: string; slug: string[] }>; searchParams: Promise<{ page?: string }> };

async function resolve(locale: Locale, slug: string[]) {
  if (slug.length < 1 || slug.length > 2) notFound();
  const { items } = await apiGet<{ items: CategoryNode[] }>(`/categories?locale=${locale}`);
  const leaf = slug[slug.length - 1]!;
  const parent = slug.length === 2 ? items.find((g) => g.slug === slug[0]) : undefined;
  const group = slug.length === 1 ? items.find((g) => g.slug === leaf) : undefined;
  const item = parent?.children.find((c) => c.slug === leaf);
  if (!group && !item) notFound();
  return { group, parent, item, current: (group ?? item)! };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const { current, group, parent } = await resolve(locale, slug);
  return {
    title: current.name,
    description: current.description ?? current.summary ?? undefined,
    alternates: { canonical: localePath(locale, categoryHref({ slug: current.slug, parentSlug: group ? null : parent?.slug })) },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw;
  const t = tr(locale);
  const page = Math.max(1, Number((await searchParams).page ?? 1) || 1);
  const { group, parent, item, current } = await resolve(locale, slug);
  const isMap = item?.slug === 'ban-do-vuon-len';
  const [posts, map] = await Promise.all([
    apiGet<Paged<PostCard>>(`/posts?locale=${locale}&category=${current.slug}&page=${page}&pageSize=12`),
    isMap ? apiGet<MapSummary>('/map/summary?system=34') : Promise.resolve(null),
  ]);
  const base = localePath(locale, categoryHref({ slug: current.slug, parentSlug: group ? null : parent?.slug }));

  return (
    <>
      <div className="border-b border-line bg-gradient-to-b from-paper to-white/70">
        <div className="mx-auto max-w-[82rem] px-4 py-8 sm:px-6">
          <nav aria-label="Breadcrumb" className="text-xs font-medium text-muted">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href={localePath(locale, '/')} className="hover:text-brand-700 transition-colors">
                  {t('Trang chủ', 'Home')}
                </Link>
              </li>
              {parent && (
                <>
                  <li aria-hidden className="text-slate-300">
                    /
                  </li>
                  <li>
                    <Link href={localePath(locale, categoryHref(parent))} className="hover:text-brand-700 transition-colors">
                      {parent.name}
                    </Link>
                  </li>
                </>
              )}
              <li aria-hidden className="text-slate-300">
                /
              </li>
              <li aria-current="page" className="font-semibold text-ink">
                {current.name}
              </li>
            </ol>
          </nav>
          <h1 className="mt-4 font-serif text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-ink">{current.name}</h1>
          {(current.description ?? current.summary) && <p className="mt-2.5 max-w-3xl text-base sm:text-lg leading-relaxed text-ink-2">{current.description ?? current.summary}</p>}
        </div>
      </div>
      <div className="mx-auto max-w-[82rem] space-y-14 px-4 py-12 sm:px-6">
        {group && (
          <section aria-labelledby="sub-title">
            <div className="flex items-center gap-2 mb-5">
              <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden />
              <h2 id="sub-title" className="font-serif text-2xl font-bold text-ink">
                {t('Các mục nhỏ', 'Subsections')}
              </h2>
            </div>
            <ul className="grid gap-5 md:grid-cols-3">
              {group.children.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={localePath(locale, categoryHref(c))}
                    className="group block h-full rounded-2xl border border-line bg-white p-6 shadow-card transition-all duration-200 hover:border-brand-200 hover:shadow-lift hover:-translate-y-0.5"
                  >
                    <h3 className="font-serif text-xl font-bold text-brand-700 group-hover:text-brand-800 transition-colors">{c.name}</h3>
                    <p className="mt-2 text-sm text-muted leading-relaxed">{c.description}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {map && <MapExplorer locale={locale} initialVersion={map.geometryVersion} />}
        <section aria-labelledby="posts-title">
          <div className="flex items-center gap-2 mb-6">
            <span className="h-2 w-2 rounded-full bg-accent-500" aria-hidden />
            <h2 id="posts-title" className="font-serif text-2xl font-bold text-ink">
              {t('Nội dung đã đăng', 'Published content')}
            </h2>
          </div>
          {posts.items.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                title={t('Chưa có bài viết trong chuyên mục này.', 'No posts in this section yet.')}
                action={
                  <Button asChild variant="secondary">
                    <Link href={localePath(locale, '/gui-bai')}>{t('Đóng góp bài viết', 'Submit a story')} →</Link>
                  </Button>
                }
              >
                {t('Hãy là người đầu tiên chia sẻ câu chuyện!', 'Be the first to share your story!')}
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {posts.items.map((p) => (
                  <PostCardView key={p.id} p={p} locale={locale} variant={p.category?.cardType ?? item?.cardType ?? 'CARD'} />
                ))}
              </div>
              <Pagination
                page={posts.page}
                totalPages={posts.totalPages}
                hrefFor={(n) => pageHref(base, {}, n)}
                labels={{ prev: t('Trước', 'Previous'), next: t('Tiếp', 'Next'), nav: t('Phân trang', 'Pagination'), page: t('Trang', 'Page') }}
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
