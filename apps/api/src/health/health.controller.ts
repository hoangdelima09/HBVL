import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient } from '@hbvl/database';
import type { Response } from 'express';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: the process is up. Never touches dependencies (a DB outage must not restart healthy pods). */
  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies required to serve traffic. Returns 503 when any is down so the proxy stops routing here. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, 'up' | 'down'> = { database: 'down', redis: 'down' };
    await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => (checks.database = 'up')).catch(() => undefined),
      this.redis
        .ping()
        .then((ok) => (checks.redis = ok ? 'up' : 'down'))
        .catch(() => undefined),
    ]);
    const ok = Object.values(checks).every((v) => v === 'up');
    if (!ok) res.status(503);
    res.setHeader('Cache-Control', 'no-store');
    return { status: ok ? 'ok' : 'degraded', checks };
  }
}
