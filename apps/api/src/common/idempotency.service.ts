import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@hbvl/database';
import { E } from './errors';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  resourceId?: string;
}

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : val,
  );

/**
 * Durable idempotency (unique actor + operation + key, plus request hash).
 * The key row, the business write and the stored response are committed in ONE transaction, so:
 *  - a retry with the same payload replays the stored response;
 *  - the same key with another payload is rejected (422);
 *  - two concurrent requests serialise on the unique index: the loser sees the winner's committed row and replays it,
 *    so exactly one resource/transition is created.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaClient) {}

  static validateKey(key: string | undefined): string {
    if (!key || key.length < 8 || key.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
      throw E.validation([{ path: 'Idempotency-Key', message: 'Idempotency-Key header (8–100 ký tự) là bắt buộc.' }]);
    }
    return key;
  }

  async run<T>(
    actorId: string,
    operation: string,
    key: string,
    payload: unknown,
    handler: (tx: Prisma.TransactionClient) => Promise<IdempotentResult<T>>,
  ): Promise<IdempotentResult<T> & { replayed: boolean }> {
    const requestHash = createHash('sha256').update(canonical(payload)).digest('hex');
    return this.prisma.$transaction(
      async (tx) => {
        const inserted = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_records (id, "actorId", operation, key, "requestHash", status, "createdAt", "expiresAt")
          VALUES (gen_random_uuid(), ${actorId}::uuid, ${operation}, ${key}, ${requestHash}, 'IN_PROGRESS', now(), now() + interval '24 hours')
          ON CONFLICT ("actorId", operation, key) DO NOTHING
          RETURNING id`;
        if (inserted.length === 0) {
          const existing = await tx.idempotencyRecord.findUnique({ where: { actorId_operation_key: { actorId, operation, key } } });
          if (!existing) throw E.conflict('Yêu cầu đang được xử lý. Vui lòng thử lại.', 'REQUEST_IN_PROGRESS');
          if (existing.requestHash !== requestHash) throw E.idempotencyReused();
          if (existing.status !== 'COMPLETED') throw E.conflict('Yêu cầu đang được xử lý. Vui lòng thử lại.', 'REQUEST_IN_PROGRESS');
          return { status: existing.responseStatus ?? 200, body: existing.responseBody as T, resourceId: existing.resourceId ?? undefined, replayed: true };
        }
        const result = await handler(tx);
        await tx.idempotencyRecord.update({
          where: { id: inserted[0]!.id },
          data: { status: 'COMPLETED', responseStatus: result.status, responseBody: result.body as Prisma.InputJsonValue, resourceId: result.resourceId },
        });
        return { ...result, replayed: false };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  }
}
