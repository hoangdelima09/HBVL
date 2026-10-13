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
      <div className="border-b border-line bg-gradient-to-br from-brand-50 to-paper">
        <div className="mx-auto max-w-[82rem] px-4 py-10 sm:px-6">
          <nav aria-label="Breadcrumb" className="text-sm text-muted">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link href={localePath(locale, '/')} className="hover:underline">
                  {t('Trang chủ', 'Home')}
                </Link>
              </li>
              {parent && (
                <>
                  <li aria-hidden>/</li>
                  <li>
                    <Link href={localePath(locale, categoryHref(parent))} className="hover:underline">
                      {parent.name}
                    </Link>
                  </li>
                </>
              )}
              <li aria-hidden>/</li>
              <li aria-current="page" className="font-semibold text-ink">
                {current.name}
              </li>
            </ol>
          </nav>
          <h1 className="mt-3 font-serif text-4xl font-semibold sm:text-5xl">{current.name}</h1>
          <p className="mt-2 max-w-3xl text-lg text-ink-2">{current.description ?? current.summary}</p>
        </div>
      </div>
      <div className="mx-auto max-w-[82rem] space-y-12 px-4 py-12 sm:px-6">
        {group && (
          <section aria-labelledby="sub-title">
            <h2 id="sub-title" className="font-serif text-2xl font-semibold">
              {t('Các mục nhỏ', 'Subsections')}
            </h2>
            <ul className="mt-4 grid gap-4 md:grid-cols-3">
              {group.children.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={localePath(locale, categoryHref(c))}
                    className="block h-full rounded-lg border border-line bg-white p-5 shadow-card transition-shadow hover:shadow-lift"
                  >
                    <h3 className="font-serif text-xl font-semibold text-brand-700">{c.name}</h3>
                    <p className="mt-1 text-sm text-muted">{c.description}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {map && <MapExplorer locale={locale} initialVersion={map.geometryVersion} />}
        <section aria-labelledby="posts-title">
          <h2 id="posts-title" className="font-serif text-2xl font-semibold">
            {t('Nội dung đã đăng', 'Published content')}
          </h2>
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
