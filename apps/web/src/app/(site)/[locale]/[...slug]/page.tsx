import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { apiGet, apiTry, ApiFailure } from '@/lib/api';
import { isLocale, localePath, siteOrigin, tr, type Locale } from '@/lib/i18n';
import { Alert } from '@/components/ui/misc';

interface PageData {
  id: string;
  title: string;
  contentHtml: string;
  translationMissing: boolean;
  needsReview: boolean;
  path: string;
  children: { slug: string; title: string; path: string }[];
}
type Props = { params: Promise<{ locale: string; slug: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

async function load(locale: Locale, slug: string[], search: Record<string, string | undefined>): Promise<PageData> {
  const path = slug.map(encodeURIComponent).join('/');
  try {
    return await apiGet<PageData>(`/pages/by-path?path=${path}&locale=${locale}`, { notFoundOn404: false });
  } catch (e) {
    if (!(e instanceof ApiFailure) || e.status !== 404) throw e;
  }
  // Not a page: maybe a legacy URL that the migration mapped (real data only — never "everything to home").
  const qs = Object.entries(search)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const hit = await apiTry<{ to: string; status: number }>(`/redirects/resolve?path=${encodeURIComponent('/' + slug.join('/'))}&query=${encodeURIComponent(qs)}`);
  if (hit && hit.to.startsWith('/') && !hit.to.startsWith('//')) {
    const to = locale !== 'vi' && !hit.to.startsWith(`/${locale}`) ? localePath(locale, hit.to) : hit.to;
    if (hit.status === 301 || hit.status === 308) permanentRedirect(to);
    redirect(to);
  }
  notFound();
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  try {
    const p = await load(locale, slug, await searchParams);
    return { title: p.title, alternates: { canonical: `${siteOrigin()}${localePath(locale, `/${p.path}`)}` } };
  } catch {
    return { title: '404' };
  }
}

export default async function StaticPage({ params, searchParams }: Props) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw;
  const t = tr(locale);
  const p = await load(locale, slug, await searchParams);
  return (
    <div className="mx-auto max-w-[82rem] px-4 py-12 sm:px-6">
      <article className="mx-auto max-w-reading">
        <h1 className="font-serif text-4xl font-semibold sm:text-5xl">{p.title}</h1>
        {p.translationMissing && (
          <Alert kind="warning" className="mt-4">
            {t('Chưa có bản tiếng Anh. Đang hiển thị bản tiếng Việt gốc.', 'No English translation yet. Showing the Vietnamese original.')}
          </Alert>
        )}
        <div className="prose-hbvl mt-8" dangerouslySetInnerHTML={{ __html: p.contentHtml }} />
        {p.children.length > 0 && (
          <ul className="mt-10 space-y-1 border-t border-line pt-6">
            {p.children.map((c) => (
              <li key={c.slug}>
                <a className="font-semibold text-brand-700 hover:underline" href={localePath(locale, `/${c.path}`)}>
                  {c.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
