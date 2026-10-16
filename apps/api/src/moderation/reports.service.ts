import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type ReportReason, type ReportStatus } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { commentReportedMail } from '../mail/templates';
import { OutboxService } from '../outbox/outbox.service';
import { UserModerationService } from './user-moderation.service';

type Tx = Prisma.TransactionClient;
export type ReportAction = 'DISMISS' | 'REMOVE_COMMENT' | 'REMOVE_AND_RESTRICT' | 'REMOVE_AND_BLOCK';

const REASON_LABEL: Record<ReportReason, string> = {
  SPAM: 'Spam / quảng cáo',
  ABUSE: 'Xúc phạm, quấy rối',
  HATE: 'Thù ghét, phân biệt',
  MISINFO: 'Thông tin sai lệch',
  OTHER: 'Lý do khác',
};
const OPEN: ReportStatus[] = ['OPEN', 'IN_REVIEW'];
const snippet = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/**
 * Comment reports. Everything that matters is serialised per comment (advisory lock), so "who saw it first handles it" is exact:
 * the second staff member to act gets a 409 naming who already did, and never double-applies an action.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly users: UserModerationService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private lock(tx: Tx, commentId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'report:' + commentId}))`;
  }

  // ───── member side ─────
  async report(a: AuthContext, commentId: string, input: { reason: ReportReason; note?: string }) {
    const c = await this.prisma.comment.findFirst({
      where: { id: commentId, status: 'APPROVED', post: { status: 'PUBLISHED', deletedAt: null } },
      select: { id: true, body: true, authorId: true, post: { select: { id: true, title: true } }, author: { select: { role: true } } },
    });
    if (!c) throw E.notFound('Không tìm thấy bình luận.');
    if (c.authorId === a.user.id) throw E.validation([{ path: 'commentId', message: 'Bạn không thể tố cáo bình luận của chính mình.' }]);

    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, commentId);
      const dupe = await tx.commentReport.findFirst({ where: { commentId, reporterId: a.user.id }, select: { id: true } });
      if (dupe) return { reported: true, duplicate: true }; // idempotent: reporting twice is not an error
      const alreadyOpen = await tx.commentReport.count({ where: { commentId, status: { in: OPEN } } });
      const r = await tx.commentReport.create({ data: { commentId, reporterId: a.user.id, reason: input.reason, note: input.note || null }, select: { id: true } });
      // Staff are notified once per comment: later reports join the same open item instead of paging everyone again.
      if (!alreadyOpen) {
        const staff = await tx.user.findMany({
          where: {
            status: 'ACTIVE',
            deletedAt: null,
            role: c.author?.role === 'ADMIN' ? 'ADMIN' : { in: ['ADMIN', 'COLLABORATOR'] },
            id: { notIn: [a.user.id, ...(c.authorId ? [c.authorId] : [])] },
          },
          select: { id: true, role: true, displayName: true, email: true },
        });
        if (staff.length) {
          await tx.notification.createMany({
            data: staff.map((u) => ({
              userId: u.id,
              type: 'comment.reported',
              title: `Bình luận bị tố cáo: "${snippet(c.body)}"`,
              body: `${REASON_LABEL[input.reason]} · bài "${snippet(c.post.title, 80)}"`,
              data: { commentId, postId: c.post.id, reportId: r.id },
            })),
          });
        }
        // Collaborators also get an e-mail (they may not be signed in). Administrators keep the in-app alert only. Reports about an
        // administrator's comment never reach collaborators (the query above already left them out). Sent through the outbox, deduplicated.
        const link = `${this.env.PUBLIC_ORIGIN.replace(/\/$/, '')}/cong-tac-vien/to-cao`;
        for (const u of staff.filter((s) => s.role === 'COLLABORATOR')) {
          const mail = commentReportedMail({ name: u.displayName, reason: REASON_LABEL[input.reason], comment: snippet(c.body, 300), postTitle: snippet(c.post.title, 120), link });
          await this.outbox.enqueueEmail(
            tx,
            { to: u.email, kind: 'COMMENT_REPORTED', ...mail },
            { aggregateType: 'comment', aggregateId: commentId, dedupeKey: `comment-reported-${r.id}-${u.id}` },
          );
        }
      }
      return { reported: true, duplicate: false };
    });
  }

  // ───── staff side ─────
  /** Collaborators never see (nor can act on) reports about an administrator's comments. */
  private scope(a: AuthContext): Prisma.CommentReportWhereInput {
    return a.user.role === 'COLLABORATOR' ? { comment: { NOT: { author: { is: { role: 'ADMIN' } } } } } : {};
  }

  async openCount(a: AuthContext): Promise<number> {
    const rows = await this.prisma.commentReport.groupBy({ by: ['commentId'], where: { status: { in: OPEN }, ...this.scope(a) } });
    return rows.length;
  }

  async list(a: AuthContext, q: { scope: 'open' | 'closed'; page: number; pageSize: number }) {
    const where: Prisma.CommentReportWhereInput = {
      status: { in: q.scope === 'open' ? OPEN : ['RESOLVED', 'DISMISSED'] },
      ...this.scope(a),
    };
    const groups = await this.prisma.commentReport.groupBy({
      by: ['commentId'],
      where,
      _min: { createdAt: true },
      _max: { handledAt: true },
      _count: { _all: true },
      orderBy: q.scope === 'open' ? { _min: { createdAt: 'asc' } } : { _max: { handledAt: 'desc' } },
      take: 500,
    });
    const page = groups.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const reports = await this.prisma.commentReport.findMany({
      where: { commentId: { in: page.map((g) => g.commentId) }, status: where.status },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        commentId: true,
        reason: true,
        note: true,
        status: true,
        createdAt: true,
        claimedAt: true,
        handledAt: true,
        resolution: true,
        resolutionNote: true,
        reporter: { select: { id: true, username: true, displayName: true } },
        assignedTo: { select: { id: true, displayName: true } },
        handledBy: { select: { id: true, displayName: true } },
      },
    });
    const comments = await this.prisma.comment.findMany({
      where: { id: { in: page.map((g) => g.commentId) } },
      select: {
        id: true,
        body: true,
        status: true,
        authorName: true,
        authorId: true,
        editCount: true,
        author: { select: { role: true, status: true } },
        post: { select: { id: true, title: true, slug: true } },
        // what the comment said before any edit: a reported comment cannot be quietly rewritten to hide what was reported
        revisions: { orderBy: { replacedAt: 'desc' }, take: 20, select: { body: true, writtenAt: true, replacedAt: true } },
      },
    });
    const byComment = new Map(comments.map((c) => [c.id, c]));
    const items = page.map((g) => {
      const rs = reports.filter((r) => r.commentId === g.commentId);
      const c = byComment.get(g.commentId);
      const reasons = rs.reduce<Record<string, number>>((m, r) => ((m[r.reason] = (m[r.reason] ?? 0) + 1), m), {});
      const claimed = rs.find((r) => r.assignedTo);
      const last = [...rs].reverse().find((r) => r.handledAt);
      return {
        commentId: g.commentId,
        status: rs.some((r) => r.status === 'IN_REVIEW') ? 'IN_REVIEW' : (rs[0]?.status ?? 'OPEN'),
        reportCount: g._count._all,
        reasons,
        firstReportedAt: g._min.createdAt,
        assignedTo: claimed?.assignedTo ?? null,
        handledBy: last?.handledBy ?? null,
        handledAt: last?.handledAt ?? null,
        resolution: last?.resolution ?? null,
        resolutionNote: last?.resolutionNote ?? null,
        comment: c
          ? {
              body: c.body,
              status: c.status,
              authorId: c.authorId,
              authorName: c.authorName,
              authorRole: c.author?.role ?? null,
              authorStatus: c.author?.status ?? null,
              post: c.post,
              editCount: c.editCount,
              revisions: c.revisions,
            }
          : null,
        reports: rs.map((r) => ({ id: r.id, reason: r.reason, note: r.note, at: r.createdAt, reporter: r.reporter })),
      };
    });
    return { items, page: q.page, pageSize: q.pageSize, total: groups.length, totalPages: Math.max(1, Math.ceil(groups.length / q.pageSize)) };
  }

  /** The reports a collaborator may act on, or 404. */
  private async openFor(tx: Tx, a: AuthContext, commentId: string) {
    const c = await tx.comment.findUnique({ where: { id: commentId }, select: { id: true, body: true, status: true, authorId: true, author: { select: { role: true } } } });
    if (!c || (a.user.role === 'COLLABORATOR' && c.author?.role === 'ADMIN')) throw E.notFound('Không tìm thấy tố cáo.');
    const open = await tx.commentReport.findMany({
      where: { commentId, status: { in: OPEN } },
      select: { id: true, status: true, assignedToId: true, assignedTo: { select: { displayName: true } } },
    });
    return { c, open };
  }

  private alreadyHandled(): never {
    throw E.conflict('Tố cáo này đã được người khác xử lý.', 'CONFLICT', { reason: 'ALREADY_HANDLED' });
  }

  /** "I'm on it": first to claim wins; everyone else sees who is handling it. Administrators may take over a collaborator's claim. */
  async claim(a: AuthContext, commentId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, commentId);
      const { open } = await this.openFor(tx, a, commentId);
      if (!open.length) this.alreadyHandled();
      const holder = open.find((r) => r.assignedToId && r.assignedToId !== a.user.id);
      if (holder && a.user.role !== 'ADMIN') {
        throw E.conflict(`${holder.assignedTo?.displayName ?? 'Một người'} đang xử lý tố cáo này.`, 'CONFLICT', { reason: 'CLAIMED', by: holder.assignedTo?.displayName });
      }
      await tx.commentReport.updateMany({
        where: { commentId, status: { in: OPEN } },
        data: { status: 'IN_REVIEW', assignedToId: a.user.id, claimedAt: new Date() },
      });
      return { commentId, status: 'IN_REVIEW' as const, assignedTo: { id: a.user.id, displayName: a.user.displayName } };
    });
  }

  async resolve(a: AuthContext, commentId: string, input: { action: ReportAction; days?: number; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, commentId);
      const { c, open } = await this.openFor(tx, a, commentId);
      if (!open.length) this.alreadyHandled();
      const holder = open.find((r) => r.assignedToId && r.assignedToId !== a.user.id);
      if (holder && a.user.role !== 'ADMIN') {
        throw E.conflict(`${holder.assignedTo?.displayName ?? 'Một người'} đang xử lý tố cáo này.`, 'CONFLICT', { reason: 'CLAIMED', by: holder.assignedTo?.displayName });
      }
      const removing = input.action !== 'DISMISS';
      if (removing && c.status !== 'TRASHED') {
        // A collaborator may not touch an administrator's comment (`openFor` already hid it); the same rule as the comment-moderation screen.
        await tx.comment.update({ where: { id: commentId }, data: { status: 'TRASHED', moderatedById: a.user.id } });
      }
      if (input.action === 'REMOVE_AND_RESTRICT' || input.action === 'REMOVE_AND_BLOCK') {
        if (!c.authorId) throw E.validation([{ path: 'action', message: 'Tác giả bình luận không còn tồn tại.' }]);
        if (input.action === 'REMOVE_AND_RESTRICT') {
          await this.users.restrictIn(tx, a, c.authorId, { days: input.days, reason: input.note?.trim() || 'Vi phạm quy tắc bình luận.' }, 'report');
        } else {
          await this.users.blockIn(tx, a, c.authorId, { reason: input.note?.trim() || 'Vi phạm quy tắc bình luận.' }, 'report');
        }
      }
      if (removing && c.authorId && input.action === 'REMOVE_COMMENT') {
        await tx.notification.create({
          data: { userId: c.authorId, type: 'comment.removed', title: 'Một bình luận của bạn đã bị gỡ', body: 'Bình luận vi phạm quy tắc cộng đồng.', data: { commentId } },
        });
      }
      const now = new Date();
      await tx.commentReport.updateMany({
        where: { commentId, status: { in: OPEN } },
        data: {
          status: input.action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED',
          handledById: a.user.id,
          handledAt: now,
          resolution: input.action,
          resolutionNote: input.note?.trim() || null,
        },
      });
      // The item disappears from every other staff member's unread list.
      await tx.notification.updateMany({
        where: { type: 'comment.reported', readAt: null, data: { path: ['commentId'], equals: commentId } },
        data: { readAt: now },
      });
      await this.audit.log(
        {
          actorId: a.user.id,
          actorRole: a.user.role,
          action: 'comment.report.resolve',
          resourceType: 'comment',
          resourceId: commentId,
          metadata: { action: input.action, reports: open.length, days: input.days ?? null },
        },
        tx,
      );
      return { commentId, action: input.action, handledBy: { id: a.user.id, displayName: a.user.displayName } };
    });
  }
}
