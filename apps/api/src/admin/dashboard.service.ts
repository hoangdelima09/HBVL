import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@hbvl/database';
import type { AuthContext } from '../auth/auth.types';

const group = <T extends { _count: { _all: number } }>(rows: (T & Record<string, unknown>)[], key: string) => Object.fromEntries(rows.map((r) => [String(r[key]), r._count._all]));

/** Every figure is a live query; each role only receives what that role may see. */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async staff(a: AuthContext) {
    const collab = a.user.role === 'COLLABORATOR';
    const [pending, feedbackNew, commentsPending, spam, reviewedByMe, openReports] = await Promise.all([
      this.prisma.post.count({
        where: { kind: 'POST', status: 'PENDING_REVIEW', ...(collab ? { authorId: { not: a.user.id }, NOT: { author: { is: { role: 'ADMIN' } } } } : {}) },
      }),
      this.prisma.feedback.count({ where: { status: 'NEW' } }),
      this.prisma.comment.count({ where: { status: 'PENDING' } }),
      this.prisma.comment.count({ where: { status: 'SPAM' } }),
      this.prisma.reviewEvent.count({ where: { actorId: a.user.id, action: { in: ['REQUEST_CHANGES', 'STAFF_EDIT'] } } }),
      // Reports are grouped per comment; a collaborator does not see (or count) reports about an administrator's comments.
      this.prisma.commentReport
        .groupBy({
          by: ['commentId'],
          where: { status: { in: ['OPEN', 'IN_REVIEW'] }, ...(collab ? { comment: { NOT: { author: { is: { role: 'ADMIN' } } } } } : {}) },
        })
        .then((g) => g.length),
    ]);
    const oldest = await this.prisma.post.findFirst({ where: { kind: 'POST', status: 'PENDING_REVIEW' }, orderBy: { submittedAt: 'asc' }, select: { submittedAt: true } });
    return { pendingReview: pending, feedbackNew, commentsPending, commentsSpam: spam, reviewedByMe, openReports, oldestPendingSince: oldest?.submittedAt ?? null };
  }

  async admin(a: AuthContext) {
    const [users, posts, feedback, contact, comments, members, outbox, mailFailed, recent] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.post.groupBy({ by: ['status'], where: { kind: 'POST' }, _count: { _all: true } }),
      this.prisma.feedback.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.contactMessage.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.comment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.scholarshipMember.count({ where: { status: 'ACTIVE' } }),
      this.prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.contactMessage.count({ where: { mailState: 'FAILED' } }),
      this.prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 10, select: { id: true, at: true, action: true, resourceType: true, result: true, actorRole: true } }),
    ]);
    const pendingUsers = await this.prisma.user.count({ where: { status: 'PENDING_RESET' } });
    const openReports = (await this.prisma.commentReport.groupBy({ by: ['commentId'], where: { status: { in: ['OPEN', 'IN_REVIEW'] } } })).length;
    return {
      openReports,
      users: group(users, 'role'),
      posts: group(posts, 'status'),
      feedback: group(feedback, 'status'),
      contact: group(contact, 'status'),
      comments: group(comments, 'status'),
      members,
      outbox: group(outbox, 'status'),
      contactMailFailed: mailFailed,
      accountsAwaitingActivation: pendingUsers,
      recentAudit: recent.map((r) => ({ ...r, id: String(r.id) })),
      generatedFor: a.user.id,
    };
  }

  async audit(q: { action?: string; resourceType?: string; page: number; pageSize: number }) {
    const where = { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.resourceType ? { resourceType: q.resourceType } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: rows.map((r) => ({ ...r, id: String(r.id) })), page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async migration() {
    const runs = await this.prisma.migrationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 });
    const issues = await this.prisma.migrationIssue.groupBy({ by: ['runId', 'severity', 'code'], _count: { _all: true } });
    return { runs, issues: issues.map((i) => ({ runId: i.runId, severity: i.severity, code: i.code, count: i._count._all })) };
  }
}
