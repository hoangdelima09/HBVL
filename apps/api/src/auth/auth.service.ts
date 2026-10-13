import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type Role } from '@hbvl/database';
import { normalizeEmail, normalizeUsername, safeReturnTo } from '@hbvl/contracts';
import { E } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { resetPasswordMail, verifyEmailMail } from '../mail/templates';
import { RedisService } from '../redis/redis.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { SessionService, toAuthUser } from './session.service';
import { TokenService } from './token.service';
import type { AuthUser } from './auth.types';

const HOUR = 3_600_000;
const MAX_FAILED = 10;
const LOCK_MS = 15 * 60_000;

export interface RequestInfo {
  ip: string;
  userAgent?: string;
  requestId?: string;
}

export interface LoginResult {
  user: AuthUser;
  token: string;
  sessionId: string;
  persistentMs: number | null;
  mfaRequired: boolean;
  redirectTo: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private link(path: string, token: string): string {
    return `${this.env.PUBLIC_ORIGIN.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
  }

  // ───────────── registration (always MEMBER) ─────────────
  async register(input: { displayName: string; username: string; email: string; password: string; website?: string }, req: RequestInfo): Promise<LoginResult> {
    const generic = () => E.conflict('Không thể tạo tài khoản. Tên đăng nhập hoặc email có thể đã được sử dụng.', 'REGISTRATION_FAILED');
    if (input.website) throw generic(); // honeypot
    const username = input.username.trim();
    const email = input.email.trim();
    const usernameNormalized = normalizeUsername(username);
    const emailNormalized = normalizeEmail(email);
    const exists = await this.prisma.user.findFirst({ where: { OR: [{ usernameNormalized }, { emailNormalized }] }, select: { id: true } });
    if (exists) {
      await this.passwords.verifyDummy(input.password); // keep timing similar to the success path
      throw generic();
    }
    const passwordHash = await this.passwords.hash(input.password);
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { username, usernameNormalized, email, emailNormalized, displayName: input.displayName, passwordHash, role: 'MEMBER', status: 'ACTIVE', profile: { create: {} } },
          select: { id: true },
        });
        await this.issueVerification(tx, user.id, input.displayName, email);
        await this.audit.log(
          { actorId: user.id, actorRole: 'MEMBER', action: 'auth.register', resourceType: 'user', resourceId: user.id, requestId: req.requestId, ip: req.ip },
          tx,
        );
        return user.id;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw generic(); // lost a race with a concurrent registration
      throw e;
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const s = await this.sessions.create(user, { rememberMe: true, ip: req.ip, userAgent: req.userAgent, mfaVerified: false });
    return { user: toAuthUser(user), token: s.token, sessionId: s.sessionId, persistentMs: s.persistentMs, mfaRequired: false, redirectTo: '/tai-khoan' };
  }

  private async issueVerification(tx: Prisma.TransactionClient, userId: string, name: string, email: string): Promise<void> {
    const { raw, code } = await this.tokens.issue(tx, userId, 'VERIFY_EMAIL', 48 * HOUR);
    const mail = verifyEmailMail(name, this.link('/xac-minh-email', raw), code);
    await this.outbox.enqueueEmail(tx, { to: email, kind: 'VERIFY_EMAIL', ...mail }, { aggregateType: 'user', aggregateId: userId });
  }

  async resendVerification(auth: AuthUser): Promise<void> {
    if (auth.emailVerifiedAt) return;
    await this.prisma.$transaction((tx) => this.issueVerification(tx, auth.id, auth.displayName, auth.email));
  }

  async verifyEmail(token: string): Promise<void> {
    const ok = await this.prisma.$transaction(async (tx) => {
      const used = await this.tokens.consume(token, ['VERIFY_EMAIL'], tx);
      if (!used) return false;
      await tx.user.update({ where: { id: used.userId }, data: { emailVerifiedAt: new Date() } });
      await this.audit.log({ actorId: used.userId, action: 'auth.verify_email', resourceType: 'user', resourceId: used.userId }, tx);
      return true;
    });
    if (!ok) throw E.tokenInvalid();
  }

  /** Same effect as the e-mailed link, for a signed-in user typing the 6-digit code. */
  async verifyEmailCode(userId: string, code: string): Promise<void> {
    const ok = await this.prisma.$transaction(async (tx) => {
      const used = await this.tokens.consumeCode(userId, ['VERIFY_EMAIL'], code, tx);
      if (!used) return false;
      await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      await this.audit.log({ actorId: userId, action: 'auth.verify_email', resourceType: 'user', resourceId: userId, metadata: { via: 'code' } }, tx);
      return true;
    });
    if (!ok) throw E.codeInvalid();
  }

  // ───────────── login ─────────────
  async login(
    input: { portal: Role; identifier: string; password: string; rememberMe: boolean; returnTo?: string },
    req: RequestInfo,
    previousSessionId?: string,
  ): Promise<LoginResult> {
    const invalid = E.invalidCredentials;
    const identifier = input.identifier.trim();
    const user = await this.prisma.user.findFirst({
      where: identifier.includes('@') ? { emailNormalized: normalizeEmail(identifier) } : { usernameNormalized: normalizeUsername(identifier) },
    });

    if (!user || !user.passwordHash || user.status !== 'ACTIVE' || user.deletedAt) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.log({ action: 'auth.login', resourceType: 'user', result: 'FAILURE', requestId: req.requestId, ip: req.ip, metadata: { reason: 'unknown_or_inactive' } });
      throw invalid();
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw E.accountLocked(Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000));
    }
    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null },
      });
      await this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user.id,
        result: 'FAILURE',
        requestId: req.requestId,
        ip: req.ip,
        metadata: { reason: 'bad_password' },
      });
      throw invalid();
    }
    // Credentials are right, but the account must belong to the portal it signs in through (legacy `charity_portal_accepts_user`).
    if (input.portal !== user.role) {
      await this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user.id,
        result: 'DENIED',
        requestId: req.requestId,
        ip: req.ip,
        metadata: { reason: 'wrong_portal', portal: input.portal },
      });
      throw invalid();
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(input.password) } });
    }
    if (previousSessionId) await this.sessions.revoke(previousSessionId); // rotate: never reuse a pre-login session
    const mfaRequired = user.mfaEnabled;
    const s = await this.sessions.create(user, { rememberMe: input.rememberMe, ip: req.ip, userAgent: req.userAgent, mfaVerified: false });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      requestId: req.requestId,
      ip: req.ip,
      metadata: { portal: input.portal, mfaRequired },
    });

    return {
      user: toAuthUser(user),
      token: s.token,
      sessionId: s.sessionId,
      persistentMs: s.persistentMs,
      mfaRequired,
      redirectTo: user.mustChangePassword ? '/tai-khoan' : this.redirectFor(user.role, input.returnTo),
    };
  }

  redirectFor(role: Role, returnTo?: string): string {
    if (role === 'ADMIN') return safeReturnTo(returnTo, '/admin').startsWith('/admin') ? safeReturnTo(returnTo, '/admin') : '/admin';
    if (role === 'COLLABORATOR') return safeReturnTo(returnTo, '/cong-tac-vien').startsWith('/cong-tac-vien') ? safeReturnTo(returnTo, '/cong-tac-vien') : '/cong-tac-vien';
    return safeReturnTo(returnTo, '/tai-khoan');
  }

  /** Step-up after password login. Rotates the session id so the pre-MFA token is dead. */
  async verifyMfa(auth: { user: AuthUser; session: { id: string } }, code: string, req: RequestInfo): Promise<LoginResult> {
    const ok = await this.mfa.verifyLogin(auth.user.id, code);
    if (!ok) {
      await this.audit.log({
        actorId: auth.user.id,
        actorRole: auth.user.role,
        action: 'auth.mfa_verify',
        resourceType: 'user',
        resourceId: auth.user.id,
        result: 'FAILURE',
        requestId: req.requestId,
        ip: req.ip,
      });
      throw E.validation([{ path: 'code', message: 'Mã xác thực không đúng.' }], 'Mã xác thực không đúng.');
    }
    await this.sessions.revoke(auth.session.id);
    const s = await this.sessions.create(auth.user, { rememberMe: false, ip: req.ip, userAgent: req.userAgent, mfaVerified: true });
    await this.audit.log({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: 'auth.mfa_verify',
      resourceType: 'user',
      resourceId: auth.user.id,
      requestId: req.requestId,
      ip: req.ip,
    });
    return {
      user: auth.user,
      token: s.token,
      sessionId: s.sessionId,
      persistentMs: null,
      mfaRequired: false,
      redirectTo: auth.user.mustChangePassword ? '/tai-khoan' : this.redirectFor(auth.user.role),
    };
  }

  async logout(sessionId: string, user: AuthUser, req: RequestInfo): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.log({ actorId: user.id, actorRole: user.role, action: 'auth.logout', resourceType: 'user', resourceId: user.id, requestId: req.requestId, ip: req.ip });
  }

  // ───────────── password reset / activation ─────────────
  /** Always resolves without revealing whether the e-mail exists. */
  async requestPasswordReset(email: string, req: RequestInfo): Promise<void> {
    const normalized = normalizeEmail(email);
    const rl = await this.redis.hit(`rl:forgot:email:${normalized}`, 3, 3600);
    if (!rl.allowed) return; // silently drop: no oracle, no mail bombing
    const user = await this.prisma.user.findUnique({ where: { emailNormalized: normalized } });
    if (!user || user.deletedAt || !['ACTIVE', 'PENDING_RESET'].includes(user.status)) return;
    const activation = user.status === 'PENDING_RESET';
    await this.prisma.$transaction(async (tx) => {
      const { raw, code } = await this.tokens.issue(tx, user.id, activation ? 'ACTIVATE_ACCOUNT' : 'RESET_PASSWORD', activation ? 7 * 24 * HOUR : HOUR);
      const mail = resetPasswordMail(user.displayName, this.link('/dat-lai-mat-khau', raw), activation, code);
      await this.outbox.enqueueEmail(tx, { to: user.email, kind: activation ? 'ACTIVATE_ACCOUNT' : 'RESET_PASSWORD', ...mail }, { aggregateType: 'user', aggregateId: user.id });
      await this.audit.log({ actorId: user.id, action: 'auth.password_reset_requested', resourceType: 'user', resourceId: user.id, requestId: req.requestId, ip: req.ip }, tx);
    });
  }

  async resetPassword(token: string, newPassword: string, req: RequestInfo): Promise<void> {
    const hash = await this.passwords.hash(newPassword);
    const userId = await this.prisma.$transaction(async (tx) => {
      const used = await this.tokens.consume(token, ['RESET_PASSWORD', 'ACTIVATE_ACCOUNT'], tx);
      return used ? this.applyReset(tx, used.userId, hash, req, 'link') : null;
    });
    if (!userId) throw E.tokenInvalid();
  }

  /** Reset/activation with the 6-digit e-mailed code. Unknown e-mail, wrong code, expired and burned codes all answer identically (no account oracle). */
  async resetPasswordWithCode(email: string, code: string, newPassword: string, req: RequestInfo): Promise<void> {
    const normalized = normalizeEmail(email);
    const rl = await this.redis.hit(`rl:resetcode:email:${normalized}`, 10, 3600);
    if (!rl.allowed) throw E.rateLimited(rl.retryAfter);
    const hash = await this.passwords.hash(newPassword); // also keeps timing similar whether or not the account exists
    const user = await this.prisma.user.findUnique({ where: { emailNormalized: normalized }, select: { id: true, status: true, deletedAt: true } });
    const eligible = !!user && !user.deletedAt && ['ACTIVE', 'PENDING_RESET'].includes(user.status);
    const userId = await this.prisma.$transaction(async (tx) => {
      if (!eligible) return null;
      const used = await this.tokens.consumeCode(user.id, ['RESET_PASSWORD', 'ACTIVATE_ACCOUNT'], code, tx);
      return used ? this.applyReset(tx, used.userId, hash, req, 'code') : null;
    });
    if (!userId) throw E.codeInvalid();
  }

  /** Possession of the e-mailed link/code proves ownership of the address ⇒ verified (also activates migrated and invited accounts); every session is revoked. */
  private async applyReset(tx: Prisma.TransactionClient, userId: string, passwordHash: string, req: RequestInfo, via: 'link' | 'code'): Promise<string> {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(), failedLoginCount: 0, lockedUntil: null, mustChangePassword: false },
    });
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorId: userId, action: 'auth.password_reset', resourceType: 'user', resourceId: userId, requestId: req.requestId, ip: req.ip, metadata: { via } }, tx);
    return userId;
  }

  async changePassword(auth: { user: AuthUser; session: { id: string } }, current: string, next: string, req: RequestInfo): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { passwordHash: true } });
    if (!row.passwordHash || !(await this.passwords.verify(row.passwordHash, current))) {
      throw E.validation([{ path: 'currentPassword', message: 'Mật khẩu hiện tại không đúng.' }], 'Mật khẩu hiện tại không đúng.');
    }
    await this.prisma.user.update({ where: { id: auth.user.id }, data: { passwordHash: await this.passwords.hash(next), mustChangePassword: false } });
    await this.sessions.revokeAllForUser(auth.user.id, auth.session.id);
    await this.audit.log({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: 'auth.password_change',
      resourceType: 'user',
      resourceId: auth.user.id,
      requestId: req.requestId,
      ip: req.ip,
    });
  }
}
