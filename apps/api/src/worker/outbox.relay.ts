import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@hbvl/database';
import { Queue } from 'bullmq';
import { CacheService } from '../cache/cache.service';
import { ENV, type Env } from '../config/env';
import { bullConnection, EMAIL_QUEUE } from './queue';

interface Claimed {
  id: string;
  type: string;
  attempts: number;
}

/**
 * Transactional-outbox relay. Rows were committed together with the business change; this loop moves them to the queue.
 * `FOR UPDATE SKIP LOCKED` makes multiple worker replicas safe; BullMQ `jobId = outbox id` makes enqueueing idempotent.
 * If Redis/BullMQ is down the rows go back to PENDING and are retried — nothing is lost.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('OutboxRelay');
  private queue!: Queue;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: CacheService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap() {
    this.queue = new Queue(EMAIL_QUEUE, { connection: bullConnection(this.env.REDIS_URL) });
    this.queue.on('error', (e) => this.log.warn(`queue error: ${e.message}`));
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 50));
    await this.queue?.close();
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const claimed = await this.prisma.$queryRaw<Claimed[]>`
        UPDATE outbox_events SET status = 'PROCESSING', "lockedAt" = now(), attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM outbox_events WHERE status IN ('PENDING', 'FAILED') AND "availableAt" <= now()
          ORDER BY "availableAt" ASC, id ASC LIMIT 50 FOR UPDATE SKIP LOCKED
        ) RETURNING id, type, attempts`;
      for (const ev of claimed) await this.dispatch(ev);
      return claimed.length;
    } catch (e) {
      this.log.warn(`relay tick failed: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async dispatch(ev: Claimed) {
    try {
      if (ev.type === 'EMAIL_SEND') {
        await this.queue.add(
          'send',
          { outboxId: ev.id },
          { jobId: ev.id, attempts: this.env.EMAIL_ATTEMPTS, backoff: { type: 'exponential', delay: this.env.EMAIL_BACKOFF_MS }, removeOnComplete: 1000, removeOnFail: false },
        );
      } else if (ev.type === 'CACHE_INVALIDATE') {
        await this.cache.invalidatePublic();
        await this.prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: 'DONE', processedAt: new Date() } });
      } else {
        await this.prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: 'DONE', processedAt: new Date(), lastError: `no handler for ${ev.type}` } });
      }
    } catch (e) {
      // Could not enqueue (Redis down, …): release the row with a short delay; attempts counter is not a delivery attempt yet.
      await this.prisma.outboxEvent.update({
        where: { id: ev.id },
        data: { status: 'FAILED', availableAt: new Date(Date.now() + 10_000), attempts: Math.max(0, ev.attempts - 1), lastError: (e as Error).message.slice(0, 480) },
      });
    }
  }
}
