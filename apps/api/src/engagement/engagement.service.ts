import { Injectable } from '@nestjs/common';
import { LIMITS } from '@hbvl/contracts';
import { Prisma, PrismaClient, type CommentStatus } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';
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
  async listPublic(postId: string) {
    const post = await this.prisma.post.findFirst({ where: publishedPost(postId), select: { id: true } });
    if (!post) throw E.notFound();
    const rows = await this.prisma.comment.findMany({
      where: { postId, status: 'APPROVED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
      select: { id: true, parentId: true, depth: true, body: true, authorName: true, createdAt: true, author: { select: { role: true } } },
    });
    return {
      items: rows.map((r) => ({ id: r.id, parentId: r.parentId, depth: r.depth, body: r.body, author: r.authorName, authorRole: r.author?.role ?? null, createdAt: r.createdAt })),
    };
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
