import { Injectable } from '@nestjs/common';
import { type LocaleName } from '@hbvl/contracts';
import { Prisma, PrismaClient } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { CacheService } from '../cache/cache.service';
import { E } from '../common/errors';

/** Only these keys are editable/served; nothing else from the old wp_options ever reaches this table. */
export const SETTING_KEYS = ['brand', 'contact', 'home', 'social'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

@Injectable()
export class SiteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  async publicSettings() {
    return this.cache.wrap('settings', 300, async () => {
      const rows = await this.prisma.siteSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    });
  }

  async setSetting(a: AuthContext, key: SettingKey, value: Prisma.InputJsonValue) {
    if (JSON.stringify(value).length > 40_000) throw E.validation([{ path: 'value', message: 'Giá trị quá lớn.' }]);
    await this.prisma.$transaction(async (tx) => {
      await tx.siteSetting.upsert({ where: { key }, update: { value, updatedById: a.user.id }, create: { key, value, updatedById: a.user.id } });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'settings.update', resourceType: 'setting', resourceId: key }, tx);
    });
    await this.cache.invalidatePublic();
    return { key };
  }

  // ───── pages ─────
  async pageByPath(path: string, locale: LocaleName) {
    const segments = path.split('/').filter(Boolean);
    if (!segments.length || segments.length > 6) throw E.notFound();
    return this.cache.wrap(`page:${locale}:${segments.join('/')}`, 120, async () => {
      let parentId: string | null = null;
      let page: Awaited<ReturnType<typeof this.loadPage>> = null;
      for (const slug of segments) {
        page = await this.loadPage(parentId, slug, locale);
        if (!page) throw E.notFound('Không tìm thấy trang.');
        parentId = page.id;
      }
      const p = page!;
      const tr = locale !== 'vi' ? p.translations[0] : undefined;
      return {
        id: p.id,
        slug: p.slug,
        template: p.template,
        title: tr?.title ?? p.title,
        contentHtml: tr?.contentHtml ?? p.contentHtml,
        publishedAt: p.publishedAt,
        updatedAt: p.updatedAt,
        translationMissing: locale !== 'vi' && !tr,
        needsReview: p.needsReview,
        path: segments.join('/'),
        children: p.children.map((c) => ({ slug: c.slug, title: c.title, path: `${segments.join('/')}/${c.slug}` })),
      };
    });
  }

  private loadPage(parentId: string | null, slug: string, locale: LocaleName) {
    return this.prisma.page.findFirst({
      where: { parentId, slug, status: 'PUBLISHED', deletedAt: null },
      include: {
        translations: { where: { locale } },
        children: { where: { status: 'PUBLISHED', deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }], select: { slug: true, title: true } },
      },
    });
  }

  // ───── sitemap + redirects ─────
  async sitemap() {
    return this.cache.wrap('sitemap', 600, async () => {
      const [posts, pages, cats, provinces] = await Promise.all([
        this.prisma.post.findMany({
          where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: new Date() } },
          select: { kind: true, slug: true, updatedAt: true },
          orderBy: { publishedAt: 'desc' },
          take: 5000,
        }),
        this.prisma.page.findMany({ where: { status: 'PUBLISHED', deletedAt: null }, select: { id: true, slug: true, parentId: true, updatedAt: true } }),
        this.prisma.category.findMany({ select: { slug: true, parent: { select: { slug: true } } } }),
        this.prisma.province.findMany({ where: { system: 'LEGACY_63' }, select: { slug: true } }),
      ]);
      const byId = new Map(pages.map((p) => [p.id, p]));
      const pagePath = (p: (typeof pages)[number]): string => (p.parentId && byId.get(p.parentId) ? `${pagePath(byId.get(p.parentId)!)}/${p.slug}` : p.slug);
      return {
        posts: posts.map((p) => ({ kind: p.kind, slug: p.slug, updatedAt: p.updatedAt })),
        pages: pages.map((p) => ({ path: pagePath(p), updatedAt: p.updatedAt })),
        categories: cats.map((c) => (c.parent ? `${c.parent.slug}/${c.slug}` : c.slug)),
        provinces: provinces.map((p) => p.slug),
      };
    });
  }

  async resolveRedirect(path: string, queryString: string) {
    const norm = normalizePath(path);
    const q = queryString.replace(/^\?/, '');
    const row =
      (q ? await this.prisma.redirect.findFirst({ where: { fromPath: norm, fromQuery: q } }) : null) ??
      (await this.prisma.redirect.findFirst({ where: { fromPath: norm, fromQuery: null } }));
    if (!row) throw E.notFound();
    return { to: row.toPath, status: row.statusCode };
  }

  // ───── redirects admin ─────
  listRedirects(page: number, pageSize: number) {
    return this.prisma
      .$transaction([
        this.prisma.redirect.count(),
        this.prisma.redirect.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      ])
      .then(([total, items]) => ({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }));
  }

  async createRedirect(a: AuthContext, input: { fromPath: string; fromQuery?: string; toPath: string; statusCode: number }) {
    const fromPath = normalizePath(input.fromPath);
    const toPath = normalizePath(input.toPath, true);
    if (fromPath === toPath) throw E.validation([{ path: 'toPath', message: 'Đích trùng nguồn (vòng lặp).' }]);
    // loop detection: following the chain from `toPath` must never come back to `fromPath`
    let cur = toPath;
    for (let i = 0; i < 10; i++) {
      const next = await this.prisma.redirect.findFirst({ where: { fromPath: cur, fromQuery: null }, select: { toPath: true } });
      if (!next) break;
      if (next.toPath === fromPath) throw E.validation([{ path: 'toPath', message: 'Chuyển hướng tạo thành vòng lặp.' }]);
      cur = next.toPath;
    }
    const r = await this.prisma.redirect.create({ data: { fromPath, fromQuery: input.fromQuery ?? null, toPath, statusCode: input.statusCode, source: 'ADMIN' } });
    await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'redirect.create', resourceType: 'redirect', resourceId: r.id });
    return r;
  }

  async deleteRedirect(a: AuthContext, id: string) {
    await this.prisma.redirect.delete({ where: { id } });
    await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'redirect.delete', resourceType: 'redirect', resourceId: id });
  }

  // ───── notifications ─────
  async notifications(userId: string) {
    const [unread, items] = await Promise.all([
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 30,
        select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
      }),
    ]);
    return { unread, items };
  }

  async markOneRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  }

  async markRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }
}

/** Canonical form: leading slash, no trailing slash (except root), no query/hash, internal paths only. */
export function normalizePath(input: string, requireInternal = false): string {
  let p = input.trim();
  const q = p.search(/[?#]/);
  if (q >= 0) p = p.slice(0, q);
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\') || /[\u0000-\u001f]/.test(p)) {
    if (requireInternal) throw E.validation([{ path: 'path', message: 'Chỉ chấp nhận đường dẫn nội bộ.' }]);
    p = '/' + p.replace(/^\/+/, '');
  }
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}
