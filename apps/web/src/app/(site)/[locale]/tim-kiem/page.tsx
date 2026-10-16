import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, Pagination } from '@/components/ui/misc';
import { apiGet } from '@/lib/api';
import { formatDate, isLocale, localePath, tr, type Locale } from '@/lib/i18n';
import { pageHref } from '@/lib/utils';

interface Hit {
  type: 'post' | 'page';
  id: string;
  slug: string;
  kind: string | null;
  path: string | null;
  title: string;
  snippet: string;
  publishedAt: string | null;
}
interface Results {
  items: Hit[];
  page: number;
  total: number;
  totalPages: number;
  query: string;
}
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; page?: string }> };

export const metadata: Metadata = { title: 'Tìm kiếm', robots: { index: false, follow: true } };

const hitHref = (locale: Locale, h: Hit) =>
  localePath(
    locale,
    h.type === 'page' ? `/${h.path ?? h.slug}` : h.kind === 'EVENT' ? `/su-kien/${h.slug}` : h.kind === 'PROGRAM' ? `/chuong-trinh/${h.slug}` : `/bai-viet/${h.slug}`,
  );

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw;
  const t = tr(locale);
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const data = q ? await apiGet<Results>(`/search?q=${encodeURIComponent(q)}&locale=${locale}&page=${page}&pageSize=10`) : null;
  const base = localePath(locale, '/tim-kiem');
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl font-semibold">{t('Kết quả tìm kiếm', 'Search results')}</h1>
      <p className="mt-2 text-ink-2">
        {q ? (
          <>
            {t('Từ khóa', 'Keyword')}: “{q}”
          </>
        ) : (
          t('Nhập từ khóa để tìm bài viết, hoạt động và câu chuyện trong website.', 'Enter a keyword to find stories, activities, and updates across the site.')
        )}
      </p>
      <form role="search" action={base} method="get" className="mt-6 flex gap-2">
        <label htmlFor="search-page-field" className="sr-only">
          {t('Từ khóa tìm kiếm', 'Search keyword')}
        </label>
        <input
          id="search-page-field"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={100}
          placeholder={t('Bạn muốn tìm gì?', 'What are you looking for?')}
          className="h-12 min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-5 placeholder:text-slate-500"
        />
        <Button type="submit" size="lg" className="shrink-0 px-5 sm:px-8">
          <Search className="h-4 w-4" aria-hidden />
          {t('Tìm kiếm', 'Search')}
        </Button>
      </form>
      {data &&
        (data.items.length === 0 ? (
          <div className="mt-8">
            <EmptyState title={t('Chưa tìm thấy nội dung phù hợp.', 'No matching content found.')}>
              {t(
                'Thử tìm với từ khóa ngắn hơn. Tìm kiếm không phân biệt dấu (ví dụ “dong thap” = “Đồng Tháp”).',
                'Try a shorter keyword. Search ignores diacritics (e.g. “dong thap” matches “Đồng Tháp”).',
              )}
            </EmptyState>
          </div>
        ) : (
          <>
            <p className="mt-8 text-sm font-semibold text-muted" aria-live="polite">
              {t(`Tìm thấy ${data.total} kết quả`, `Found ${data.total} results`, `${data.total}件の結果が見つかりました`)}
            </p>
            <ol className="mt-4 space-y-4">
              {data.items.map((h) => (
                <li key={`${h.type}-${h.id}`} className="rounded-lg border border-line bg-white p-5 shadow-card">
                  <h2 className="font-serif text-xl font-semibold">
                    <Link href={hitHref(locale, h)} className="text-brand-700 hover:underline">
                      {h.title}
                    </Link>
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {h.type === 'page' ? t('Trang', 'Page') : t('Bài viết', 'Post')}
                    {h.publishedAt ? ` · ${formatDate(locale, h.publishedAt)}` : ''}
                  </p>
                  {h.snippet && <p className="mt-2 text-ink-2">{h.snippet}</p>}
                </li>
              ))}
            </ol>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              hrefFor={(n) => pageHref(base, { q }, n)}
              labels={{ prev: t('Trước', 'Previous'), next: t('Tiếp', 'Next'), nav: t('Phân trang', 'Pagination'), page: t('Trang', 'Page') }}
            />
          </>
        ))}
    </div>
  );
}
