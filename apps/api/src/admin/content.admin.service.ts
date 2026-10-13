import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isReservedTopLevelPath, slugify, type LocaleName } from '@hbvl/contracts';
import { Prisma, PrismaClient, type PostKind, type PostStatus } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { CacheService } from '../cache/cache.service';
import { E } from '../common/errors';
import { buildSearchText, sanitizeRichText } from '../content/sanitize';

type Tx = Prisma.TransactionClient;
type AdminContentStatus = 'DRAFT' | 'PUBLISHED' | 'PRIVATE';

export interface ContentInput {
  title: string;
  slug?: string;
  excerpt?: string | null;
  contentHtml: string;
  featuredAssetId?: string | null;
  status: AdminContentStatus;
  event?: { startsAt?: Date | null; endsAt?: Date | null; locationText?: string | null };
  program?: { openFrom?: Date | null; openUntil?: Date | null; applyUrl?: string | null };
}

@Injectable()
export class ContentAdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  private async uniqueSlug(tx: Tx, kind: PostKind, wanted: string, ownId?: string) {
    const base = slugify(wanted) || kind.toLowerCase();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('post-slug'))`;
    const taken = new Set(
      (await tx.post.findMany({ where: { kind, slug: { startsWith: base }, ...(ownId ? { id: { not: ownId } } : {}) }, select: { slug: true } })).map((x) => x.slug),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; i < 5000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

  async list(kind: 'EVENT' | 'PROGRAM', page: number, pageSize: number) {
    const where: Prisma.PostWhereInput = { kind, deletedAt: null };
    const [total, items] = await Promise.all([
      this.prisma.post.count({ where }),
      this.prisma.post.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, slug: true, title: true, status: true, version: true, publishedAt: true, updatedAt: true, eventDetail: true, programDetail: true },
      }),
    ]);
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async get(id: string) {
    const p = await this.prisma.post.findFirst({
      where: { id, kind: { in: ['EVENT', 'PROGRAM'] }, deletedAt: null },
      include: { eventDetail: true, programDetail: true, translations: true },
    });
    if (!p) throw E.notFound();
    return p;
  }

  async create(a: AuthContext, kind: 'EVENT' | 'PROGRAM', input: ContentInput) {
    const s = sanitizeRichText(input.contentHtml);
    const out = await this.prisma.$transaction(async (tx) => {
      const slug = await this.uniqueSlug(tx, kind, input.slug || input.title);
      const p = await tx.post.create({
        data: {
          kind,
          slug,
          authorId: a.user.id,
          status: input.status as PostStatus,
          title: input.title,
          excerpt: input.excerpt ?? null,
          contentHtml: s.html,
          contentText: s.text,
          searchText: buildSearchText(input.title, s.text),
          featuredAssetId: input.featuredAssetId ?? null,
          publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
          origin: 'SITE',
          ...(kind === 'EVENT' ? { eventDetail: { create: input.event ?? {} } } : { programDetail: { create: input.program ?? {} } }),
        },
      });
      if (input.featuredAssetId)
        await tx.mediaAsset.updateMany({
          where: { id: input.featuredAssetId },
          data: { status: 'ACTIVE', attachedAt: new Date(), ...(input.status === 'PUBLISHED' ? { visibility: 'PUBLIC' as const } : {}) },
        });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: `${kind.toLowerCase()}.create`, resourceType: kind.toLowerCase(), resourceId: p.id }, tx);
      return p;
    });
    await this.cache.invalidatePublic();
    return out;
  }

  async update(a: AuthContext, id: string, expectedVersion: number, input: Partial<ContentInput>) {
    const out = await this.prisma.$transaction(async (tx) => {
      const cur = await tx.post.findFirst({ where: { id, kind: { in: ['EVENT', 'PROGRAM'] }, deletedAt: null } });
      if (!cur) throw E.notFound();
      const data: Prisma.PostUncheckedUpdateManyInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.excerpt !== undefined) data.excerpt = input.excerpt;
      if (input.featuredAssetId !== undefined) data.featuredAssetId = input.featuredAssetId;
      if (input.status !== undefined) {
        data.status = input.status as PostStatus;
        if (input.status === 'PUBLISHED' && !cur.publishedAt) data.publishedAt = new Date();
      }
      if (input.contentHtml !== undefined) {
        const s = sanitizeRichText(input.contentHtml);
        Object.assign(data, { contentHtml: s.html, contentText: s.text });
      }
      if (input.title !== undefined || input.contentHtml !== undefined) {
        const text = (data.contentText as string | undefined) ?? cur.contentText;
        data.searchText = buildSearchText((data.title as string | undefined) ?? cur.title, text);
      }
      if (input.slug && input.slug !== cur.slug) data.slug = await this.uniqueSlug(tx, cur.kind, input.slug, id);
      const r = await tx.post.updateMany({ where: { id, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
      if (r.count !== 1) throw E.versionConflict((await tx.post.findUniqueOrThrow({ where: { id }, select: { version: true } })).version);
      if (input.event && cur.kind === 'EVENT') await tx.eventDetail.upsert({ where: { postId: id }, update: input.event, create: { postId: id, ...input.event } });
      if (input.program && cur.kind === 'PROGRAM') await tx.programDetail.upsert({ where: { postId: id }, update: input.program, create: { postId: id, ...input.program } });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: `${cur.kind.toLowerCase()}.update`, resourceType: cur.kind.toLowerCase(), resourceId: id }, tx);
      return tx.post.findUniqueOrThrow({ where: { id } });
    });
    await this.cache.invalidatePublic();
    return out;
  }

  async remove(a: AuthContext, id: string) {
    const r = await this.prisma.post.updateMany({
      where: { id, kind: { in: ['EVENT', 'PROGRAM'] }, deletedAt: null },
      data: { status: 'TRASHED', deletedAt: new Date(), version: { increment: 1 } },
    });
    if (r.count !== 1) throw E.notFound();
    await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'content.delete', resourceType: 'post', resourceId: id });
    await this.cache.invalidatePublic();
  }

  /** English (or other) translation for any post kind. The Vietnamese original stays on the post; a missing translation falls back visibly. */
  async upsertTranslation(a: AuthContext, postId: string, locale: LocaleName, input: { title: string; excerpt?: string | null; contentHtml: string }) {
    if (locale === 'vi') throw E.validation([{ path: 'locale', message: 'Bản tiếng Việt là nội dung gốc của bài viết.' }]);
    const s = sanitizeRichText(input.contentHtml);
    await this.prisma.$transaction(async (tx) => {
      const exists = await tx.post.findUnique({ where: { id: postId }, select: { id: true } });
      if (!exists) throw E.notFound();
      await tx.postTranslation.upsert({
        where: { postId_locale: { postId, locale } },
        update: { title: input.title, excerpt: input.excerpt ?? null, contentHtml: s.html, contentText: s.text, searchText: buildSearchText(input.title, s.text) },
        create: { postId, locale, title: input.title, excerpt: input.excerpt ?? null, contentHtml: s.html, contentText: s.text, searchText: buildSearchText(input.title, s.text) },
      });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'post.translation', resourceType: 'post', resourceId: postId, metadata: { locale } }, tx);
    });
    await this.cache.invalidatePublic();
    return { postId, locale };
  }

  // ───── pages ─────
  async listPages() {
    return this.prisma.page.findMany({
      where: { deletedAt: null },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }],
      select: { id: true, parentId: true, slug: true, title: true, status: true, template: true, needsReview: true, updatedAt: true, version: true },
    });
  }

  async getPage(id: string) {
    const p = await this.prisma.page.findFirst({ where: { id, deletedAt: null }, include: { translations: true } });
    if (!p) throw E.notFound();
    return p;
  }

  async createPage(
    a: AuthContext,
    input: {
      parentId?: string | null;
      slug: string;
      title: string;
      contentHtml: string;
      status: 'DRAFT' | 'PUBLISHED' | 'PRIVATE';
      template?: 'DEFAULT' | 'CONTACT' | 'ANNOUNCEMENTS' | 'ABOUT';
    },
  ) {
    const s = sanitizeRichText(input.contentHtml);
    if (!input.parentId && isReservedTopLevelPath(slugify(input.slug))) {
      throw E.validation([{ path: 'slug', message: 'Đường dẫn này thuộc về hệ thống (ví dụ /lien-he, /tim-kiem) nên không thể dùng cho trang tự tạo.' }]);
    }
    try {
      const p = await this.prisma.page.create({
        data: {
          parentId: input.parentId ?? null,
          slug: slugify(input.slug),
          title: input.title,
          contentHtml: s.html,
          contentText: s.text,
          searchText: buildSearchText(input.title, s.text),
          status: input.status,
          template: input.template ?? 'DEFAULT',
          publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
        },
      });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'page.create', resourceType: 'page', resourceId: p.id });
      await this.cache.invalidatePublic();
      return p;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw E.conflict('Đường dẫn trang đã tồn tại.');
      throw e;
    }
  }

  async updatePage(
    a: AuthContext,
    id: string,
    expectedVersion: number,
    input: { title?: string; contentHtml?: string; status?: 'DRAFT' | 'PUBLISHED' | 'PRIVATE'; sortOrder?: number },
  ) {
    const cur = await this.prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!cur) throw E.notFound();
    const data: Prisma.PageUncheckedUpdateManyInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'PUBLISHED' && !cur.publishedAt) data.publishedAt = new Date();
    }
    if (input.contentHtml !== undefined) {
      const s = sanitizeRichText(input.contentHtml);
      Object.assign(data, { contentHtml: s.html, contentText: s.text });
    }
    data.searchText = buildSearchText((data.title as string | undefined) ?? cur.title, (data.contentText as string | undefined) ?? cur.contentText);
    data.needsReview = false; // edited by a human ⇒ no longer an unreviewed legacy import
    const r = await this.prisma.page.updateMany({ where: { id, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
    if (r.count !== 1) throw E.versionConflict((await this.prisma.page.findUniqueOrThrow({ where: { id }, select: { version: true } })).version);
    await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'page.update', resourceType: 'page', resourceId: id });
    await this.cache.invalidatePublic();
    return this.prisma.page.findUniqueOrThrow({ where: { id } });
  }

  async removePage(a: AuthContext, id: string) {
    if (await this.prisma.page.count({ where: { parentId: id, deletedAt: null } })) throw E.conflict('Trang còn trang con. Hãy chuyển hoặc xóa trang con trước.');
    const r = await this.prisma.page.updateMany({ where: { id, deletedAt: null }, data: { status: 'TRASHED', deletedAt: new Date(), version: { increment: 1 } } });
    if (r.count !== 1) throw E.notFound();
    await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'page.delete', resourceType: 'page', resourceId: id });
    await this.cache.invalidatePublic();
  }

  // ───── categories ─────
  async categories() {
    const rows = await this.prisma.category.findMany({ include: { translations: true, _count: { select: { posts: true } } }, orderBy: [{ sortOrder: 'asc' }] });
    return {
      items: rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        parentId: c.parentId,
        sortOrder: c.sortOrder,
        cardType: c.cardType,
        isSystem: c.isSystem,
        posts: c._count.posts,
        translations: c.translations,
      })),
    };
  }

  async updateCategory(
    a: AuthContext,
    id: string,
    input: {
      sortOrder?: number;
      cardType?: 'CARD' | 'PROFILE' | 'SONG' | 'TIP';
      translations?: Partial<Record<LocaleName, { name: string; description?: string | null; summary?: string | null; navLabel?: string | null } | undefined>>;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const exists = await tx.category.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw E.notFound();
      await tx.category.update({ where: { id }, data: { sortOrder: input.sortOrder, cardType: input.cardType } });
      for (const [locale, t] of Object.entries(input.translations ?? {})) {
        if (!t) continue;
        await tx.categoryTranslation.upsert({
          where: { categoryId_locale: { categoryId: id, locale: locale as LocaleName } },
          update: t,
          create: { categoryId: id, locale: locale as LocaleName, ...t },
        });
      }
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'category.update', resourceType: 'category', resourceId: id }, tx);
    });
    await this.cache.invalidatePublic();
    return { id };
  }

  async createCategory(a: AuthContext, input: { slug: string; parentId: string; nameVi: string; nameEn: string }) {
    try {
      const c = await this.prisma.category.create({
        data: {
          slug: slugify(input.slug),
          parentId: input.parentId,
          translations: {
            create: [
              { locale: 'vi', name: input.nameVi },
              { locale: 'en', name: input.nameEn },
            ],
          },
        },
      });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'category.create', resourceType: 'category', resourceId: c.id });
      await this.cache.invalidatePublic();
      return c;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw E.conflict('Slug chuyên mục đã tồn tại.');
      throw e;
    }
  }

  async deleteCategory(a: AuthContext, id: string) {
    const c = await this.prisma.category.findUnique({ where: { id }, include: { _count: { select: { posts: true, children: true } } } });
    if (!c) throw E.notFound();
    if (c.isSystem) throw E.conflict('Không thể xóa chuyên mục hệ thống (5 trụ cột và mục con gốc).');
    if (c._count.posts || c._count.children) throw E.conflict('Chuyên mục còn bài viết hoặc mục con.');
    await this.prisma.category.delete({ where: { id } });
    await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'category.delete', resourceType: 'category', resourceId: id });
    await this.cache.invalidatePublic();
  }
}
