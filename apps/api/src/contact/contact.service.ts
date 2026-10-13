import { Inject, Injectable } from '@nestjs/common';
import { LIMITS } from '@hbvl/contracts';
import { Prisma, PrismaClient, type ContactStatus } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { contactNotifyMail } from '../mail/templates';
import { OutboxService } from '../outbox/outbox.service';
import { RedisService } from '../redis/redis.service';

/**
 * Contact inbox: ADMIN only. The message is stored FIRST (transactionally with its notification outbox row); e-mail is a notification,
 * never the only copy. The API reports "received" — delivery state is tracked separately and never claimed before it is real.
 */
@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async submit(a: AuthContext, input: { name: string; email: string; subject: string; message: string }) {
    const lockKey = `cooldown:contact:${a.user.id}`;
    const got = await this.redis.client.set(lockKey, '1', 'EX', LIMITS.submitCooldownSeconds, 'NX');
    if (got !== 'OK') throw E.rateLimited(Math.max(await this.redis.client.ttl(lockKey), 1));
    try {
      const subject = input.subject.trim() || 'Liên hệ từ website';
      return await this.prisma.$transaction(async (tx) => {
        const seq = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('contact_receipt_seq') AS n`;
        const n = seq[0]!.n;
        const receiptCode = `LH-${new Date().getUTCFullYear()}-${String(n).padStart(6, '0')}`;
        const c = await tx.contactMessage.create({
          data: { receiptCode, userId: a.user.id, name: input.name, email: input.email, subject, message: input.message, mailState: 'QUEUED' },
          select: { id: true, receiptCode: true },
        });
        await tx.contactStatusHistory.create({ data: { contactId: c.id, actorId: a.user.id, fromStatus: null, toStatus: 'NEW' } });
        const mail = contactNotifyMail({ receiptCode, name: input.name, email: input.email, subject, message: input.message });
        await this.outbox.enqueueEmail(
          tx,
          { to: this.env.CONTACT_INBOX_EMAIL, replyTo: input.email, kind: 'CONTACT_NOTIFY', ...mail },
          { aggregateType: 'contact', aggregateId: c.id, dedupeKey: `contact-${c.id}` },
        );
        await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'contact.create', resourceType: 'contact', resourceId: c.id }, tx);
        return { received: true, receiptCode: c.receiptCode, notification: 'QUEUED' as const };
      });
    } catch (e) {
      await this.redis.client.del(lockKey);
      throw e;
    }
  }

  async list(q: { status?: ContactStatus; page: number; pageSize: number }) {
    const where: Prisma.ContactMessageWhereInput = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.contactMessage.count({ where }),
      this.prisma.contactMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, receiptCode: true, name: true, email: true, subject: true, status: true, mailState: true, createdAt: true },
      }),
    ]);
    return { items: rows, page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async get(id: string) {
    const c = await this.prisma.contactMessage.findUnique({ where: { id }, include: { history: { orderBy: { createdAt: 'asc' } } } });
    if (!c) throw E.notFound();
    return c;
  }

  async setStatus(a: AuthContext, id: string, status: ContactStatus) {
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.contactMessage.findUnique({ where: { id }, select: { status: true } });
      if (!cur) throw E.notFound();
      await tx.contactMessage.update({ where: { id }, data: { status } });
      await tx.contactStatusHistory.create({ data: { contactId: id, actorId: a.user.id, fromStatus: cur.status, toStatus: status } });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'contact.status', resourceType: 'contact', resourceId: id, metadata: { to: status } }, tx);
      return { id, status };
    });
  }
}
