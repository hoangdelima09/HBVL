import type { LocaleName } from '@hbvl/contracts';
import { mediaUrl } from '../media/media.service';

type Tr = { locale: string; name: string; navLabel?: string | null; summary?: string | null; description?: string | null };

export function pickTr<T extends { locale: string }>(list: T[] | undefined, locale: LocaleName): T | undefined {
  return list?.find((t) => t.locale === locale) ?? list?.find((t) => t.locale === 'vi');
}

export const categoryDto = (
  c: { id?: string; slug: string; parentId: string | null; cardType: string; translations: Tr[]; parent?: { slug: string } | null },
  locale: LocaleName,
  parentSlug?: string | null,
) => {
  const t = pickTr(c.translations, locale);
  return {
    id: c.id,
    slug: c.slug,
    parentId: c.parentId,
    parentSlug: parentSlug ?? c.parent?.slug ?? null,
    cardType: c.cardType,
    name: t?.name ?? c.slug,
    navLabel: t?.navLabel ?? t?.name ?? c.slug,
    summary: t?.summary ?? null,
    description: t?.description ?? null,
  };
};

export const featuredDto = (a: { id: string; width: number | null; height: number | null } | null) =>
  a ? { id: a.id, width: a.width, height: a.height, thumb: mediaUrl(a.id, 'thumb'), card: mediaUrl(a.id, 'card'), large: mediaUrl(a.id, 'large') } : null;

/** Prisma `select` shared by all public post lists. */
export const cardSelect = (locale: LocaleName) =>
  ({
    id: true,
    kind: true,
    slug: true,
    title: true,
    excerpt: true,
    contentText: true,
    publishedAt: true,
    likeCount: true,
    legacyLikeCount: true,
    originalLocale: true,
    author: { select: { displayName: true } },
    featured: { select: { id: true, width: true, height: true } },
    categories: {
      select: { isPrimary: true, category: { select: { id: true, slug: true, parentId: true, cardType: true, translations: true, parent: { select: { slug: true } } } } },
    },
    translations: { where: { locale }, select: { locale: true, title: true, excerpt: true, contentText: true } },
    _count: { select: { comments: { where: { status: 'APPROVED' as const } } } },
  }) as const;

type CardRow = {
  id: string;
  kind: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentText: string;
  publishedAt: Date | null;
  likeCount: number;
  legacyLikeCount: number;
  originalLocale: string;
  author: { displayName: string } | null;
  featured: { id: string; width: number | null; height: number | null } | null;
  categories: { isPrimary: boolean; category: { id?: string; slug: string; parentId: string | null; cardType: string; translations: Tr[]; parent?: { slug: string } | null } }[];
  translations: { locale: string; title: string; excerpt: string | null; contentText: string }[];
  _count: { comments: number };
};

const snippet = (text: string, max = 220) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

export function cardDto(p: CardRow, locale: LocaleName) {
  const tr = locale !== 'vi' ? p.translations.find((t) => t.locale === locale) : undefined;
  const primary = p.categories.find((c) => c.isPrimary) ?? p.categories[0];
  return {
    id: p.id,
    kind: p.kind,
    slug: p.slug,
    title: tr?.title ?? p.title,
    excerpt: tr?.excerpt ?? p.excerpt ?? snippet(tr?.contentText ?? p.contentText),
    publishedAt: p.publishedAt,
    author: p.author?.displayName ?? null,
    category: primary ? categoryDto(primary.category, locale) : null,
    featured: featuredDto(p.featured),
    likes: p.likeCount + p.legacyLikeCount,
    comments: p._count.comments,
    /** true when the requested locale has no translation and the Vietnamese original is shown. */
    translationMissing: locale !== 'vi' && !tr,
  };
}
