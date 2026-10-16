import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, Bookmark, Heart, Layers, Map as MapIcon, Newspaper, Users } from 'lucide-react';
import { MapPreview } from '@/components/site/map-preview';
import { PostCardView } from '@/components/site/post-card';
import { Button } from '@/components/ui/button';
import { EmptyState, Eyebrow } from '@/components/ui/misc';
import { apiGet } from '@/lib/api';
import { isLocale, languageAlternates, localePath, tr, type Locale } from '@/lib/i18n';
import { categoryHref, type CategoryNode, type MapSummary, type Paged, type PostCard, type Settings } from '@/lib/types';
import { notFound } from 'next/navigation';

const ICONS: Record<string, typeof Layers> = { layers: Layers, users: Users, heart: Heart };
const PILLAR_ICONS: Record<string, typeof Layers> = { 'tin-tuc': Newspaper, 'dong-du-ky': MapIcon, 'so-tay-kien-thuc': BookOpen, 'goc-sach-hay': Bookmark, 'sinh-hoat': Users };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: { canonical: localePath(isLocale(locale) ? locale : 'vi', '/'), languages: languageAlternates('/') } };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const t = tr(locale);
  const [settings, tree, featured, blocks, map] = await Promise.all([
    apiGet<Settings>('/settings/public'),
    apiGet<{ items: CategoryNode[] }>(`/categories?locale=${locale}`),
    apiGet<{ items: PostCard[] }>(`/posts/featured?locale=${locale}`),
    apiGet<{ blocks: { category: { slug: string; parentSlug: string | null; name: string }; items: PostCard[] }[] }>(`/posts/home-blocks?locale=${locale}`),
    apiGet<MapSummary>('/map/summary?system=34'),
  ]);
  const h = settings.home;
  const hero = h.hero;
  const [lead, ...rest] = featured.items;
  const stat = (key: string, fallback: string) => {
    if (key === 'units') return '63 / 34';
    if (key === 'pillars') return String(tree.items.length);
    return fallback;
  };

  // The default title is split across two spans ("Học Bổng" + "Vươn Lên"); its Japanese form is "ライズアップ" + "奨学金".
  const heroJa: [string, string] | undefined = hero.titleLeadVi === 'Học Bổng' && hero.titleHighlightVi === 'Vươn Lên' ? ['ライズアップ', '奨学金'] : undefined;

  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-b from-paper via-paper to-white/60 border-b border-line/60">
        <div aria-hidden className="absolute inset-y-0 right-0 hidden w-[42%] bg-brand-50/70 [clip-path:polygon(18%_0,100%_0,100%_100%,0_100%)] lg:block pointer-events-none" />
        <div className="relative mx-auto max-w-[82rem] px-4 py-16 sm:px-6 lg:py-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-leaf-600/20 bg-white/90 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-leaf-700 shadow-subtle backdrop-blur-sm">
            <span className="h-2 w-2 rounded-full bg-accent-500 animate-pulse" aria-hidden />
            {t(hero.badgeVi, hero.badgeEn)}
          </span>
          <h1 className="mt-6 max-w-3xl font-serif text-5xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-6xl lg:text-7xl">
            {t(hero.titleLeadVi, hero.titleLeadEn, heroJa?.[0])} <span className="text-brand-600">{t(hero.titleHighlightVi, hero.titleHighlightEn, heroJa?.[1])}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg sm:text-xl leading-relaxed text-ink-2">{t(hero.descVi, hero.descEn)}</p>
          <div className="mt-9 flex flex-wrap gap-3.5">
            <Button asChild size="lg" className="shadow-lift">
              <Link href="#featured-stories">{t('Đọc tin nổi bật', 'Featured stories')}</Link>
            </Button>
            <Button asChild size="lg" variant="accent" className="shadow-lift">
              <Link href={localePath(locale, '/category/dong-du-ky/ban-do-vuon-len')}>{t('Bản đồ Vươn Lên', 'Member map')}</Link>
            </Button>
            <Button asChild size="lg" variant="secondary" className="shadow-subtle">
              <Link href={localePath(locale, '/gui-bai')}>{t('Gửi bài viết', 'Submit a story')}</Link>
            </Button>
          </div>
          <dl className="mt-14 grid max-w-2xl grid-cols-3 gap-4">
            {hero.stats.map((s) => (
              <div key={s.key} className="rounded-xl border border-line bg-white/90 p-4.5 shadow-card backdrop-blur-xs transition-transform hover:-translate-y-0.5">
                <dt className="order-2 mt-1 text-xs font-semibold text-muted tracking-tight">{t(s.labelVi, s.labelEn)}</dt>
                <dd className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-brand-700">{stat(s.key, s.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-[82rem] px-4 py-20 sm:px-6" aria-labelledby="mission-title">
        <div className="max-w-3xl">
          <Eyebrow>{t(h.mission.labelVi, h.mission.labelEn)}</Eyebrow>
          <h2 id="mission-title" className="mt-2 font-serif text-3xl sm:text-4xl font-semibold tracking-tight">
            {t(h.mission.titleVi, h.mission.titleEn)}
          </h2>
          <p className="mt-3 text-lg leading-relaxed text-ink-2">{t(h.mission.descVi, h.mission.descEn)}</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {h.mission.cards.map((c) => {
            const Icon = ICONS[c.icon] ?? Layers;
            return (
              <div key={c.titleVi} className="group rounded-2xl border border-line bg-white p-7 shadow-card transition-all duration-200 hover:shadow-lift hover:-translate-y-1">
                <span className="grid h-13 w-13 place-items-center rounded-2xl bg-leaf-50 text-leaf-700 ring-1 ring-leaf-200/80 shadow-subtle transition-transform group-hover:scale-105">
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
                <h3 className="mt-5 font-serif text-2xl font-semibold tracking-tight text-ink">{t(c.titleVi, c.titleEn)}</h3>
                <p className="mt-2.5 text-ink-2 leading-relaxed text-[0.95rem]">{t(c.descVi, c.descEn)}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-white border-y border-line/70 py-20 sm:py-24" aria-labelledby="pillars-title">
        <div className="mx-auto max-w-[82rem] px-4 sm:px-6">
          <Eyebrow>{t('5 Trụ cột nội dung', '5 Content pillars')}</Eyebrow>
          <h2 id="pillars-title" className="mt-2 font-serif text-3xl sm:text-4xl font-semibold tracking-tight">
            {t('Không Gian Tri Thức & Trải Nghiệm', 'Knowledge & Experience Spaces')}
          </h2>
          <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {tree.items.map((g, i) => {
              const Icon = PILLAR_ICONS[g.slug] ?? Layers;
              return (
                <li key={g.slug}>
                  <Link
                    href={localePath(locale, categoryHref(g))}
                    className="group flex h-full flex-col rounded-2xl border border-line bg-paper/70 p-5.5 transition-all duration-200 hover:bg-white hover:shadow-lift hover:-translate-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white shadow-subtle transition-transform group-hover:scale-105">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="font-serif text-2xl font-bold text-slate-500" aria-hidden>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <h3 className="mt-4.5 font-serif text-xl font-semibold tracking-tight text-ink group-hover:text-brand-700 transition-colors">{g.name}</h3>
                    <p className="mt-1.5 text-xs text-muted leading-relaxed line-clamp-2">{g.summary}</p>
                    <ul className="mt-3.5 flex flex-wrap gap-1.5">
                      {g.children.slice(0, 3).map((c) => (
                        <li key={c.slug} className="rounded-full bg-white px-2.5 py-0.5 text-[0.72rem] font-medium text-ink-2 ring-1 ring-line shadow-[0_1px_1px_rgba(0,0,0,0.02)]">
                          {c.name}
                        </li>
                      ))}
                    </ul>
                    <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-xs font-bold uppercase tracking-wider text-brand-700">
                      {t('Khám phá', 'Explore')}
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section id="featured-stories" className="mx-auto max-w-[82rem] scroll-mt-24 px-4 py-20 sm:px-6" aria-labelledby="featured-title">
        <div className="flex items-end justify-between gap-4 border-b border-brand-200/80 pb-5">
          <div>
            <Eyebrow className="text-brand-700">{t('Dòng tin Vươn Lên', 'Rise Up newsroom')}</Eyebrow>
            <h2 id="featured-title" className="mt-1 font-serif text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              {t('Tin nổi bật', 'Featured stories')}
            </h2>
          </div>
          <Link
            href={localePath(locale, '/thong-bao')}
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-900 transition-colors"
          >
            {t('Xem tất cả', 'View all')}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
        </div>
        {lead ? (
          <div className="mt-10 grid items-start gap-7 lg:grid-cols-[1.4fr_1fr]">
            <PostCardView p={lead} locale={locale} variant="LEAD" eager />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
              {rest.map((p) => (
                <PostCardView key={p.id} p={p} locale={locale} variant="CARD" />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <EmptyState title={t('Chưa có bài viết nào.', 'No stories yet.')}>
              {t('Khi có bài viết mới, các tin nổi bật sẽ xuất hiện ngay tại khu vực này.', 'Newly published stories will appear in this featured area.')}
            </EmptyState>
          </div>
        )}
      </section>

      {blocks.blocks.length > 0 && (
        <section className="bg-white border-y border-line/70 py-20 sm:py-24" aria-labelledby="latest-title">
          <div className="mx-auto max-w-[82rem] px-4 sm:px-6">
            <Eyebrow>{t('Theo chuyên mục', 'By section')}</Eyebrow>
            <h2 id="latest-title" className="mt-1 font-serif text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              {t('Cập nhật mới nhất', 'Latest updates')}
            </h2>
            <div className="mt-12 space-y-14">
              {blocks.blocks.map((b) => (
                <div key={b.category.slug}>
                  <div className="flex items-center justify-between border-b border-line pb-3">
                    <h3 className="font-serif text-2xl font-semibold tracking-tight text-ink flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden />
                      {b.category.name}
                    </h3>
                    <Link
                      href={localePath(locale, categoryHref(b.category))}
                      className="group text-sm font-semibold text-brand-700 hover:text-brand-900 inline-flex items-center gap-1 transition-colors"
                    >
                      {t('Xem thêm', 'More')}
                      <span className="transition-transform group-hover:translate-x-1" aria-hidden>
                        →
                      </span>
                    </Link>
                  </div>
                  <div className="mt-6 grid gap-6 md:grid-cols-3">
                    {b.items.map((p) => (
                      <PostCardView key={p.id} p={p} locale={locale} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-[82rem] px-4 py-20 sm:py-24 sm:px-6" aria-labelledby="map-title">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-4">
            <Eyebrow>{t(h.mapFeature.labelVi, h.mapFeature.labelEn)}</Eyebrow>
            <h2 id="map-title" className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              {t(h.mapFeature.titleVi, h.mapFeature.titleEn)}
            </h2>
            <p className="text-lg leading-relaxed text-ink-2">{t(h.mapFeature.descVi, h.mapFeature.descEn)}</p>
            <div className="pt-2 flex flex-wrap gap-2.5 text-xs font-semibold">
              <span className="rounded-full bg-white px-3.5 py-1.5 ring-1 ring-line shadow-subtle text-ink-2">{t('34 tỉnh/thành hiện hành', '34 current provinces/cities')}</span>
              <span className="rounded-full bg-white px-3.5 py-1.5 ring-1 ring-line shadow-subtle text-ink-2">{t('63 tỉnh/thành trước sắp xếp', '63 before reorganisation')}</span>
            </div>
            <p className="text-sm text-muted">
              {t(
                `${map.totals.members} thành viên tại ${map.totals.unitsWithMembers} tỉnh/thành.`,
                `${map.totals.members} members across ${map.totals.unitsWithMembers} provinces/cities.`,
                `${map.totals.unitsWithMembers}の省・市に${map.totals.members}名の会員がいます。`,
              )}
            </p>
            <div className="pt-2">
              <Button asChild variant="primary" size="lg" className="shadow-lift">
                <Link href={localePath(locale, '/category/dong-du-ky/ban-do-vuon-len')}>
                  {t('Khám phá bản đồ', 'Explore the map')}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
          <Link
            href={localePath(locale, '/category/dong-du-ky/ban-do-vuon-len')}
            aria-label={t('Mở bản đồ thành viên Vươn Lên', 'Open the Rise Up member map')}
            className="group block rounded-2xl border border-line bg-white p-7 shadow-card transition-all duration-300 hover:shadow-floating hover:-translate-y-1"
          >
            <MapPreview
              version={map.geometryVersion}
              label={t('Bản đồ Việt Nam gồm Phú Quốc, quần đảo Hoàng Sa và Trường Sa', 'Map of Vietnam including Phu Quoc, Hoang Sa and Truong Sa archipelagos')}
            />
          </Link>
        </div>
      </section>
    </>
  );
}

export type { Paged };
