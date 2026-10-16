import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { LIMITS, slugify, type RoleName } from '@hbvl/contracts';
import { Prisma, PrismaClient, type PostStatus, type ReviewAction } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { CacheService } from '../cache/cache.service';
import { E } from '../common/errors';
import { IdempotencyService, type IdempotentResult } from '../common/idempotency.service';
import { buildSearchText, extractMediaIds, sanitizeRichText } from '../content/sanitize';
import { MediaService, mediaUrl } from '../media/media.service';
import { OutboxService } from '../outbox/outbox.service';
import { postStatusMail, postSubmittedMail } from '../mail/templates';
import { ENV, type Env } from '../config/env';
import { Inject } from '@nestjs/common';
import { evaluate, canSeePost, type PostAction } from './state-machine';

type Tx = Prisma.TransactionClient;

export interface DraftInput {
  title: string;
  categoryId: string;
  contentHtml: string;
  featuredAssetId?: string | null;
}
export interface StaffEditInput {
  title?: string;
  categoryId?: string;
  contentHtml?: string;
  featuredAssetId?: string | null;
}

const fullInclude = {
  author: { select: { id: true, displayName: true, email: true, role: true } },
  categories: { select: { isPrimary: true, categoryId: true, category: { select: { slug: true, translations: true } } } },
  featured: { select: { id: true, width: true, height: true, status: true } },
  reviewEvents: {
    orderBy: { createdAt: 'desc' as const },
    take: 50,
    select: {
      id: true,
      action: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      postVersion: true,
      createdAt: true,
      actor: { select: { id: true, displayName: true, role: true } },
    },
  },
} satisfies Prisma.PostInclude;
type FullPost = Prisma.PostGetPayload<{ include: typeof fullInclude }>;

