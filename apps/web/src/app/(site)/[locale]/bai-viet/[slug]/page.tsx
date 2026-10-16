import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Calendar, Clock, User } from 'lucide-react';
import Image from 'next/image';
import { CommentsSection, LikeButton, ShareButtons } from '@/components/site/engagement';
import { PostCardView, postHref } from '@/components/site/post-card';
import { Alert, Badge } from '@/components/ui/misc';
import { apiGet } from '@/lib/api';
import { formatDate, isLocale, localePath, siteOrigin, tr } from '@/lib/i18n';
import { categoryHref, type PostDetail } from '@/lib/types';

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const p = await apiGet<PostDetail>(`/posts/${slug}?locale=${locale}`);
  const url = `${siteOrigin()}${postHref(locale, p)}`;
  return {
    title: p.title,
    description: p.excerpt,
    alternates: { canonical: url, languages: { vi: `${siteOrigin()}${postHref('vi', p)}`, en: `${siteOrigin()}${postHref('en', p)}` } },
    openGraph: {
      type: 'article',
      title: p.title,
      description: p.excerpt,
      url,
      publishedTime: p.publishedAt ?? undefined,
      modifiedTime: p.updatedAt,
      images: p.featured ? [{ url: `${siteOrigin()}${p.featured.large}` }] : undefined,
    },
    twitter: { card: p.featured ? 'summary_large_image' : 'summary' },
  };
}

export default async function PostPage({ params }: Props) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw;
  const t = tr(locale);
  const p = await apiGet<PostDetail>(`/posts/${slug}?locale=${locale}`);
  const url = `${siteOrigin()}${postHref(locale, p)}`;
  const cat = p.categories[0];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: p.title,
    description: p.excerpt,
    datePublished: p.publishedAt,
    dateModified: p.updatedAt,
    inLanguage: locale,
    mainEntityOfPage: url,
    ...(p.author ? { author: { '@type': 'Person', name: p.author } } : {}),
    publisher: { '@type': 'Organization', name: 'Quỹ Khuyến Học Đông Du' },
    ...(p.featured ? { image: `${siteOrigin()}${p.featured.large}` } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div className="border-b border-line bg-gradient-to-b from-paper to-white/70">
        <div className="mx-auto max-w-[82rem] px-4 py-6 sm:px-6">
          <nav aria-label="Breadcrumb" className="text-xs font-medium text-muted">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href={localePath(locale, '/')} className="hover:text-brand-700 transition-colors">
                  {t('Trang chủ', 'Home')}
                </Link>
              </li>
              {cat && (
                <>
                  <li aria-hidden className="text-slate-300">
                    /
                  </li>
                  <li>
                    <Link href={localePath(locale, categoryHref(cat))} className="hover:text-brand-700 transition-colors">
                      {cat.name}
                    </Link>
                  </li>
                </>
              )}
              <li aria-hidden className="text-slate-300">
                /
              </li>
              <li aria-current="page" className="max-w-[32ch] truncate font-semibold text-ink sm:max-w-none">
                {p.title}
              </li>
            </ol>
          </nav>
        </div>
      </div>
      <div className="mx-auto max-w-[82rem] px-4 py-10 sm:px-6">
        <article className="mx-auto max-w-reading">
          <header className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm text-muted">
              {cat && (
                <Link href={localePath(locale, categoryHref(cat))}>
                  <Badge tone="brand">{cat.name}</Badge>
                </Link>
              )}
              {p.publishedAt && (
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  <time dateTime={p.publishedAt}>{formatDate(locale, p.publishedAt)}</time>
                </span>
              )}
              {p.author && (
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <User className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  {p.author}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                {p.readingMinutes} {t('phút đọc', 'min read')}
              </span>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-[1.18] tracking-tight text-ink">{p.title}</h1>
            {p.translationMissing && (
              <Alert kind="warning" className="mt-4">
                {t('Bài viết này chưa có bản tiếng Anh. Đang hiển thị bản tiếng Việt gốc.', 'This post has no English translation yet. Showing the original Vietnamese.')}
              </Alert>
            )}
          </header>
          {p.featured && (
            <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-slate-100 shadow-lift">
              <Image
                src={p.featured.large}
                alt=""
                width={p.featured.width ?? 1200}
                height={p.featured.height ?? 675}
                priority
                sizes="(min-width: 768px) 46rem, 100vw"
                className="aspect-[16/9] w-full object-cover"
              />
            </div>
          )}
          <div className="prose-hbvl mt-10" dangerouslySetInnerHTML={{ __html: p.contentHtml /* sanitised server-side with an allowlist before storage */ }} />
          {p.tags.length > 0 && (
            <ul className="mt-10 flex flex-wrap gap-2" aria-label={t('Thẻ liên quan', 'Tags')}>
              {p.tags.map((tg) => (
                <li key={tg.slug}>
                  <Badge tone="neutral">#{tg.name}</Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-y border-line py-5">
            <LikeButton postId={p.id} locale={locale} initialLikes={p.likes} />
            <ShareButtons url={url} title={p.title} locale={locale} />
          </div>
          <aside
            aria-label={t('Thông tin tác giả', 'About the author')}
            className="mt-8 rounded-2xl border-l-4 border-brand-600 border-y border-r border-line bg-white p-6 shadow-card"
          >
            <p className="text-[0.72rem] font-bold uppercase tracking-wider text-muted">{t('Tác giả', 'Author')}</p>
            <p className="mt-1 font-serif text-xl font-bold text-ink">{p.author ?? t('Thành viên Đông Du', 'Dong Du member')}</p>
            <p className="mt-1 text-sm text-muted leading-relaxed">
              {t('Thành viên đóng góp nội dung cho Quỹ Khuyến Học Đông Du.', 'Content contributor for the Dong Du Study Encouragement Fund.')}
            </p>
          </aside>
          <nav aria-label={t('Điều hướng bài viết', 'Post navigation')} className="mt-8 grid gap-4 sm:grid-cols-2">
            {p.prev ? (
              <Link
                href={localePath(locale, `/bai-viet/${p.prev.slug}`)}
                className="group rounded-xl border border-line bg-white p-5 shadow-card transition-all hover:border-brand-200 hover:shadow-lift hover:-translate-y-0.5"
              >
                <span className="text-[0.72rem] font-bold uppercase tracking-wider text-muted">← {t('Bài trước', 'Previous')}</span>
                <span className="mt-1.5 block font-serif text-lg font-semibold text-ink group-hover:text-brand-700 transition-colors">{p.prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {p.next && (
              <Link
                href={localePath(locale, `/bai-viet/${p.next.slug}`)}
                className="group rounded-xl border border-line bg-white p-5 text-right shadow-card transition-all hover:border-brand-200 hover:shadow-lift hover:-translate-y-0.5"
              >
                <span className="text-[0.72rem] font-bold uppercase tracking-wider text-muted">{t('Bài tiếp theo', 'Next')} →</span>
                <span className="mt-1.5 block font-serif text-lg font-semibold text-ink group-hover:text-brand-700 transition-colors">{p.next.title}</span>
              </Link>
            )}
          </nav>
          <CommentsSection postId={p.id} locale={locale} open={p.commentsOpen} />
        </article>
        {p.related.length > 0 && (
          <section className="mt-20 border-t border-line/80 pt-12" aria-labelledby="related-title">
            <div className="flex items-center gap-2 mb-6">
              <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden />
              <h2 id="related-title" className="font-serif text-2xl font-bold text-ink">
                {t('Bài viết liên quan', 'Related posts')}
              </h2>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {p.related.map((r) => (
                <PostCardView key={r.id} p={r} locale={locale} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
