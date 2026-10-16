import { Injectable } from '@nestjs/common';
import { foldVietnamese, type LocaleName } from '@hbvl/contracts';
import { Prisma, PrismaClient } from '@hbvl/database';
import { CacheService } from '../cache/cache.service';
import { E } from '../common/errors';
import { cardDto, cardSelect, categoryDto } from './posts.mapper';

const published = (): Prisma.PostWhereInput => ({ status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: new Date() } });

export interface ListParams {
  locale: LocaleName;
  page: number;
  pageSize: number;
  category?: string;
  kind?: 'POST' | 'EVENT' | 'PROGRAM';
  excludeIds?: string[];
}

@Injectable()
export class PostsPublicService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: CacheService,
  ) {}

  async categoryTree(locale: LocaleName) {
    return this.cache.wrap(`categories:${locale}`, 300, async () => {
      const rows = await this.prisma.category.findMany({ include: { translations: true }, orderBy: [{ sortOrder: 'asc' }] });
      const roots = rows.filter((c) => !c.parentId);
      return roots.map((r) => ({ ...categoryDto(r, locale), children: rows.filter((c) => c.parentId === r.id).map((c) => categoryDto(c, locale, r.slug)) }));
    });
  }

  /** Category slug → ids of the category and its descendants (a pillar page lists its sub-sections' posts too). */
  private async categoryIds(slug: string): Promise<string[] | null> {
    const c = await this.prisma.category.findUnique({ where: { slug }, select: { id: true, children: { select: { id: true } } } });
    return c ? [c.id, ...c.children.map((x) => x.id)] : null;
  }

  async list(p: ListParams) {
    const key = `list:${p.locale}:${p.kind ?? 'POST'}:${p.category ?? '-'}:${p.page}:${p.pageSize}:${(p.excludeIds ?? []).join(',')}`;
    return this.cache.wrap(key, 60, async () => {
      const where: Prisma.PostWhereInput = { ...published(), kind: p.kind ?? 'POST' };
      if (p.category) {
        const ids = await this.categoryIds(p.category);
        if (!ids) throw E.notFound('Chuyên mục không tồn tại.');
        where.categories = { some: { categoryId: { in: ids } } };
      }
      if (p.excludeIds?.length) where.id = { notIn: p.excludeIds };
      const [total, rows] = await Promise.all([
        this.prisma.post.count({ where }),
        this.prisma.post.findMany({
          where,
          select: cardSelect(p.locale),
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], // id tie-breaker ⇒ stable pagination
          skip: (p.page - 1) * p.pageSize,
          take: p.pageSize,
        }),
      ]);
      return { items: rows.map((r) => cardDto(r, p.locale)), page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
    });
  }

  async featured(locale: LocaleName, limit = 5) {
    return this.cache.wrap(`featured:${locale}:${limit}`, 60, async () => {
      const rows = await this.prisma.post.findMany({
        where: { ...published(), kind: 'POST' },
        select: cardSelect(locale),
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return { items: rows.map((r) => cardDto(r, locale)) };
    });
  }

  /** Homepage "Cập nhật mới nhất": up to 3 newest posts per pillar, excluding the featured ones (legacy `front-page.php`). */
  async homeBlocks(locale: LocaleName, excludeIds: string[]) {
    return this.cache.wrap(`homeblocks:${locale}:${excludeIds.join(',')}`, 60, async () => {
      const groups = await this.prisma.category.findMany({
        where: { parentId: null },
        include: { translations: true, children: { select: { id: true } } },
        orderBy: { sortOrder: 'asc' },
      });
      const blocks = await Promise.all(
        groups.map(async (g) => {
          const rows = await this.prisma.post.findMany({
            where: { ...published(), kind: 'POST', id: { notIn: excludeIds }, categories: { some: { categoryId: { in: [g.id, ...g.children.map((c) => c.id)] } } } },
            select: cardSelect(locale),
            orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
            take: 3,
          });
          return { category: categoryDto(g, locale), items: rows.map((r) => cardDto(r, locale)) };
        }),
      );
      return { blocks: blocks.filter((b) => b.items.length > 0).slice(0, 5) };
    });
  }

  async bySlug(kind: 'POST' | 'EVENT' | 'PROGRAM', slug: string, locale: LocaleName) {
    return this.cache.wrap(`post:${kind}:${locale}:${slug}`, 60, async () => {
      const post = await this.prisma.post.findFirst({
        where: { ...published(), kind, slug },
        select: {
          ...cardSelect(locale),
          contentHtml: true,
          commentsOpen: true,
          originalLocale: true,
          updatedAt: true,
          tags: { select: { tag: { select: { slug: true, name: true } } } },
          translations: { where: { locale }, select: { locale: true, title: true, excerpt: true, contentText: true, contentHtml: true } },
          eventDetail: true,
          programDetail: true,
        },
      });
      if (!post) throw E.notFound('Không tìm thấy bài viết.');
      const tr = locale !== 'vi' ? post.translations.find((t) => t.locale === locale) : undefined;
      const base = cardDto(post, locale);
      const cats = post.categories.map((c) => categoryDto(c.category, locale));
      const [prev, next, related] = await Promise.all([
        this.neighbour(post.publishedAt!, post.id, kind, 'prev', locale),
        this.neighbour(post.publishedAt!, post.id, kind, 'next', locale),
        this.related(
          post.id,
          post.categories.map((c) => c.category.slug),
          kind,
          locale,
        ),
      ]);
      return {
        ...base,
        contentHtml: tr?.contentHtml ?? post.contentHtml,
        categories: cats,
        tags: post.tags.map((t) => t.tag),
        commentsOpen: post.commentsOpen,
        updatedAt: post.updatedAt,
        readingMinutes: Math.max(1, Math.ceil((tr?.contentText ?? post.contentText).split(/\s+/).filter(Boolean).length / 200)),
        event: post.eventDetail,
        program: post.programDetail,
        prev,
        next,
        related,
      };
    });
  }

  private async neighbour(at: Date, id: string, kind: 'POST' | 'EVENT' | 'PROGRAM', dir: 'prev' | 'next', locale: LocaleName) {
    const older = dir === 'prev';
    const row = await this.prisma.post.findFirst({
      where: {
        ...published(),
        kind,
        OR: older ? [{ publishedAt: { lt: at } }, { publishedAt: at, id: { lt: id } }] : [{ publishedAt: { gt: at } }, { publishedAt: at, id: { gt: id } }],
      },
      select: { slug: true, title: true, translations: { where: { locale }, select: { title: true } } },
      orderBy: older ? [{ publishedAt: 'desc' }, { id: 'desc' }] : [{ publishedAt: 'asc' }, { id: 'asc' }],
    });
    return row ? { slug: row.slug, title: row.translations[0]?.title ?? row.title } : null;
  }

  private async related(id: string, categorySlugs: string[], kind: 'POST' | 'EVENT' | 'PROGRAM', locale: LocaleName) {
    if (!categorySlugs.length) return [];
    const rows = await this.prisma.post.findMany({
      where: { ...published(), kind, id: { not: id }, categories: { some: { category: { slug: { in: categorySlugs } } } } },
      select: cardSelect(locale),
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
    return rows.map((r) => cardDto(r, locale));
  }

  /** Diacritic-insensitive search over PUBLISHED content only. Tokens are folded to [a-z0-9] so LIKE patterns need no escaping. */
  async search(q: string, locale: LocaleName, page: number, pageSize: number) {
    const tokens = foldVietnamese(q)
      .split(' ')
      .filter((t) => t.length >= 1)
      .slice(0, 6);
    if (!tokens.length || tokens.join('').length < 2) return { items: [], page, pageSize, total: 0, totalPages: 1, query: q };
    return this.cache.wrap(`search:${locale}:${tokens.join('+')}:${page}:${pageSize}`, 30, async () => {
      const like = (col: string) =>
        Prisma.join(
          tokens.map((t) => Prisma.sql`${Prisma.raw(col)} LIKE ${'%' + t + '%'}`),
          ' AND ',
        );
      const postMatch = Prisma.sql`p.status = 'PUBLISHED' AND p."deletedAt" IS NULL AND p."publishedAt" <= now() AND ((${like('p."searchText"')}) OR EXISTS (SELECT 1 FROM post_translations t WHERE t."postId" = p.id AND t.locale = ${locale}::"Locale" AND ${like('t."searchText"')}))`;
      const pageMatch = Prisma.sql`g.status = 'PUBLISHED' AND g."deletedAt" IS NULL AND ${like('g."searchText"')}`;
      const totalRows = await this.prisma.$queryRaw<
        { n: bigint }[]
      >`SELECT (SELECT count(*) FROM posts p WHERE ${postMatch}) + (SELECT count(*) FROM pages g WHERE ${pageMatch}) AS n`;
      const total = Number(totalRows[0]?.n ?? 0);
      const offset = (page - 1) * pageSize;
      const rows = await this.prisma.$queryRaw<{ type: string; id: string; slug: string; kind: string | null; title: string; text: string; at: Date | null }[]>`
        SELECT * FROM (
          SELECT 'post' AS type, p.id, p.slug, p.kind::text AS kind, p.title, left(p."contentText", 400) AS text, p."publishedAt" AS at FROM posts p WHERE ${postMatch}
          UNION ALL
          SELECT 'page' AS type, g.id, g.slug, NULL AS kind, g.title, left(g."contentText", 400) AS text, g."publishedAt" AS at FROM pages g WHERE ${pageMatch}
        ) r ORDER BY at DESC NULLS LAST, id DESC LIMIT ${pageSize} OFFSET ${offset}`;
      const paths = await this.pagePaths();
      return {
        items: rows.map((r) => ({
          type: r.type,
          id: r.id,
          slug: r.slug,
          kind: r.kind,
          path: r.type === 'page' ? (paths.get(r.id) ?? r.slug) : null,
          title: r.title,
          snippet: r.text.length > 200 ? `${r.text.slice(0, 200).trimEnd()}…` : r.text,
          publishedAt: r.at,
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        query: q,
      };
    });
  }

  /**
   * Context retrieval for the site assistant: PUBLISHED posts/events/programs/pages only, ranked by how many of the (already folded, [a-z0-9]) tokens they contain.
   * Unlike `search` this is OR-based, because a natural-language question rarely has every word in one article.
   */
  async retrieveForChat(tokens: string[], limit: number, textChars: number) {
    if (!tokens.length) return [];
    // Whole-word match on the folded, space-separated searchText; at least half of the topic tokens must hit, so one common word ("gia") cannot drag in unrelated articles.
    const score = (col: string) =>
      Prisma.join(
        tokens.map((t) => Prisma.sql`(CASE WHEN (' ' || ${Prisma.raw(col)} || ' ') LIKE ${'% ' + t + ' %'} THEN 1 ELSE 0 END)`),
        ' + ',
      );
    const minScore = tokens.length >= 2 ? Math.ceil(tokens.length / 2) : 1;
    const rows = await this.prisma.$queryRaw<{ type: string; id: string; slug: string; kind: string | null; title: string; text: string; score: number }[]>`
      SELECT * FROM (
        SELECT 'post' AS type, p.id, p.slug, p.kind::text AS kind, p.title, left(p."contentText", ${textChars}::int) AS text, (${score('p."searchText"')}) AS score, p."publishedAt" AS at
          FROM posts p WHERE p.status = 'PUBLISHED' AND p."deletedAt" IS NULL AND p."publishedAt" <= now()
        UNION ALL
        SELECT 'page' AS type, g.id, g.slug, NULL AS kind, g.title, left(g."contentText", ${textChars}::int) AS text, (${score('g."searchText"')}) AS score, g."publishedAt" AS at
          FROM pages g WHERE g.status = 'PUBLISHED' AND g."deletedAt" IS NULL
      ) r WHERE r.score >= ${minScore}::int ORDER BY r.score DESC, r.at DESC NULLS LAST, r.id DESC LIMIT ${limit}`;
    const paths = await this.pagePaths();
    return rows.map((r) => ({
      title: r.title,
      text: r.text,
      score: Number(r.score),
      path:
        r.type === 'page' ? `/${paths.get(r.id) ?? r.slug}` : r.kind === 'EVENT' ? `/su-kien/${r.slug}` : r.kind === 'PROGRAM' ? `/chuong-trinh/${r.slug}` : `/bai-viet/${r.slug}`,
    }));
  }

  /**
   * What is on the site right now, for the assistant: the latest published posts/events/programs (title, section, date, a short lead) and
   * per-kind totals. Read through the public cache, which every publish/unpublish/edit invalidates, so the assistant knows new content at once.
   */
  async chatDigest() {
    return this.cache.wrap('chat:digest', 60, async () => {
      const rows = await this.prisma.$queryRaw<
        { id: string; kind: string; slug: string; title: string; lead: string; at: Date | null; section: string | null; startsAt: Date | null; place: string | null }[]
      >`
        SELECT p.id, p.kind::text AS kind, p.slug, p.title, left(coalesce(nullif(p.excerpt, ''), p."contentText"), 220) AS lead, p."publishedAt" AS at,
               (SELECT t.name FROM post_categories pc JOIN category_translations t ON t."categoryId" = pc."categoryId" AND t.locale = 'vi'
                 WHERE pc."postId" = p.id ORDER BY pc."isPrimary" DESC LIMIT 1) AS section,
               e."startsAt", e."locationText" AS place
          FROM posts p LEFT JOIN event_details e ON e."postId" = p.id
         WHERE p.status = 'PUBLISHED' AND p."deletedAt" IS NULL AND p."publishedAt" <= now()
         ORDER BY p."publishedAt" DESC, p.id DESC
         LIMIT 30`;
      const counts = await this.prisma.post.groupBy({ by: ['kind'], where: published(), _count: { _all: true } });
      const path = (r: { kind: string; slug: string }) => (r.kind === 'EVENT' ? `/su-kien/${r.slug}` : r.kind === 'PROGRAM' ? `/chuong-trinh/${r.slug}` : `/bai-viet/${r.slug}`);
      return {
        items: rows.map((r) => ({
          kind: r.kind,
          title: r.title,
          path: path(r),
          section: r.section,
          at: r.at,
          lead: r.lead.replace(/\s+/g, ' ').trim(),
          startsAt: r.startsAt,
          place: r.place,
        })),
        totals: Object.fromEntries(counts.map((c) => [c.kind, c._count._all])) as Partial<Record<'POST' | 'EVENT' | 'PROGRAM', number>>,
      };
    });
  }

  /** id → full path (`parent/child`) for published pages; pages are few, so one cached lookup beats a recursive query per search. */
  private async pagePaths(): Promise<Map<string, string>> {
    const rows = await this.cache.wrap('page-paths', 300, () =>
      this.prisma.page.findMany({ where: { status: 'PUBLISHED', deletedAt: null }, select: { id: true, slug: true, parentId: true } }),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const path = (id: string, depth = 0): string => {
      const r = byId.get(id);
      if (!r) return '';
      return r.parentId && depth < 8 ? `${path(r.parentId, depth + 1)}/${r.slug}`.replace(/^\//, '') : r.slug;
    };
    return new Map(rows.map((r) => [r.id, path(r.id)]));
  }

  async engagement(postId: string, userId?: string) {
    const post = await this.prisma.post.findFirst({ where: { id: postId, ...published() }, select: { likeCount: true, legacyLikeCount: true, commentsOpen: true } });
    if (!post) throw E.notFound();
    const liked = userId ? !!(await this.prisma.postLike.findUnique({ where: { userId_postId: { userId, postId } }, select: { userId: true } })) : false;
    return { likes: post.likeCount + post.legacyLikeCount, likedByMe: liked, commentsOpen: post.commentsOpen };
  }
}
