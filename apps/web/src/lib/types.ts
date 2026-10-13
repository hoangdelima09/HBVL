/** Shapes returned by the public API (kept narrow on purpose; the OpenAPI document is the full contract). */
export interface Featured {
  id: string;
  width: number | null;
  height: number | null;
  thumb: string;
  card: string;
  large: string;
}
export interface CategoryLite {
  id: string;
  slug: string;
  parentId: string | null;
  parentSlug: string | null;
  cardType: 'CARD' | 'PROFILE' | 'SONG' | 'TIP';
  name: string;
  navLabel: string;
  summary: string | null;
  description: string | null;
}
export interface PostCard {
  id: string;
  kind: string;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  author: string | null;
  category: CategoryLite | null;
  featured: Featured | null;
  likes: number;
  comments: number;
  translationMissing: boolean;
}
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface CategoryNode extends CategoryLite {
  children: CategoryLite[];
}
export interface PostDetail extends PostCard {
  contentHtml: string;
  categories: CategoryLite[];
  tags: { slug: string; name: string }[];
  commentsOpen: boolean;
  updatedAt: string;
  readingMinutes: number;
  event: { startsAt: string | null; endsAt: string | null; locationText: string | null } | null;
  program: { openFrom: string | null; openUntil: string | null; applyUrl: string | null } | null;
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
  related: PostCard[];
}
export interface Settings {
  brand: Record<string, string>;
  contact: { addressVi: string; addressEn: string; phone: string; phoneNoteVi?: string; phoneNoteEn?: string; email: string; hoursVi: string[]; hoursEn: string[]; mapUrl: string };
  home: {
    hero: {
      badgeVi: string;
      badgeEn: string;
      titleLeadVi: string;
      titleHighlightVi: string;
      titleLeadEn: string;
      titleHighlightEn: string;
      descVi: string;
      descEn: string;
      stats: { key: string; value: string; labelVi: string; labelEn: string }[];
    };
    mission: {
      labelVi: string;
      labelEn: string;
      titleVi: string;
      titleEn: string;
      descVi: string;
      descEn: string;
      cards: { icon: string; titleVi: string; titleEn: string; descVi: string; descEn: string }[];
    };
    mapFeature: { labelVi: string; labelEn: string; titleVi: string; titleEn: string; descVi: string; descEn: string };
  };
  social: { facebook: string | null; youtube: string | null; tiktok: string | null };
}
export interface MapProvince {
  slug: string;
  nameVi: string;
  nameEn: string;
  kind: string;
  count: number;
  constituents?: { slug: string; nameVi: string; nameEn: string; count: number }[];
}
export interface MapSummary {
  system: '34' | '63';
  totals: { members: number; units: number; unitsWithMembers: number };
  provinces: MapProvince[];
  geometryVersion: string;
}

export const categoryHref = (c: { slug: string; parentSlug?: string | null }) => (c.parentSlug ? `/category/${c.parentSlug}/${c.slug}` : `/category/${c.slug}`);
