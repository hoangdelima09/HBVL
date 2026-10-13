import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Cache for PUBLIC read models only (never session/draft/inbox data).
 * Invalidation is a namespace-version bump: O(1), safe across instances, and unpublish/edit makes old entries unreachable immediately.
 */
@Injectable()
export class CacheService {
  constructor(private readonly redis: RedisService) {}

  private readonly NS_KEY = 'cache:ns:public';

  private async ns(): Promise<string> {
    return (await this.redis.client.get(this.NS_KEY)) ?? '0';
  }

  async wrap<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    let fullKey: string;
    try {
      fullKey = `cache:pub:${await this.ns()}:${key}`;
      const hit = await this.redis.client.get(fullKey);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch {
      return loader(); // Redis down: serve from the database
    }
    const value = await loader();
    try {
      await this.redis.client.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* best effort */
    }
    return value;
  }

  /** Called after publish/unpublish/edit/delete/settings changes (inline for read-your-writes; the worker repeats it via the outbox). */
  async invalidatePublic(): Promise<void> {
    await this.redis.client.incr(this.NS_KEY);
  }
}
