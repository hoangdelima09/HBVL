import type { MetadataRoute } from 'next';
import { apiGet } from '@/lib/api';
import { siteOrigin } from '@/lib/i18n';

interface Sitemap {
  posts: { kind: string; slug: string; updatedAt: string }[];
  pages: { path: string; updatedAt: string }[];
  categories: string[];
  provinces: string[];
}

/** Only public, published routes. Drafts, private posts, inboxes and account/admin areas never appear here. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const o = siteOrigin();
  const s = await apiGet<Sitemap>('/seo/sitemap', { notFoundOn404: false }).catch(() => ({ posts: [], pages: [], categories: [], provinces: [] }) as Sitemap);
  const both = (path: string, lastModified?: string): MetadataRoute.Sitemap[number] => ({
    url: `${o}${path}`,
    lastModified: lastModified ? new Date(lastModified) : undefined,
    alternates: { languages: { vi: `${o}${path}`, en: `${o}/en${path === '/' ? '' : path}`, ja: `${o}/ja${path === '/' ? '' : path}` } },
  });
  const postPath = (p: Sitemap['posts'][number]) => (p.kind === 'EVENT' ? `/su-kien/${p.slug}` : p.kind === 'PROGRAM' ? `/chuong-trinh/${p.slug}` : `/bai-viet/${p.slug}`);
  return [
    both('/'),
    both('/thong-bao'),
    both('/lien-he'),
    both('/su-kien'),
    both('/chuong-trinh'),
    ...s.categories.map((c) => both(`/category/${c}`)),
    ...s.posts.map((p) => both(postPath(p), p.updatedAt)),
    ...s.pages.map((p) => both(`/${p.path}`, p.updatedAt)),
    ...s.provinces.map((p) => both(`/tinh/${p}`)),
  ];
}
