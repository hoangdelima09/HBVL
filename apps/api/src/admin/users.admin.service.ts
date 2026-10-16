import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail, normalizeUsername } from '@hbvl/contracts';
import { Prisma, PrismaClient, type Role, type UserStatus } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import { PORTAL_SLUG } from '../auth/auth.service';
import { AvatarService } from '../media/avatar.service';
import { avatarUrl } from '../media/media-url';
import type { AuthContext } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { E } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { passwordResetByAdminMail, resetPasswordMail } from '../mail/templates';
import { OutboxService } from '../outbox/outbox.service';

const userSelect = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  restrictedAt: true,
  restrictedUntil: true,
  restrictionReason: true,
  avatarAssetId: true,
} satisfies Prisma.UserSelect;

/**
 * The temporary password an administrator sets on request. It is deliberately simple (the owner must replace it at the next sign-in:
 * `mustChangePassword` blocks everything but "change password"), so it is never valid for longer than one sign-in.
 */
export const DEFAULT_RESET_PASSWORD = '123456789';

@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly outbox: OutboxService,
    private readonly avatars: AvatarService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(q: { q?: string; role?: Role; status?: UserStatus; page: number; pageSize: number }) {
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { usernameNormalized: { contains: normalizeUsername(q.q) } },
              { emailNormalized: { contains: normalizeEmail(q.q) } },
              { displayName: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, select: userSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      items: items.map((u) => ({ ...u, avatarUrl: avatarUrl(u.avatarAssetId, 'thumb') })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async get(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { ...userSelect, _count: { select: { posts: true, comments: true } } } });
    if (!u) throw E.notFound();
    return u;
  }

  /** Admin-created accounts have NO password: the invitee sets one through the e-mailed activation link (which also verifies the address). */
  async create(a: AuthContext, input: { username: string; email: string; displayName: string; role: Role }) {
    const usernameNormalized = normalizeUsername(input.username);
    const emailNormalized = normalizeEmail(input.email);
    if (await this.prisma.user.findFirst({ where: { OR: [{ usernameNormalized }, { emailNormalized }] }, select: { id: true } })) {
      throw E.conflict('Tên đăng nhập hoặc email đã được sử dụng.', 'CONFLICT');
    }
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          username: input.username,
          usernameNormalized,
          email: input.email,
          emailNormalized,
          displayName: input.displayName,
          role: input.role,
          status: 'PENDING_RESET',
          profile: { create: {} },
        },
        select: userSelect,
      });
      await this.sendActivation(tx, u.id, u.displayName, u.email, u.role);
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'user.create', resourceType: 'user', resourceId: u.id, metadata: { role: input.role } }, tx);
      return u;
    });
  }

  private async sendActivation(tx: Prisma.TransactionClient, userId: string, name: string, email: string, role: Role) {
    const { raw, code } = await this.tokens.issue(tx, userId, 'ACTIVATE_ACCOUNT', 7 * 24 * 3_600_000);
    const mail = resetPasswordMail(name, `${this.env.PUBLIC_ORIGIN.replace(/\/$/, '')}/dat-lai-mat-khau?token=${encodeURIComponent(raw)}&cong=${PORTAL_SLUG[role]}`, true, code);
    await this.outbox.enqueueEmail(tx, { to: email, kind: 'ACTIVATE_ACCOUNT', ...mail }, { aggregateType: 'user', aggregateId: userId });
  }

  async resendActivation(a: AuthContext, id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, displayName: true, email: true, role: true, status: true } });
    if (!u) throw E.notFound();
    if (u.status !== 'PENDING_RESET') throw E.conflict('Tài khoản đã được kích hoạt.');
    await this.prisma.$transaction(async (tx) => {
      await this.sendActivation(tx, u.id, u.displayName, u.email, u.role);
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'user.resend_activation', resourceType: 'user', resourceId: id }, tx);
    });
    return { sent: true };
  }

  /** Serialised by a transaction-scoped advisory lock so two concurrent demotions cannot both succeed and leave zero admins. */
  private async assertNotLastAdmin(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('last-admin'))`;
    const others = await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null, id: { not: id } } });
    if (others === 0) throw E.conflict('Không thể thay đổi quản trị viên hoạt động cuối cùng.', 'CONFLICT');
  }

  async update(a: AuthContext, id: string, input: { role?: Role; status?: 'ACTIVE' | 'SUSPENDED'; displayName?: string }) {
    if (id === a.user.id && (input.role || input.status)) throw E.forbidden('Bạn không thể tự đổi vai trò hoặc khóa chính mình.', 'FORBIDDEN_ACTION');
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, passwordHash: true, deletedAt: true } });
      if (!cur || cur.deletedAt) throw E.notFound();
      const demoting = cur.role === 'ADMIN' && cur.status === 'ACTIVE' && ((input.role && input.role !== 'ADMIN') || input.status === 'SUSPENDED');
      if (demoting) await this.assertNotLastAdmin(tx, id);
      const data: Prisma.UserUpdateInput = {};
      if (input.displayName) data.displayName = input.displayName;
      if (input.role) data.role = input.role;
      if (input.status === 'SUSPENDED') data.status = 'SUSPENDED';
      if (input.status === 'ACTIVE') data.status = cur.passwordHash ? 'ACTIVE' : 'PENDING_RESET'; // never ACTIVE without a password (DB check)
      const u = await tx.user.update({ where: { id }, data, select: userSelect });
      if (input.role || input.status === 'SUSPENDED') {
        // Permission changes take effect now: every session is revoked, the user signs in again with the new role.
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.log(
        {
          actorId: a.user.id,
          actorRole: a.user.role,
          action: 'user.update',
          resourceType: 'user',
          resourceId: id,
          metadata: { fromRole: cur.role, toRole: u.role, fromStatus: cur.status, toStatus: u.status },
        },
        tx,
      );
      return u;
    });
  }

  /**
   * Reset someone's password to the default. Not for administrators (their recovery path is the e-mail code + MFA), not for yourself,
   * not for accounts that never activated (that would skip proof of owning the mailbox). Every session is signed out.
   */
  async resetPassword(a: AuthContext, id: string) {
    if (id === a.user.id) throw E.forbidden('Hãy dùng chức năng đổi mật khẩu cho chính bạn.', 'FORBIDDEN_ACTION');
    const hash = await this.passwords.hash(DEFAULT_RESET_PASSWORD);
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, deletedAt: true, displayName: true, email: true } });
      if (!cur || cur.deletedAt) throw E.notFound();
      if (cur.role === 'ADMIN') throw E.forbidden('Không thể đặt lại mật khẩu của tài khoản quản trị viên.', 'FORBIDDEN_ACTION');
      if (cur.status === 'PENDING_RESET') throw E.conflict('Tài khoản chưa kích hoạt. Hãy gửi lại email kích hoạt thay vì đặt lại mật khẩu.');
      await tx.user.update({ where: { id }, data: { passwordHash: hash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authToken.deleteMany({ where: { userId: id, purpose: { in: ['RESET_PASSWORD', 'ACTIVATE_ACCOUNT'] } } }); // old reset links/codes must not outlive the reset
      await tx.notification.create({
        data: {
          userId: id,
          type: 'account.password_reset',
          title: 'Mật khẩu của bạn đã được quản trị viên đặt lại',
          body: 'Hãy đăng nhập bằng mật khẩu tạm thời và đổi mật khẩu ngay.',
          data: {},
        },
      });
      const mail = passwordResetByAdminMail({ name: cur.displayName, link: `${this.env.PUBLIC_ORIGIN.replace(/\/$/, '')}/dang-nhap-thanh-vien` });
      await this.outbox.enqueueEmail(tx, { to: cur.email, kind: 'PASSWORD_RESET_BY_ADMIN', ...mail }, { aggregateType: 'user', aggregateId: id });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'user.reset_password', resourceType: 'user', resourceId: id, metadata: { role: cur.role } }, tx);
      return { id, mustChangePassword: true };
    });
  }

  /** Anonymise instead of deleting rows: posts/comments keep their structure (no cascade), personal data is removed. */
  async anonymize(a: AuthContext, id: string) {
    if (id === a.user.id) throw E.forbidden('Không thể xóa chính mình.', 'FORBIDDEN_ACTION');
    const { avatar } = await this.prisma.$transaction(async (tx) => {
      const cur = await tx.user.findUnique({ where: { id }, select: { role: true, status: true, deletedAt: true } });
      if (!cur || cur.deletedAt) throw E.notFound();
      if (cur.role === 'ADMIN' && cur.status === 'ACTIVE') await this.assertNotLastAdmin(tx, id);
      const tag = id.slice(0, 8);
      await tx.user.update({
        where: { id },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          username: `deleted-${tag}`,
          usernameNormalized: `deleted-${tag}`,
          email: `deleted-${id}@invalid.local`,
          emailNormalized: `deleted-${id}@invalid.local`,
          displayName: 'Người dùng đã xóa',
          passwordHash: null,
          mfaEnabled: false,
          mfaSecretEnc: null,
        },
      });
      await tx.comment.updateMany({ where: { authorId: id }, data: { authorName: 'Người dùng đã xóa' } });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authToken.deleteMany({ where: { userId: id } });
      await tx.userProfile.deleteMany({ where: { userId: id } });
      const avatar = await this.avatars.clearIn(tx, id);
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'user.anonymize', resourceType: 'user', resourceId: id }, tx);
      return { avatar };
    });
    if (avatar) await this.avatars.deleteFiles(avatar);
    return { id };
  }
}
