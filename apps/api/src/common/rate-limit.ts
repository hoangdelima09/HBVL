import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../config/env';
import { RedisService } from '../redis/redis.service';
import { E } from './errors';
import { clientIp } from './ip';

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
  /** ip: per client IP · actor: per logged-in user (falls back to IP) · both: enforce both */
  scope?: 'ip' | 'actor' | 'both';
}
const META = 'hbvl:ratelimit';

export const RateLimit = (...rules: RateLimitRule[]) => applyDecorators(SetMetadata(META, rules), UseGuards(RateLimitGuard));

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.env.THROTTLE_DISABLED && this.env.NODE_ENV !== 'production') return true;
    const rules = Reflect.getMetadata(META, context.getHandler()) as RateLimitRule[] | undefined;
    if (!rules?.length) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const ip = clientIp(req);
    const actor = req.auth?.user.id;
    for (const r of rules) {
      const keys: string[] = [];
      const scope = r.scope ?? 'ip';
      if (scope === 'ip' || scope === 'both' || !actor) keys.push(`rl:${r.name}:ip:${ip}`);
      if ((scope === 'actor' || scope === 'both') && actor) keys.push(`rl:${r.name}:u:${actor}`);
      for (const key of keys) {
        const res = await this.redis.hit(key, Math.ceil(r.limit * this.env.RATE_LIMIT_MULTIPLIER), r.windowSeconds);
        if (!res.allowed) throw E.rateLimited(res.retryAfter);
      }
    }
    return true;
  }
}

/** Global safety net applied by middleware: generous per-IP ceiling for every request. */
export function globalRateLimit(redis: RedisService, env: Env, limitPerMinute = 600) {
  return async (req: Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (env.THROTTLE_DISABLED && env.NODE_ENV !== 'production') return next();
    try {
      const r = await redis.hit(`rl:global:ip:${clientIp(req)}`, limitPerMinute, 60);
      if (!r.allowed) {
        res.setHeader('Retry-After', String(r.retryAfter));
        res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.', requestId: (req as { id?: string }).id } });
        return;
      }
    } catch {
      /* Redis unavailable: fail open for reads; write endpoints have their own guards that fail closed */
    }
    next();
  };
}
