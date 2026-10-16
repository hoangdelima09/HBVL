import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type AuthTokenPurpose } from '@hbvl/database';
import { ENV, type Env } from '../config/env';
import { hmacHex, randomCode, randomToken, safeEqual } from './crypto';

/** One-time, hashed, expiring tokens for e-mail verification, password reset and account activation. Each carries a link token and a short code. */
@Injectable()
export class TokenService {
  /** Wrong guesses allowed per code. 5 / 10^6 ⇒ a stolen-session or e-mail-less attacker has a 0.0005 % chance per issued code. */
  static readonly MAX_CODE_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private hash(token: string): string {
    return hmacHex(this.env.TOKEN_HASH_PEPPER, token);
  }

  /** The code is bound to the user and purpose, so a code for one purpose can never be replayed for another. */
  private codeHash(userId: string, purpose: AuthTokenPurpose, code: string): string {
    return hmacHex(this.env.TOKEN_HASH_PEPPER, `code:${userId}:${purpose}:${code}`);
  }

  /** Issues a token and invalidates earlier unused tokens of the same purpose for the user. Returns the raw link token and the 6-digit code (both shown only in the e-mail). */
  async issue(
    tx: Prisma.TransactionClient | undefined,
    userId: string,
    purpose: AuthTokenPurpose,
    ttlMs: number,
    opts: { withCode?: boolean } = {},
  ): Promise<{ raw: string; code: string }> {
    const db = tx ?? this.prisma;
    await db.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    const raw = randomToken(32);
    // Link-only tokens (administrators) store no code at all, so no 6-digit guess can ever match them.
    const withCode = opts.withCode ?? true;
    const code = withCode ? randomCode() : '';
    await db.authToken.create({
      data: { userId, purpose, tokenHash: this.hash(raw), codeHash: withCode ? this.codeHash(userId, purpose, code) : null, expiresAt: new Date(Date.now() + ttlMs) },
    });
    return { raw, code };
  }

  /**
   * Consumes the user's newest live token if `code` matches. A guess is *reserved* (attempts + 1, atomically, outside any caller transaction so it
   * survives a rollback) before it is compared, so concurrent guesses cannot exceed MAX_CODE_ATTEMPTS. Returns the purpose or null.
   */
  async consumeCode(userId: string, purposes: AuthTokenPurpose[], code: string, tx?: Prisma.TransactionClient): Promise<{ userId: string; purpose: AuthTokenPurpose } | null> {
    const row = await this.prisma.authToken.findFirst({
      where: { userId, purpose: { in: purposes }, usedAt: null, expiresAt: { gt: new Date() }, codeHash: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    const reserved = await this.prisma.authToken.updateMany({
      where: { id: row.id, usedAt: null, attempts: { lt: TokenService.MAX_CODE_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (reserved.count !== 1) return null; // already burned
    if (!safeEqual(row.codeHash!, this.codeHash(userId, row.purpose, code))) {
      await this.prisma.authToken.updateMany({ where: { id: row.id, attempts: { gte: TokenService.MAX_CODE_ATTEMPTS } }, data: { usedAt: new Date() } });
      return null;
    }
    const db = tx ?? this.prisma;
    const r = await db.authToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    return r.count === 1 ? { userId, purpose: row.purpose } : null;
  }

  /** Atomically consumes a token (single use even under concurrency). Returns the user id or null. */
  async consume(raw: string, purposes: AuthTokenPurpose[], tx?: Prisma.TransactionClient): Promise<{ userId: string; purpose: AuthTokenPurpose } | null> {
    const db = tx ?? this.prisma;
    const hash = this.hash(raw);
    const row = await db.authToken.findUnique({ where: { tokenHash: hash } });
    if (!row || !purposes.includes(row.purpose) || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
    const r = await db.authToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    return r.count === 1 ? { userId: row.userId, purpose: row.purpose } : null;
  }
}
