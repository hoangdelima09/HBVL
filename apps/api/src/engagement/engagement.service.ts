import { Injectable } from '@nestjs/common';
import { LIMITS } from '@hbvl/contracts';
import { Prisma, PrismaClient, type CommentStatus } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';
import { avatarUrl } from '../media/media-url';
import { RedisService } from '../redis/redis.service';

const publishedPost = (id: string): Prisma.PostWhereInput => ({ id, kind: 'POST', status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: new Date() } });

/** Anti-spam decisions are explicit and NEVER overridden by auto-approve (legacy rule: keep spam/trash). */
export function classifyComment(body: string, recentSameBody: boolean): 'ok' | 'spam' {
  const links = (body.match(/https?:\/\/|www\./gi) ?? []).length;
  if (links > 3) return 'spam';
  if (recentSameBody) return 'spam';
  if (/(.)\1{30,}/.test(body)) return 'spam';
  return 'ok';
}

@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  // ───── likes: PUT/DELETE are idempotent; (userId, postId) is unique; the counter changes only when a row really changed ─────
  async like(a: AuthContext, postId: string) {
    const post = await this.prisma.post.findFirst({ where: publishedPost(postId), select: { id: true } });
    if (!post) throw E.notFound('Không tìm thấy bài viết.');
    const rows = await this.prisma.$queryRaw<{ likeCount: number; legacyLikeCount: number }[]>`
      WITH ins AS (
        INSERT INTO post_likes ("userId", "postId", "createdAt") VALUES (${a.user.id}::uuid, ${postId}::uuid, now())
        ON CONFLICT DO NOTHING RETURNING 1
      )
      UPDATE posts SET "likeCount" = "likeCount" + (SELECT count(*) FROM ins)::int WHERE id = ${postId}::uuid
      RETURNING "likeCount", "legacyLikeCount"`;
    return { likes: rows[0]!.likeCount + rows[0]!.legacyLikeCount, likedByMe: true };
  }

  async unlike(a: AuthContext, postId: string) {
    const post = await this.prisma.post.findFirst({ where: publishedPost(postId), select: { id: true } });
    if (!post) throw E.notFound('Không tìm thấy bài viết.');
    const rows = await this.prisma.$queryRaw<{ likeCount: number; legacyLikeCount: number }[]>`
      WITH del AS (DELETE FROM post_likes WHERE "userId" = ${a.user.id}::uuid AND "postId" = ${postId}::uuid RETURNING 1)
      UPDATE posts SET "likeCount" = GREATEST(0, "likeCount" - (SELECT count(*) FROM del)::int) WHERE id = ${postId}::uuid
      RETURNING "likeCount", "legacyLikeCount"`;
    return { likes: rows[0]!.likeCount + rows[0]!.legacyLikeCount, likedByMe: false };
  }

  // ───── comments ─────
  /**
   * Public thread. A comment its author deleted stays as an empty placeholder while replies hang under it (so the conversation still
   * reads), otherwise it disappears. `mine` / `canEdit` / `canDelete` are computed for the signed-in viewer only; author ids are never sent.
   */
  async listPublic(postId: string, a?: AuthContext) {
    const post = await this.prisma.post.findFirst({ where: publishedPost(postId), select: { id: true, commentsOpen: true } });
    if (!post) throw E.notFound();
    const rows = await this.prisma.comment.findMany({
      where: { postId, status: { in: ['APPROVED', 'TRASHED'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
      select: {
        id: true,
        parentId: true,
        depth: true,
        body: true,
        status: true,
        authorId: true,
        authorName: true,
        createdAt: true,
        editedAt: true,
        editCount: true,
        author: { select: { role: true, avatarAssetId: true } },
      },
    });
    // keep a removed comment only if something visible still hangs under it
    const keep = new Set(rows.filter((r) => r.status === 'APPROVED').map((r) => r.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows) {
      if (r.status !== 'APPROVED') continue;
      for (let p = r.parentId, guard = 0; p && guard < 10; p = byId.get(p)?.parentId ?? null, guard++) keep.add(p);
    }
    return {
      items: rows
        .filter((r) => keep.has(r.id))
        .map((r) => {
          const deleted = r.status !== 'APPROVED';
          const mine = !!a && r.authorId === a.user.id;
          return {
            id: r.id,
            parentId: r.parentId,
            depth: r.depth,
            body: deleted ? '' : r.body,
            author: deleted ? '' : r.authorName,
            authorRole: deleted ? null : (r.author?.role ?? null),
            authorAvatar: deleted ? null : avatarUrl(r.author?.avatarAssetId, 'thumb'),
            createdAt: r.createdAt,
            editedAt: deleted ? null : r.editedAt,
            editCount: deleted ? 0 : r.editCount,
            deleted,
            mine: mine && !deleted,
            canEdit: mine && !deleted && post.commentsOpen,
            canDelete: !deleted && !!a && (mine || this.canModerate(a, r.author?.role ?? null)),
          };
        }),
    };
  }

  /** Staff may remove someone else's comment from the page: administrators any, collaborators any that is not an administrator's. */
  private canModerate(a: AuthContext, authorRole: string | null): boolean {
    return a.user.role === 'ADMIN' || (a.user.role === 'COLLABORATOR' && authorRole !== 'ADMIN');
  }

  /**
   * The author rewrites their comment. The previous text is kept as a public revision (anyone can read what it said before), so an edit
   * can never silently change a conversation. Locked per row, so two quick edits cannot lose a version.
   */
  async edit(a: AuthContext, id: string, body: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM comments WHERE id = ${id}::uuid FOR UPDATE`;
      const c = await tx.comment.findUnique({
        where: { id },
        select: {
          id: true,
          authorId: true,
          body: true,
          status: true,
          createdAt: true,
          editedAt: true,
          editCount: true,
          post: { select: { status: true, deletedAt: true, commentsOpen: true } },
        },
      });
      if (!c || c.status === 'TRASHED' || c.post.status !== 'PUBLISHED' || c.post.deletedAt) throw E.notFound('Không tìm thấy bình luận.');
      if (c.authorId !== a.user.id) throw E.forbidden('Bạn chỉ có thể sửa bình luận của chính mình.', 'FORBIDDEN_ACTION');
      if (!c.post.commentsOpen) throw E.forbidden('Bình luận đã đóng.', 'FORBIDDEN_ACTION');
      if (body === c.body) return this.editDto(c);
      if (c.editCount >= LIMITS.commentMaxEdits) throw E.conflict(`Mỗi bình luận chỉ được sửa tối đa ${LIMITS.commentMaxEdits} lần.`);
      const now = new Date();
      await tx.commentRevision.create({ data: { commentId: id, body: c.body, writtenAt: c.editedAt ?? c.createdAt, replacedAt: now } });
      // An edit goes through the same spam filter as a new comment (no "post something harmless, then edit the spam in").
      const status: CommentStatus = classifyComment(body, false) === 'spam' ? 'SPAM' : c.status;
      const after = await tx.comment.update({
        where: { id },
        data: { body, editedAt: now, editCount: { increment: 1 }, status },
        select: { id: true, body: true, status: true, editedAt: true, editCount: true },
      });
      await this.audit.log(
        { actorId: a.user.id, actorRole: a.user.role, action: 'comment.edit', resourceType: 'comment', resourceId: id, metadata: { editCount: after.editCount } },
        tx,
      );
      return this.editDto(after);
    });
  }

  private editDto(c: { id: string; body: string; status: CommentStatus; editedAt: Date | null; editCount: number }) {
    return { id: c.id, body: c.body, status: c.status, editedAt: c.editedAt, editCount: c.editCount, awaitingModeration: c.status !== 'APPROVED' };
  }

  /** The author deletes their own comment; staff may delete others' from the page under the usual moderation rules. */
  async remove(a: AuthContext, id: string) {
    const c = await this.prisma.comment.findUnique({ where: { id }, select: { id: true, authorId: true, status: true, author: { select: { role: true } } } });
    if (!c || c.status === 'TRASHED') throw E.notFound('Không tìm thấy bình luận.');
    if (c.authorId !== a.user.id) {
      if (!this.canModerate(a, c.author?.role ?? null)) throw E.forbidden('Bạn chỉ có thể xóa bình luận của chính mình.', 'FORBIDDEN_ACTION');
      await this.moderate(a, id, 'TRASHED');
      return { id, deleted: true };
    }
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.comment.update({ where: { id }, data: { status: 'TRASHED', deletedAt: now, moderatedById: a.user.id } });
      // Nothing left to judge: open reports about it are closed, and staff alerts for it are cleared.
      await tx.commentReport.updateMany({
        where: { commentId: id, status: { in: ['OPEN', 'IN_REVIEW'] } },
        data: { status: 'RESOLVED', handledAt: now, resolution: 'AUTHOR_DELETED' },
      });
      await tx.notification.updateMany({ where: { type: 'comment.reported', readAt: null, data: { path: ['commentId'], equals: id } }, data: { readAt: now } });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'comment.delete_own', resourceType: 'comment', resourceId: id }, tx);
    });
    return { id, deleted: true };
  }

  /** Earlier versions of a visible comment, newest first. Public, like the comment itself. */
  async revisions(id: string) {
    const c = await this.prisma.comment.findFirst({
      where: { id, status: 'APPROVED', post: { status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: new Date() } } },
      select: {
        id: true,
        body: true,
        createdAt: true,
        editedAt: true,
        revisions: { orderBy: { replacedAt: 'desc' }, take: LIMITS.commentMaxEdits, select: { body: true, writtenAt: true, replacedAt: true } },
      },
    });
    if (!c) throw E.notFound();
    return { id: c.id, current: { body: c.body, writtenAt: c.editedAt ?? c.createdAt }, items: c.revisions };
  }

  async create(a: AuthContext, postId: string, input: { body: string; parentId?: string | null }) {
    const post = await this.prisma.post.findFirst({ where: publishedPost(postId), select: { id: true, commentsOpen: true } });
    if (!post) throw E.notFound('Không tìm thấy bài viết.');
    if (!post.commentsOpen) throw E.forbidden('Bình luận đã đóng.', 'FORBIDDEN_ACTION');
    let depth = 0;
    if (input.parentId) {
      const parent = await this.prisma.comment.findFirst({ where: { id: input.parentId, postId, status: 'APPROVED' }, select: { depth: true } });
      if (!parent) throw E.validation([{ path: 'parentId', message: 'Bình luận được trả lời không tồn tại trong bài này.' }]);
      depth = parent.depth + 1;
      if (depth > LIMITS.commentMaxDepth) throw E.validation([{ path: 'parentId', message: 'Đã đạt độ sâu tối đa của chuỗi trả lời.' }]);
    }
    const dupe = await this.prisma.comment.findFirst({
      where: { authorId: a.user.id, postId, body: input.body, createdAt: { gt: new Date(Date.now() - 5 * 60_000) } },
      select: { id: true },
    });
    const verdict = classifyComment(input.body, !!dupe);
    // Auto-approve for every authenticated website role (admin, collaborator, member) — unless the filter said spam.
    const status: CommentStatus = verdict === 'spam' ? 'SPAM' : 'APPROVED';
    const c = await this.prisma.comment.create({
      data: { postId, authorId: a.user.id, authorName: a.user.displayName, parentId: input.parentId ?? null, depth, body: input.body, status },
      select: { id: true, status: true, parentId: true, depth: true, body: true, authorName: true, createdAt: true },
    });
    return {
      id: c.id,
      status: c.status,
      parentId: c.parentId,
      depth: c.depth,
      body: c.body,
      author: c.authorName,
      authorAvatar: avatarUrl(a.user.avatarAssetId, 'thumb'),
      createdAt: c.createdAt,
      awaitingModeration: c.status !== 'APPROVED',
    };
  }

  // ───── moderation (collaborator + admin; admin comments protected from collaborators) ─────
  async moderationList(q: { status?: CommentStatus; page: number; pageSize: number }) {
    const where: Prisma.CommentWhereInput = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.comment.count({ where }),
      this.prisma.comment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          body: true,
          status: true,
          authorName: true,
          createdAt: true,
          post: { select: { id: true, title: true, slug: true } },
          author: { select: { id: true, role: true } },
        },
      }),
    ]);
    return {
      items: rows.map((r) => ({ ...r, authorRole: r.author?.role ?? null, author: undefined })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async moderate(a: AuthContext, id: string, status: CommentStatus) {
    const c = await this.prisma.comment.findUnique({ where: { id }, select: { id: true, author: { select: { role: true } } } });
    if (!c) throw E.notFound();
    // Collaborators may moderate ordinary comments but never touch comments written by an administrator.
    if (a.user.role !== 'ADMIN' && c.author?.role === 'ADMIN') throw E.forbidden('Không thể kiểm duyệt bình luận của quản trị viên.', 'FORBIDDEN_ACTION');
    await this.prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id }, data: { status, moderatedById: a.user.id } });
      if (status !== 'APPROVED') {
        // Taking a comment down settles every open report about it (and clears the notifications for the other staff).
        const now = new Date();
        await tx.commentReport.updateMany({
          where: { commentId: id, status: { in: ['OPEN', 'IN_REVIEW'] } },
          data: { status: 'RESOLVED', handledById: a.user.id, handledAt: now, resolution: 'REMOVE_COMMENT' },
        });
        await tx.notification.updateMany({ where: { type: 'comment.reported', readAt: null, data: { path: ['commentId'], equals: id } }, data: { readAt: now } });
      }
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'comment.moderate', resourceType: 'comment', resourceId: id, metadata: { status } }, tx);
    });
    return { id, status };
  }
}
