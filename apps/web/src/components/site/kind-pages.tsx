import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays, ExternalLink, MapPin } from 'lucide-react';
import { PostCardView, postHref } from '@/components/site/post-card';
import { Alert, EmptyState, Pagination } from '@/components/ui/misc';
import { apiGet } from '@/lib/api';
import { formatDate, isLocale, localePath, tr, type Locale } from '@/lib/i18n';
import type { Paged, PostCard, PostDetail } from '@/lib/types';
import { pageHref } from '@/lib/utils';

export type Kind = 'EVENT' | 'PROGRAM';
const CFG = {
  EVENT: {
    path: 'su-kien',
    api: 'events',
    vi: 'Sự kiện',
    en: 'Events',
    introVi: 'Các sự kiện của Quỹ Khuyến Học Đông Du.',
    introEn: 'Events of the Dong Du Study Encouragement Fund.',
  },
  PROGRAM: {
    path: 'chuong-trinh',
    api: 'programs',
    vi: 'Chương trình học bổng',
    en: 'Scholarship programs',
    introVi: 'Các chương trình học bổng của Quỹ.',
    introEn: 'Scholarship programs of the Fund.',
  },
} as const;

export async function KindList({ kind, params, searchParams }: { kind: Kind; params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const t = tr(locale);
  const c = CFG[kind];
  const page = Math.max(1, Number((await searchParams).page ?? 1) || 1);
  const data = await apiGet<Paged<PostCard>>(`/${c.api}?locale=${locale}&page=${page}&pageSize=12`);
  const base = localePath(locale, `/${c.path}`);
  return (
    <div className="mx-auto max-w-[82rem] px-4 py-12 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-ink">{t(c.vi, c.en)}</h1>
        <p className="mt-3 text-base sm:text-lg leading-relaxed text-ink-2">{t(c.introVi, c.introEn)}</p>
      </div>
      {data.items.length === 0 ? (
        <div className="mt-10">
          <EmptyState title={t('Chưa có nội dung.', 'Nothing here yet.')}>{t('Nội dung sẽ xuất hiện khi được đăng.', 'Content will appear once published.')}</EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {data.items.map((p) => (
              <PostCardView key={p.id} p={p} locale={locale} variant="CARD" />
            ))}
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            hrefFor={(n) => pageHref(base, {}, n)}
            labels={{ prev: t('Trước', 'Previous'), next: t('Tiếp', 'Next'), nav: t('Phân trang', 'Pagination'), page: t('Trang', 'Page') }}
          />
        </>
      )}
    </div>
  );
}

export async function KindDetail({ kind, params }: { kind: Kind; params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const t = tr(locale);
  const c = CFG[kind];
  const p = await apiGet<PostDetail>(`/${c.api}/${slug}?locale=${locale}`);
  return (
    <div className="mx-auto max-w-[82rem] px-4 py-10 sm:px-6">
      <article className="mx-auto max-w-reading">
        <p className="text-sm">
          <Link href={localePath(locale, `/${c.path}`)} className="group inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:text-brand-900 transition-colors">
            <span className="transition-transform group-hover:-translate-x-1" aria-hidden>
              ←
            </span>
            {t(c.vi, c.en)}
          </Link>
        </p>
        <h1 className="mt-4 font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-[1.18] tracking-tight text-ink">{p.title}</h1>
        {p.translationMissing && (
          <Alert kind="warning" className="mt-4">
            {t('Chưa có bản tiếng Anh. Đang hiển thị bản tiếng Việt gốc.', 'No English translation yet. Showing the Vietnamese original.')}
          </Alert>
        )}
        {/* Only facts that were actually entered are shown — nothing is invented when a date/venue is missing. */}
        <dl className="mt-6 flex flex-wrap gap-3 text-sm text-ink-2">
          {p.event?.startsAt && (
            <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 shadow-subtle">
              <CalendarDays className="h-4 w-4 text-brand-600" aria-hidden />
              <dt className="sr-only">{t('Thời gian', 'When')}</dt>
              <dd className="font-medium">
                {formatDate(locale, p.event.startsAt, true)}
                {p.event.endsAt ? ` — ${formatDate(locale, p.event.endsAt, true)}` : ''}
              </dd>
            </div>
          )}
          {p.event?.locationText && (
            <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 shadow-subtle">
              <MapPin className="h-4 w-4 text-brand-600" aria-hidden />
              <dt className="sr-only">{t('Địa điểm', 'Where')}</dt>
              <dd className="font-medium">{p.event.locationText}</dd>
            </div>
          )}
          {p.program?.openFrom && (
            <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 shadow-subtle">
              <CalendarDays className="h-4 w-4 text-brand-600" aria-hidden />
              <dt className="sr-only">{t('Thời gian mở', 'Open')}</dt>
              <dd className="font-medium">
                {formatDate(locale, p.program.openFrom)}
                {p.program.openUntil ? ` — ${formatDate(locale, p.program.openUntil)}` : ''}
              </dd>
            </div>
          )}
          {p.program?.applyUrl && (
            <div className="flex items-center">
              <a
                className="inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 font-semibold text-brand-700 shadow-subtle hover:bg-brand-100 hover:text-brand-900 transition-colors"
                href={p.program.applyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                {t('Liên kết đăng ký', 'Application link')}
              </a>
            </div>
          )}
        </dl>
        {p.featured && (
          <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-slate-100 shadow-lift">
            <Image src={p.featured.large} alt="" width={p.featured.width ?? 1200} height={p.featured.height ?? 675} priority className="aspect-[16/9] w-full object-cover" />
          </div>
        )}
        <div className="prose-hbvl mt-8" dangerouslySetInnerHTML={{ __html: p.contentHtml }} />
        <p className="mt-10 text-sm text-muted">
          <Link href={postHref(locale, p)} className="hidden">
            {p.title}
          </Link>
        </p>
      </article>
    </div>
  );
}
