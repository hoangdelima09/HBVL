import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type AuditResult, type Role } from '@hbvl/database';
import { ENV, type Env } from '../config/env';
import { hashIp } from '../common/ip';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: Role | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result?: AuditResult;
  requestId?: string;
  ip?: string;
  /** Filtered metadata only: ids, statuses, counts. Never passwords, tokens, message bodies or e-mail addresses. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Append-only (the table rejects UPDATE/DELETE/TRUNCATE at the database level). Pass `tx` to commit atomically with the action. */
  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        result: entry.result ?? 'SUCCESS',
        requestId: entry.requestId,
        ipHash: entry.ip ? hashIp(entry.ip, this.env.TOKEN_HASH_PEPPER) : null,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
