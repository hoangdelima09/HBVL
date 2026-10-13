import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient, type Role } from '@hbvl/database';
import { ENV, type Env } from '../config/env';
import { hashIp } from '../common/ip';
import { hmacHex, randomToken } from './crypto';
import type { AuthContext, AuthUser } from './auth.types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** [idle timeout, absolute lifetime] per role & remember-me. Privileged roles get tighter windows. */
function lifetimes(role: Role, rememberMe: boolean): [number, number] {
  if (role === 'ADMIN') return [60 * MIN, 12 * HOUR];
  if (role === 'COLLABORATOR') return rememberMe ? [7 * DAY, 30 * DAY] : [4 * HOUR, 24 * HOUR];
  return rememberMe ? [14 * DAY, 30 * DAY] : [8 * HOUR, 24 * HOUR];
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private hashToken(token: string): string {
    return hmacHex(this.env.TOKEN_HASH_PEPPER, token);
  }

  async create(
    user: { id: string; role: Role },
    opts: { rememberMe: boolean; ip: string; userAgent?: string; mfaVerified: boolean },
  ): Promise<{ token: string; sessionId: string; persistentMs: number | null }> {
    const token = randomToken(32);
    const [idle, absolute] = lifetimes(user.role, opts.rememberMe);
    const now = Date.now();
    const row = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        csrfSalt: randomToken(12).slice(0, 32),
        expiresAt: new Date(now + absolute),
        idleExpiresAt: new Date(now + idle),
        rememberMe: opts.rememberMe,
        mfaVerifiedAt: opts.mfaVerified ? new Date(now) : null,
        ipHash: hashIp(opts.ip, this.env.TOKEN_HASH_PEPPER),
        userAgent: opts.userAgent?.slice(0, 255),
      },
      select: { id: true },
    });
    return { token, sessionId: row.id, persistentMs: opts.rememberMe ? absolute : null };
  }

  /** Resolve a cookie token. The user row is read on every request, so role/status changes apply immediately. */
  async resolve(token: string): Promise<AuthContext | null> {
    const s = await this.prisma.session.findUnique({ where: { tokenHash: this.hashToken(token) }, include: { user: true } });
    if (!s || s.revokedAt) return null;
    const now = Date.now();
    if (s.expiresAt.getTime() <= now || s.idleExpiresAt.getTime() <= now) return null;
    const u = s.user;
    if (u.status !== 'ACTIVE' || u.deletedAt) return null;

    if (now - s.lastSeenAt.getTime() > MIN) {
      const [idle] = lifetimes(u.role, s.rememberMe);
      const idleExpiresAt = new Date(Math.min(now + idle, s.expiresAt.getTime()));
      // best-effort sliding window; a failed touch must not fail the request
      await this.prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(now), idleExpiresAt } }).catch(() => undefined);
    }
    return {
      user: toAuthUser(u),
      session: { id: s.id, mfaVerifiedAt: s.mfaVerifiedAt, rememberMe: s.rememberMe, expiresAt: s.expiresAt },
    };
  }

  async markMfaVerified(sessionId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: new Date() } });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const r = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    return r.count;
  }

  listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true, rememberMe: true },
    });
  }
}

export function toAuthUser(u: {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: Role;
  status: AuthUser['status'];
  emailVerifiedAt: Date | null;
  mfaEnabled: boolean;
  locale: string;
  mustChangePassword?: boolean;
  restrictedAt?: Date | null;
  restrictedUntil?: Date | null;
  restrictionReason?: string | null;
}): AuthUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    emailVerifiedAt: u.emailVerifiedAt,
    mfaEnabled: u.mfaEnabled,
    locale: u.locale === 'en' ? 'en' : u.locale === 'ja' ? 'ja' : 'vi',
    mustChangePassword: u.mustChangePassword ?? false,
    restrictedAt: u.restrictedAt ?? null,
    restrictedUntil: u.restrictedUntil ?? null,
    restrictionReason: u.restrictionReason ?? null,
  };
}