@Injectable()
export class PostWorkflowService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cache: CacheService,
    private readonly idem: IdempotencyService,
    private readonly media: MediaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────────────────── DTOs ─────────────────────────
  dto(p: FullPost, opts: { includeHistory?: boolean } = {}) {
    const primary = p.categories.find((c) => c.isPrimary) ?? p.categories[0];
    const feedback = p.reviewEvents.find((e) => (e.action === 'REQUEST_CHANGES' || e.action === 'REJECT') && e.reason);
    const vi = primary?.category.translations.find((t) => t.locale === 'vi');
    return {
      id: p.id,
      kind: p.kind,
      status: p.status,
      version: p.version,
      title: p.title,
      slug: p.status === 'PUBLISHED' ? p.slug : null,
      contentHtml: p.contentHtml,
      categoryId: primary?.categoryId ?? null,
      category: primary ? { slug: primary.category.slug, name: vi?.name ?? primary.category.slug } : null,
      featured: p.featured
        ? {
            id: p.featured.id,
            width: p.featured.width,
            height: p.featured.height,
            thumb: mediaUrl(p.featured.id, 'thumb'),
            card: mediaUrl(p.featured.id, 'card'),
            large: mediaUrl(p.featured.id, 'large'),
          }
        : null,
      author: p.author ? { id: p.author.id, displayName: p.author.displayName } : null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      submittedAt: p.submittedAt,
      publishedAt: p.publishedAt,
      needsReview: p.needsReview,
      /** Latest "request changes / reject" feedback — shown only to the sender and staff. */
      feedback: feedback ? { action: feedback.action, reason: feedback.reason, at: feedback.createdAt } : null,
      ...(opts.includeHistory ? { history: p.reviewEvents } : {}),
    };
  }

  private async load(tx: Tx, id: string): Promise<FullPost | null> {
    return tx.post.findFirst({ where: { id, kind: 'POST' }, include: fullInclude });
  }

  /** Loads a post the actor is allowed to know about; otherwise 404 (never reveals that another user's draft exists). */
  private async loadVisible(tx: Tx, id: string, a: AuthContext): Promise<FullPost> {
    const post = await this.load(tx, id);
    if (!post) throw E.notFound('Không tìm thấy bài viết.');
    const reviewed = a.user.role === 'COLLABORATOR' ? post.reviewEvents.some((e) => e.actor?.id === a.user.id) : false;
    if (!canSeePost({ role: a.user.role, userId: a.user.id }, { ...post, authorRole: post.author?.role ?? null }, reviewed)) throw E.notFound('Không tìm thấy bài viết.');
    return post;
  }

  private decide(action: PostAction, post: FullPost, a: AuthContext) {
    const d = evaluate(action, post.status, {
      role: a.user.role as RoleName,
      isOwner: post.authorId === a.user.id,
      authorRole: (post.author?.role as RoleName | undefined) ?? null,
    });
    if (!d.allow) {
      throw d.code === 'STATE_LOCKED'
        ? E.locked('Bài viết đang ở trạng thái không cho phép thao tác này.')
        : E.forbidden('Bạn không có quyền thực hiện thao tác này.', 'FORBIDDEN_ACTION');
    }
    return d;
  }

  // ───────────────────────── content helpers ─────────────────────────
  private prepareContent(contentHtml: string) {
    const s = sanitizeRichText(contentHtml);
    if (s.text.length > LIMITS.postContentMax) {
      throw E.validation([{ path: 'contentHtml', message: `Nội dung tối đa ${LIMITS.postContentMax.toLocaleString('vi-VN')} ký tự.` }]);
    }
    if (s.html.length > LIMITS.postContentMax * 4) throw E.validation([{ path: 'contentHtml', message: 'Nội dung quá dài.' }]);
    return s;
  }

  private async assertCategory(tx: Tx, categoryId: string) {
    const c = await tx.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!c) throw E.validation([{ path: 'categoryId', message: 'Chuyên mục không tồn tại.' }]);
  }

  /** The featured image must be owned by the acting user (or staff acting on someone's post) and not deleted. */
  private async assertFeatured(tx: Tx, assetId: string | null | undefined, a: AuthContext, post?: { authorId: string | null }) {
    if (!assetId) return;
    const asset = await tx.mediaAsset.findFirst({
      where: { id: assetId, deletedAt: null, status: { in: ['STAGED', 'ACTIVE'] }, purpose: 'POST_FEATURED' },
      select: { ownerId: true },
    });
    const mine = asset?.ownerId === a.user.id || (post?.authorId && asset?.ownerId === post.authorId && a.user.role !== 'MEMBER');
    if (!asset || !mine) throw E.validation([{ path: 'featuredAssetId', message: 'Ảnh không hợp lệ hoặc không thuộc về bạn.' }]);
  }

  private async syncMedia(tx: Tx, postId: string, featuredId: string | null, html: string) {
    const inline = extractMediaIds(html);
    await tx.postMedia.deleteMany({ where: { postId } });
    const rows = [
      ...(featuredId ? [{ postId, assetId: featuredId, role: 'FEATURED' as const, sortOrder: 0 }] : []),
      ...inline.filter((i) => i !== featuredId).map((assetId, i) => ({ postId, assetId, role: 'INLINE' as const, sortOrder: i + 1 })),
    ];
    if (rows.length) {
      const existing = await tx.mediaAsset.findMany({ where: { id: { in: rows.map((r) => r.assetId) } }, select: { id: true } });
      const ok = new Set(existing.map((e) => e.id));
      await tx.postMedia.createMany({ data: rows.filter((r) => ok.has(r.assetId)) });
    }
    if (featuredId) await tx.mediaAsset.updateMany({ where: { id: featuredId, status: 'STAGED' }, data: { status: 'ACTIVE', attachedAt: new Date() } });
  }

  private async revision(tx: Tx, post: { id: string; version: number; title: string; contentHtml: string }, categoryIds: string[], actorId: string | null) {
    await tx.postRevision.create({ data: { postId: post.id, version: post.version, actorId, title: post.title, contentHtml: post.contentHtml, categoryIds } });
  }

  private async event(
    tx: Tx,
    post: { id: string; version: number },
    actorId: string | null,
    action: ReviewAction,
    from: PostStatus | null,
    to: PostStatus,
    reason?: string | null,
  ) {
    await tx.reviewEvent.create({ data: { postId: post.id, actorId, action, fromStatus: from, toStatus: to, reason: reason ?? null, postVersion: post.version } });
  }

  /** Optimistic concurrency: the write only applies if the row is still at the version (and status) the client saw. */
  private async updateGuarded(tx: Tx, id: string, expectedVersion: number, fromStatuses: PostStatus[], data: Prisma.PostUncheckedUpdateManyInput) {
    const r = await tx.post.updateMany({ where: { id, version: expectedVersion, status: { in: fromStatuses } }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 1) return;
    const cur = await tx.post.findUnique({ where: { id }, select: { version: true } });
    if (!cur) throw E.notFound();
    if (cur.version !== expectedVersion) throw E.versionConflict(cur.version);
    throw E.locked();
  }

  private async allocateSlug(tx: Tx, title: string, ownId: string): Promise<string> {
    const base = slugify(title) || 'bai-viet';
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('post-slug'))`;
    const taken = await tx.post.findMany({ where: { kind: 'POST', slug: { startsWith: base }, id: { not: ownId } }, select: { slug: true } });
    const used = new Set(taken.map((t) => t.slug));
    if (!used.has(base)) return base;
    for (let i = 2; i < 10_000; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

  private async notifyAuthor(tx: Tx, post: FullPost, status: PostStatus, reason?: string | null) {
    if (!post.author) return;
    const label =
      { CHANGES_REQUESTED: 'cần chỉnh sửa', REJECTED: 'không được duyệt', PUBLISHED: 'đã được xuất bản', PENDING_REVIEW: 'đã được gửi duyệt' }[status as 'CHANGES_REQUESTED'] ??
      status;
    await tx.notification.create({
      data: { userId: post.author.id, type: `post.${status.toLowerCase()}`, title: `Bài "${post.title}" ${label}`, body: reason ?? null, data: { postId: post.id } },
    });
    if (status === 'CHANGES_REQUESTED' || status === 'REJECTED' || status === 'PUBLISHED') {
      const mail = postStatusMail({
        name: post.author.displayName,
        title: post.title,
        status,
        reason: reason ?? undefined,
        link: `${this.env.PUBLIC_ORIGIN.replace(/\/$/, '')}/bai-cua-toi`,
      });
      await this.outbox.enqueueEmail(
        tx,
        { to: post.author.email, kind: `POST_${status}`, ...mail },
        { aggregateType: 'post', aggregateId: post.id, dedupeKey: `post-${post.id}-${status}-v${post.version + 1}` },
      );
    }
  }

  private async notifyStaffOfSubmission(tx: Tx, post: FullPost) {
    const staff = await tx.user.findMany({
      where: { role: { in: ['ADMIN', 'COLLABORATOR'] }, status: 'ACTIVE', deletedAt: null, id: { not: post.authorId ?? undefined } },
      select: { id: true },
    });
    if (staff.length) {
      await tx.notification.createMany({
        data: staff.map((u) => ({ userId: u.id, type: 'post.submitted', title: `Bài mới chờ duyệt: "${post.title}"`, data: { postId: post.id } })),
      });
    }
    // Collaborators also get an e-mail (they may not be signed in). One per person and submission; the outbox dedupe key makes retries harmless.
    const mailTo = await tx.user.findMany({
      where: { role: 'COLLABORATOR', status: 'ACTIVE', deletedAt: null, id: { not: post.authorId ?? undefined } },
      select: { id: true, displayName: true, email: true },
    });
    const link = `${this.env.PUBLIC_ORIGIN.replace(/\/$/, '')}/cong-tac-vien/hang-cho`;
    for (const u of mailTo) {
      const mail = postSubmittedMail({ name: u.displayName, title: post.title, author: post.author?.displayName ?? 'Một thành viên', link });
      await this.outbox.enqueueEmail(
        tx,
        { to: u.email, kind: 'POST_SUBMITTED', ...mail },
        { aggregateType: 'post', aggregateId: post.id, dedupeKey: `post-submitted-${post.id}-v${post.version}-${u.id}` },
      );
    }
  }

  private async afterPublicChange(tx: Tx, scope: string, postId: string) {
    await this.outbox.enqueueCacheInvalidation(tx, scope, postId);
  }

  // ───────────────────────── member (owner) ─────────────────────────
  async listMine(a: AuthContext, q: { status?: PostStatus; page: number; pageSize: number }) {
    const where: Prisma.PostWhereInput = { kind: 'POST', authorId: a.user.id, status: q.status ?? { not: 'TRASHED' } };
    const [total, rows] = await Promise.all([
      this.prisma.post.count({ where }),
      this.prisma.post.findMany({ where, include: fullInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      items: rows.map((r) => ({ ...this.dto(r), contentHtml: undefined })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async getMine(a: AuthContext, id: string) {
    const post = await this.prisma.$transaction((tx) => this.loadVisible(tx, id, a));
    if (post.authorId !== a.user.id && a.user.role === 'MEMBER') throw E.notFound();
    return this.dto(post, { includeHistory: true });
  }

  createDraft(a: AuthContext, input: DraftInput, key: string): Promise<IdempotentResult<ReturnType<PostWorkflowService['dto']>> & { replayed: boolean }> {
    return this.idem.run(a.user.id, 'post.create', key, input, async (tx) => {
      const s = this.prepareContent(input.contentHtml);
      await this.assertCategory(tx, input.categoryId);
      await this.assertFeatured(tx, input.featuredAssetId, a);
      const created = await tx.post.create({
        data: {
          kind: 'POST',
          slug: `nhap-${randomUUID().slice(0, 12)}`,
          authorId: a.user.id,
          status: 'DRAFT',
          title: input.title,
          contentHtml: s.html,
          contentText: s.text,
          searchText: buildSearchText(input.title, s.text),
          featuredAssetId: input.featuredAssetId ?? null,
          origin: 'SITE',
          categories: { create: [{ categoryId: input.categoryId, isPrimary: true }] },
        },
        select: { id: true },
      });
      await this.syncMedia(tx, created.id, input.featuredAssetId ?? null, s.html);
      const post = (await this.load(tx, created.id))!;
      await this.revision(tx, post, [input.categoryId], a.user.id);
      await this.event(tx, post, a.user.id, 'CREATE', null, 'DRAFT');
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'post.create', resourceType: 'post', resourceId: post.id }, tx);
      return { status: 201, body: this.dto(post), resourceId: post.id };
    });
  }

  async updateOwn(a: AuthContext, id: string, input: DraftInput, expectedVersion: number) {
    return this.prisma.$transaction(async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      this.decide('OWNER_EDIT', post, a);
      const s = this.prepareContent(input.contentHtml);
      await this.assertCategory(tx, input.categoryId);
      await this.assertFeatured(tx, input.featuredAssetId, a, post);
      await this.updateGuarded(tx, id, expectedVersion, ['DRAFT', 'CHANGES_REQUESTED'], {
        title: input.title,
        contentHtml: s.html,
        contentText: s.text,
        searchText: buildSearchText(input.title, s.text),
        featuredAssetId: input.featuredAssetId ?? null,
      });
      await tx.postCategory.deleteMany({ where: { postId: id } });
      await tx.postCategory.create({ data: { postId: id, categoryId: input.categoryId, isPrimary: true } });
      await this.syncMedia(tx, id, input.featuredAssetId ?? null, s.html);
      const after = (await this.load(tx, id))!;
      await this.revision(tx, after, [input.categoryId], a.user.id);
      await this.event(tx, after, a.user.id, 'SAVE_DRAFT', post.status, after.status);
      return this.dto(after);
    });
  }

  submit(a: AuthContext, id: string, expectedVersion: number, key: string) {
    return this.idem.run(a.user.id, 'post.submit', key, { id, expectedVersion }, async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      const d = this.decide('SUBMIT', post, a);
      const resubmit = post.status === 'CHANGES_REQUESTED';
      // Completeness rules apply on submit (drafts may be incomplete).
      const text = sanitizeRichText(post.contentHtml).text;
      const problems: { path: string; message: string }[] = [];
      if (!post.title.trim()) problems.push({ path: 'title', message: 'Nhập tiêu đề.' });
      if (post.title.length > LIMITS.postTitleMax) problems.push({ path: 'title', message: `Tiêu đề tối đa ${LIMITS.postTitleMax} ký tự.` });
      if (!post.categories.length) problems.push({ path: 'categoryId', message: 'Chọn chuyên mục.' });
      if (!text.trim()) problems.push({ path: 'contentHtml', message: 'Nội dung không được để trống.' });
      if (problems.length) throw E.validation(problems);
      await this.updateGuarded(tx, id, expectedVersion, ['DRAFT', 'CHANGES_REQUESTED'], { status: d.allow ? d.to! : 'PENDING_REVIEW', submittedAt: new Date() });
      const after = (await this.load(tx, id))!;
      await this.revision(
        tx,
        after,
        after.categories.map((c) => c.categoryId),
        a.user.id,
      );
      await this.event(tx, after, a.user.id, resubmit ? 'SUBMIT' : 'SUBMIT', post.status, 'PENDING_REVIEW');
      await this.notifyStaffOfSubmission(tx, after);
      await this.audit.log(
        {
          actorId: a.user.id,
          actorRole: a.user.role,
          action: resubmit ? 'post.resubmit' : 'post.submit',
          resourceType: 'post',
          resourceId: id,
          metadata: { version: after.version },
        },
        tx,
      );
      return { status: 200, body: this.dto(after), resourceId: id };
    });
  }

  // ───────────────────────── staff ─────────────────────────
  async reviewQueue(a: AuthContext, q: { page: number; pageSize: number }) {
    const where: Prisma.PostWhereInput = {
      kind: 'POST',
      status: 'PENDING_REVIEW',
      // A collaborator never reviews their own post nor an administrator's.
      ...(a.user.role === 'COLLABORATOR' ? { authorId: { not: a.user.id }, NOT: { author: { is: { role: 'ADMIN' } } } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.post.count({ where }),
      // oldest submission first (FIFO) with id tie-breaker
      this.prisma.post.findMany({ where, include: fullInclude, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      items: rows.map((r) => ({ ...this.dto(r), contentHtml: undefined })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async getForStaff(a: AuthContext, id: string) {
    const post = await this.prisma.$transaction((tx) => this.loadVisible(tx, id, a));
    return this.dto(post, { includeHistory: true });
  }

  /** Pending posts: review edit. Any other non-trashed post (published, private, rejected…): full edit — staff may handle everything that is not the administrator's. */
  async staffEdit(a: AuthContext, id: string, input: StaffEditInput, expectedVersion: number) {
    const probe = await this.prisma.$transaction((tx) => this.loadVisible(tx, id, a));
    if (probe.status !== 'PENDING_REVIEW') return this.adminEdit(a, id, input, expectedVersion);
    return this.prisma.$transaction(async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      this.decide('STAFF_EDIT', post, a);
      return this.applyEdit(tx, a, post, input, expectedVersion, ['PENDING_REVIEW'], 'STAFF_EDIT');
    });
  }

  private async applyEdit(tx: Tx, a: AuthContext, post: FullPost, input: StaffEditInput, expectedVersion: number, from: PostStatus[], action: ReviewAction) {
    const data: Prisma.PostUncheckedUpdateManyInput = {};
    if (input.title !== undefined) data.title = input.title;
    let html = post.contentHtml;
    let text = post.contentText;
    if (input.contentHtml !== undefined) {
      const s = this.prepareContent(input.contentHtml);
      Object.assign(data, { contentHtml: s.html, contentText: s.text });
      html = s.html;
      text = s.text;
    }
    // Search (site search and the assistant) matches the title as well as the body, so both are re-indexed whenever either changes.
    if (input.title !== undefined || input.contentHtml !== undefined) data.searchText = buildSearchText(input.title ?? post.title, text);
    if (input.featuredAssetId !== undefined) {
      await this.assertFeatured(tx, input.featuredAssetId, a, post);
      data.featuredAssetId = input.featuredAssetId;
    }
    if (input.categoryId) await this.assertCategory(tx, input.categoryId);
    await this.updateGuarded(tx, post.id, expectedVersion, from, data);
    if (input.categoryId) {
      await tx.postCategory.deleteMany({ where: { postId: post.id } });
      await tx.postCategory.create({ data: { postId: post.id, categoryId: input.categoryId, isPrimary: true } });
    }
    await this.syncMedia(tx, post.id, input.featuredAssetId === undefined ? post.featuredAssetId : input.featuredAssetId, html);
    const after = (await this.load(tx, post.id))!;
    await this.revision(
      tx,
      after,
      after.categories.map((c) => c.categoryId),
      a.user.id,
    );
    await this.event(tx, after, a.user.id, action, post.status, after.status);
    await this.audit.log(
      { actorId: a.user.id, actorRole: a.user.role, action: `post.${action.toLowerCase()}`, resourceType: 'post', resourceId: post.id, metadata: { version: after.version } },
      tx,
    );
    if (post.status === 'PUBLISHED') await this.afterPublicChange(tx, 'post', post.id);
    return this.dto(after);
  }

  async requestChanges(a: AuthContext, id: string, reason: string, expectedVersion: number) {
    const out = await this.prisma.$transaction(async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      const d = this.decide('REQUEST_CHANGES', post, a);
      await this.updateGuarded(tx, id, expectedVersion, ['PENDING_REVIEW'], { status: d.allow ? d.to! : 'CHANGES_REQUESTED' });
      const after = (await this.load(tx, id))!;
      await this.event(tx, after, a.user.id, 'REQUEST_CHANGES', post.status, 'CHANGES_REQUESTED', reason);
      await this.notifyAuthor(tx, post, 'CHANGES_REQUESTED', reason);
      await this.audit.log(
        { actorId: a.user.id, actorRole: a.user.role, action: 'post.request_changes', resourceType: 'post', resourceId: id, metadata: { version: after.version } },
        tx,
      );
      return this.dto((await this.load(tx, id))!);
    });
    return out;
  }

  // ───────────────────────── admin ─────────────────────────
  async adminList(q: { status?: PostStatus; q?: string; page: number; pageSize: number }) {
    const where: Prisma.PostWhereInput = { kind: 'POST', status: q.status ?? { not: 'TRASHED' }, ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.post.count({ where }),
      this.prisma.post.findMany({ where, include: fullInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      items: rows.map((r) => ({ ...this.dto(r), contentHtml: undefined })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  /**
   * Post management list for staff. Collaborators see everything that has left its author's hands (never someone's private draft)
   * and never an administrator's posts; administrators see everything.
   */
  async staffList(a: AuthContext, q: { status?: PostStatus; q?: string; page: number; pageSize: number }) {
    const collab = a.user.role === 'COLLABORATOR';
    const where: Prisma.PostWhereInput = {
      kind: 'POST',
      status: q.status ?? (collab ? { notIn: ['DRAFT'] } : undefined),
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' as const } } : {}),
      ...(collab ? { NOT: [{ author: { is: { role: 'ADMIN' as const } } }, ...(q.status === 'DRAFT' ? [{ authorId: { not: a.user.id } }] : [])] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.post.count({ where }),
      this.prisma.post.findMany({ where, include: fullInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      items: rows.map((r) => ({ ...this.dto(r), contentHtml: undefined })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async publish(a: AuthContext, id: string, expectedVersion: number) {
    const out = await this.prisma.$transaction(async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      const d = this.decide('PUBLISH', post, a);
      const slug = post.status === 'PENDING_REVIEW' || post.slug.startsWith('nhap-') ? await this.allocateSlug(tx, post.title, id) : post.slug;
      await this.updateGuarded(tx, id, expectedVersion, ['PENDING_REVIEW', 'PRIVATE'], {
        status: d.allow ? d.to! : 'PUBLISHED',
        slug,
        publishedAt: post.publishedAt ?? new Date(),
      });
      const mediaIds = (await tx.postMedia.findMany({ where: { postId: id }, select: { assetId: true } })).map((m) => m.assetId);
      await this.media.setVisibility(tx, mediaIds, 'PUBLIC'); // media becomes public only together with the post
      const after = (await this.load(tx, id))!;
      await this.event(tx, after, a.user.id, 'PUBLISH', post.status, 'PUBLISHED');
      await this.notifyAuthor(tx, post, 'PUBLISHED');
      await this.audit.log(
        { actorId: a.user.id, actorRole: a.user.role, action: 'post.publish', resourceType: 'post', resourceId: id, metadata: { version: after.version, slug } },
        tx,
      );
      await this.afterPublicChange(tx, 'post', id);
      return this.dto(after);
    });
    await this.cache.invalidatePublic();
    return out;
  }

  async reject(a: AuthContext, id: string, reason: string, expectedVersion: number) {
    return this.prisma.$transaction(async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      const d = this.decide('REJECT', post, a);
      await this.updateGuarded(tx, id, expectedVersion, ['PENDING_REVIEW'], { status: d.allow ? d.to! : 'REJECTED' });
      const after = (await this.load(tx, id))!;
      await this.event(tx, after, a.user.id, 'REJECT', post.status, 'REJECTED', reason);
      await this.notifyAuthor(tx, post, 'REJECTED', reason);
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'post.reject', resourceType: 'post', resourceId: id, metadata: { version: after.version } }, tx);
      return this.dto(after);
    });
  }

  async unpublish(a: AuthContext, id: string, expectedVersion: number) {
    const out = await this.prisma.$transaction(async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      const d = this.decide('UNPUBLISH', post, a);
      await this.updateGuarded(tx, id, expectedVersion, ['PUBLISHED'], { status: d.allow ? d.to! : 'PRIVATE' });
      await this.privatizeUnusedMedia(tx, id);
      const after = (await this.load(tx, id))!;
      await this.event(tx, after, a.user.id, 'UNPUBLISH', post.status, 'PRIVATE');
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'post.unpublish', resourceType: 'post', resourceId: id }, tx);
      await this.afterPublicChange(tx, 'post', id);
      return this.dto(after);
    });
    await this.cache.invalidatePublic();
    return out;
  }

  /** A revoked post must not keep serving its images: assets used only by this post go back to PRIVATE. */
  private async privatizeUnusedMedia(tx: Tx, postId: string) {
    const links = await tx.postMedia.findMany({ where: { postId }, select: { assetId: true } });
    for (const { assetId } of links) {
      const other = await tx.postMedia.count({ where: { assetId, postId: { not: postId }, post: { status: 'PUBLISHED', deletedAt: null } } });
      if (!other) await tx.mediaAsset.update({ where: { id: assetId }, data: { visibility: 'PRIVATE' } });
    }
  }

  async adminEdit(a: AuthContext, id: string, input: StaffEditInput, expectedVersion: number) {
    const out = await this.prisma.$transaction(async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      this.decide('ADMIN_EDIT', post, a);
      const res = await this.applyEdit(tx, a, post, input, expectedVersion, [post.status], 'ADMIN_EDIT');
      if (post.status === 'PUBLISHED') {
        const ids = (await tx.postMedia.findMany({ where: { postId: id }, select: { assetId: true } })).map((m) => m.assetId);
        await this.media.setVisibility(tx, ids, 'PUBLIC');
      }
      return res;
    });
    await this.cache.invalidatePublic();
    return out;
  }

  /** Soft delete (retention: records stay for audit; see docs/DATABASE.md). Collaborators may delete any post that is not the administrator's. */
  async remove(a: AuthContext, id: string, expectedVersion: number) {
    const out = await this.prisma.$transaction(async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      const d = this.decide('DELETE', post, a);
      await this.updateGuarded(tx, id, expectedVersion, [post.status], { status: d.allow ? d.to! : 'TRASHED', deletedAt: new Date() });
      if (post.status === 'PUBLISHED') await this.privatizeUnusedMedia(tx, id);
      const after = (await this.load(tx, id))!;
      await this.event(tx, after, a.user.id, 'DELETE', post.status, 'TRASHED');
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'post.delete', resourceType: 'post', resourceId: id, metadata: { from: post.status } }, tx);
      if (post.status === 'PUBLISHED') await this.afterPublicChange(tx, 'post', id);
      return this.dto(after);
    });
    await this.cache.invalidatePublic();
    return out;
  }

  async restore(a: AuthContext, id: string, expectedVersion: number) {
    return this.prisma.$transaction(async (tx) => {
      const post = await this.loadVisible(tx, id, a);
      const d = this.decide('RESTORE', post, a);
      await this.updateGuarded(tx, id, expectedVersion, ['TRASHED'], { status: d.allow ? d.to! : 'DRAFT', deletedAt: null });
      const after = (await this.load(tx, id))!;
      await this.event(tx, after, a.user.id, 'RESTORE', 'TRASHED', 'DRAFT');
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'post.restore', resourceType: 'post', resourceId: id }, tx);
      return this.dto(after);
    });
  }
}
