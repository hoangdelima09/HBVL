import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@hbvl/database';
import { encrypt } from '../auth/crypto';
import { ENV, type Env } from '../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Opaque category for metrics/diagnostics, e.g. VERIFY_EMAIL, CONTACT_NOTIFY. */
  kind: string;
}

export interface EnqueueOptions {
  aggregateType: string;
  aggregateId: string;
  dedupeKey?: string;
  availableAt?: Date;
}

/**
 * Transactional outbox: rows are written in the SAME database transaction as the business change, so a crash or a Redis/SMTP outage
 * can never lose a notification. The worker relays them to the queue and delivers with retry/backoff.
 */
@Injectable()
export class OutboxService {
  constructor(
    private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** E-mail bodies can contain one-time links, so the payload is encrypted at rest and scrubbed after delivery. */
  async enqueueEmail(tx: Prisma.TransactionClient | undefined, msg: EmailMessage, opts: EnqueueOptions): Promise<void> {
    const db = tx ?? this.prisma;
    await db.outboxEvent.create({
      data: {
        type: 'EMAIL_SEND',
        aggregateType: opts.aggregateType,
        aggregateId: opts.aggregateId,
        dedupeKey: opts.dedupeKey,
        availableAt: opts.availableAt,
        payload: { kind: msg.kind, enc: encrypt(JSON.stringify(msg), this.env.MFA_ENCRYPTION_KEY) },
      },
    });
  }

  /** Invalidate public caches after content changes (consumed by the worker AND applied inline for read-your-writes). */
  async enqueueCacheInvalidation(tx: Prisma.TransactionClient | undefined, scope: string, aggregateId: string): Promise<void> {
    const db = tx ?? this.prisma;
    await db.outboxEvent.create({
      data: { type: 'CACHE_INVALIDATE', aggregateType: scope, aggregateId, payload: { scope } },
    });
  }
}
