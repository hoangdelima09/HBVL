import { Injectable } from '@nestjs/common';
import { LIMITS } from '@hbvl/contracts';
import { Prisma, PrismaClient, type FeedbackStatus } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';
import { RedisService } from '../redis/redis.service';

/**
 * Member feedback inbox. Visible to COLLABORATOR + ADMIN only — never through search, counts or exports available to members.
 * The sender's original text is immutable; staff work is recorded as status history with separate internal notes.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async submit(a: AuthContext, input: { subject: string; message: string; website?: string }) {
    if (input.website) return { id: null, received: true }; // honeypot: pretend success, store nothing
    // Cooldown is reserved atomically BEFORE writing so parallel requests cannot both pass; released if the write fails.
    const lockKey = `cooldown:feedback:${a.user.id}`;
    const got = await this.redis.client.set(lockKey, '1', 'EX', LIMITS.submitCooldownSeconds, 'NX');
    if (got !== 'OK') throw E.rateLimited(Math.max(await this.redis.client.ttl(lockKey), 1));
    try {
      const f = await this.prisma.$transaction(async (tx) => {
        const row = await tx.feedback.create({ data: { authorId: a.user.id, subject: input.subject, message: input.message }, select: { id: true } });
        await tx.feedbackStatusHistory.create({ data: { feedbackId: row.id, actorId: a.user.id, fromStatus: null, toStatus: 'NEW' } });
        await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'feedback.create', resourceType: 'feedback', resourceId: row.id }, tx);
        // In-app alert for every collaborator and administrator; it disappears for a person once they have read the feedback.
        const staff = await tx.user.findMany({
          where: { role: { in: ['ADMIN', 'COLLABORATOR'] }, status: 'ACTIVE', deletedAt: null, id: { not: a.user.id } },
          select: { id: true },
        });
        if (staff.length) {
          await tx.notification.createMany({
            data: staff.map((u) => ({
              userId: u.id,
              type: 'feedback.new',
              title: `Ý kiến mới từ ${a.user.displayName}: "${input.subject.length > 80 ? `${input.subject.slice(0, 80)}…` : input.subject}"`,
              data: { feedbackId: row.id },
            })),
          });
        }
        return row;
      });
      return { id: f.id, received: true };
    } catch (e) {
      await this.redis.client.del(lockKey);
      throw e;
    }
  }

  async list(q: { status?: FeedbackStatus; page: number; pageSize: number }) {
    const where: Prisma.FeedbackWhereInput = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, subject: true, status: true, createdAt: true, author: { select: { id: true, displayName: true } }, message: true },
      }),
    ]);
    return {
      items: rows.map((r) => ({ id: r.id, subject: r.subject, status: r.status, createdAt: r.createdAt, author: r.author, preview: r.message.slice(0, 160) })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async counts() {
    const rows = await this.prisma.feedback.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  /** Opening a feedback is reading it: that person's alert for it is cleared. */
  async get(a: AuthContext, id: string) {
    const f = await this.prisma.feedback.findUnique({
      where: { id },
      select: {
        id: true,
        subject: true,
        message: true,
        status: true,
        createdAt: true,
        author: { select: { id: true, displayName: true, email: true } },
        history: { orderBy: { createdAt: 'asc' }, select: { id: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actorId: true } },
      },
    });
    if (!f) throw E.notFound();
    await this.prisma.notification.updateMany({
      where: { userId: a.user.id, type: 'feedback.new', readAt: null, data: { path: ['feedbackId'], equals: id } },
      data: { readAt: new Date() },
    });
    return f;
  }

  async setStatus(a: AuthContext, id: string, status: FeedbackStatus, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.feedback.findUnique({ where: { id }, select: { status: true } });
      if (!cur) throw E.notFound();
      await tx.feedback.update({ where: { id }, data: { status } });
      await tx.feedbackStatusHistory.create({ data: { feedbackId: id, actorId: a.user.id, fromStatus: cur.status, toStatus: status, note: note || null } });
      await this.audit.log(
        { actorId: a.user.id, actorRole: a.user.role, action: 'feedback.status', resourceType: 'feedback', resourceId: id, metadata: { from: cur.status, to: status } },
        tx,
      );
      return { id, status };
    });
  }
}
