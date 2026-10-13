import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env';

/** Thin wrapper over ioredis: shared client + atomic fixed-window rate limiting + versioned cache namespaces. */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false });
    this.client.on('error', () => undefined); // surfaced through health checks / command rejections
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  /**
   * Fixed-window counter. Returns { allowed, count, retryAfter }.
   * INCR + EXPIRE are applied atomically via a Lua script so a crash can never leave an immortal key.
   */
  async hit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; count: number; retryAfter: number }> {
    const res = (await this.client.eval(
      `local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return {c, redis.call('TTL', KEYS[1])}`,
      1,
      key,
      windowSeconds,
    )) as [number, number];
    const [count, ttl] = res;
    return { allowed: count <= limit, count, retryAfter: Math.max(ttl, 1) };
  }

  async onApplicationShutdown() {
    await this.client.quit().catch(() => undefined);
  }
}
