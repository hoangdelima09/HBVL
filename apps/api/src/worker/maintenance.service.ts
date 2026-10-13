import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@hbvl/database';
import { CacheService } from '../cache/cache.service';
import { ENV, type Env } from '../config/env';
import { MediaService } from '../media/media.service';

/** Periodic housekeeping, guarded by a Postgres advisory lock so only one worker replica runs it at a time. */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Maintenance');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: CacheService,
    private readonly media: MediaService,
    @Inject(ENV) _env: Env,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.run().catch((e) => this.log.warn((e as Error).message)), 60_000);
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<Record<string, number>> {
    const got = await this.prisma.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(727001) AS ok`;
    if (!got[0]?.ok) return {};
    try {
      const out: Record<string, number> = {};
      // Outbox rows stuck in PROCESSING (worker crashed between claim and enqueue) go back to the queue.
      out.outboxRecovered = await this.prisma
        .$executeRaw`UPDATE outbox_events SET status = 'PENDING' WHERE status = 'PROCESSING' AND "lockedAt" < now() - interval '15 minutes' AND type <> 'EMAIL_SEND'`;
      // Staged uploads that never got attached (upload succeeded but the post save did not) are removed with their objects.
      const stale = await this.prisma.mediaAsset.findMany({ where: { status: 'STAGED', createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } }, take: 100 });
      for (const a of stale) {
        await this.media.deleteObjects(a);
        await this.prisma.mediaAsset.update({ where: { id: a.id }, data: { status: 'DELETED', deletedAt: new Date() } });
      }
      out.stagedMediaDeleted = stale.length;
      out.sessionsDeleted = (
        await this.prisma.session.deleteMany({
          where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 7 * 86400_000) } }, { revokedAt: { lt: new Date(Date.now() - 7 * 86400_000) } }] },
        })
      ).count;
      out.tokensDeleted = (await this.prisma.authToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400_000) } } })).count;
      out.idempotencyDeleted = (await this.prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
      // Scheduled posts (legacy `future`) go live when their time comes.
      const due = await this.prisma.post.updateMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
      out.scheduledPublished = due.count;
      if (due.count) await this.cache.invalidatePublic();
      return out;
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(727001)`;
    }
  }
}
