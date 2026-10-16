import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Heart, MessageCircle, Music2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate, localePath, tr, type Locale } from '@/lib/i18n';
import { categoryHref, type PostCard } from '@/lib/types';
import { Badge } from '@/components/ui/misc';

export const postHref = (locale: Locale, p: Pick<PostCard, 'slug' | 'kind'>) =>
  localePath(locale, p.kind === 'EVENT' ? `/su-kien/${p.slug}` : p.kind === 'PROGRAM' ? `/chuong-trinh/${p.slug}` : `/bai-viet/${p.slug}`);

function Thumb({ p, sizes, eager, className }: { p: PostCard; sizes?: string; eager?: boolean; className?: string }) {
  if (p.featured) {
    return (
      <Image
        src={p.featured.card}
        alt=""
        width={800}
        height={450}
        sizes={sizes ?? '(min-width: 1024px) 33vw, 100vw'}
        loading={eager ? 'eager' : 'lazy'}
        className={cn('aspect-[16/9] w-full object-cover', className)}
      />
    );
  }
  return (
    <span aria-hidden className={cn('grid aspect-[16/9] w-full place-items-center bg-gradient-to-br from-brand-600 to-brand-900 text-white', className)}>
      <span className="rounded-full border-2 border-white/60 px-5 py-2 text-sm font-bold tracking-widest">HBVL</span>
    </span>
  );
}

function Meta({ p, locale }: { p: PostCard; locale: Locale }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      {p.publishedAt && <time dateTime={p.publishedAt}>{formatDate(locale, p.publishedAt)}</time>}
      {p.author && <span>{p.author}</span>}
      {p.likes > 0 && (
        <span className="inline-flex items-center gap-1">
          <Heart className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Likes</span>
          {p.likes}
        </span>
      )}
      {p.comments > 0 && (
        <span className="inline-flex items-center gap-1">
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Comments</span>
          {p.comments}
        </span>
      )}
    </div>
  );
}

function Fallback({ p, t }: { p: PostCard; t: ReturnType<typeof tr> }) {
  return p.translationMissing ? (
    <Badge tone="warn" className="mt-2">
      {t('Chưa có bản dịch — hiển thị bản tiếng Việt', 'Not translated yet — showing the Vietnamese original')}
    </Badge>
  ) : null;
}

/** One card component with the four legacy visual types: card (default), profile, song, tip — chosen by the category's cardType. */
export function PostCardView({ p, locale, variant, eager }: { p: PostCard; locale: Locale; variant?: 'CARD' | 'PROFILE' | 'SONG' | 'TIP' | 'LEAD'; eager?: boolean }) {
  const t = tr(locale);
  const kind = variant ?? p.category?.cardType ?? 'CARD';
  const href = postHref(locale, p);
  const cat = p.category;

  if (kind === 'SONG') {
    return (
      <article className="flex gap-4 rounded-xl border border-line bg-white p-5 shadow-card transition-all duration-200 hover:shadow-lift hover:-translate-y-0.5">
        <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-100 text-accent-700 shadow-subtle ring-1 ring-amber-200">
          <Music2 className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h3 className="font-serif text-xl font-semibold leading-snug text-ink">
            <Link href={href} className="transition-colors hover:text-brand-700">
              {p.title}
            </Link>
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{p.excerpt}</p>
          <Link href={href} className="group/link mt-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-700 hover:text-brand-900">
            {t('Xem bài hát', 'View song')}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-1" aria-hidden />
          </Link>
        </div>
      </article>
    );
  }
  if (kind === 'PROFILE') {
    return (
      <article className="flex items-center gap-4.5 rounded-xl border border-line bg-white p-4.5 shadow-card transition-all duration-200 hover:shadow-lift hover:-translate-y-0.5">
        {p.featured ? (
          <Image src={p.featured.thumb} alt="" width={96} height={96} loading="lazy" className="h-24 w-24 shrink-0 rounded-full object-cover ring-2 ring-brand-100 shadow-subtle" />
        ) : (
          <span
            aria-hidden
            className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-leaf-50 font-serif text-3xl font-semibold text-leaf-700 ring-2 ring-leaf-200 shadow-subtle"
          >
            {p.title.trim().charAt(0)}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-serif text-xl font-semibold text-ink">
            <Link href={href} className="transition-colors hover:text-brand-700">
              {p.title}
            </Link>
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{p.excerpt}</p>
          <Link href={href} className="group/link mt-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-700 hover:text-brand-900">
            {t('Xem hồ sơ', 'View profile')}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-1" aria-hidden />
          </Link>
        </div>
      </article>
    );
  }
  if (kind === 'TIP') {
    return (
      <article className="rounded-xl border-l-4 border-accent-500 border-y border-r border-line bg-white p-5.5 shadow-card transition-all duration-200 hover:shadow-lift hover:-translate-y-0.5">
        {cat && (
          <Link href={localePath(locale, categoryHref(cat))} className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-accent-700 hover:underline">
            {cat.name}
          </Link>
        )}
        <h3 className="mt-1 font-serif text-xl font-semibold text-ink">
          <Link href={href} className="transition-colors hover:text-brand-700">
            {p.title}
          </Link>
        </h3>
        <p className="mt-2 line-clamp-3 text-sm text-muted leading-relaxed">{p.excerpt}</p>
        <Link href={href} className="group/link mt-3.5 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-700 hover:text-brand-900">
          {t('Đọc thêm', 'Read more')}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-1" aria-hidden />
        </Link>
      </article>
    );
  }
  const lead = kind === 'LEAD';
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-white shadow-card transition-all duration-200 hover:shadow-lift hover:-translate-y-0.5">
      <Link href={href} tabIndex={-1} aria-hidden className="block overflow-hidden bg-slate-100">
        <Thumb p={p} eager={eager} sizes={lead ? '(min-width: 1024px) 60vw, 100vw' : undefined} className="transition-transform duration-500 group-hover:scale-105" />
      </Link>
      <div className={cn('flex flex-1 flex-col p-5', lead && 'md:p-7')}>
        {cat && (
          <Link href={localePath(locale, categoryHref(cat))} className="self-start">
            <Badge tone="brand">{cat.name}</Badge>
          </Link>
        )}
        <h3 className={cn('mt-3 font-serif font-semibold leading-snug text-ink tracking-tight', lead ? 'text-2xl sm:text-3xl' : 'text-xl')}>
          <Link href={href} className="transition-colors hover:text-brand-700">
            {p.title}
          </Link>
        </h3>
        <p className={cn('mt-2 text-muted leading-relaxed', lead ? 'line-clamp-4 text-base' : 'line-clamp-3 text-sm')}>{p.excerpt}</p>
        <Fallback p={p} t={t} />
        <div className="mt-auto pt-2">
          <Meta p={p} locale={locale} />
        </div>
      </div>
    </article>
  );
}
