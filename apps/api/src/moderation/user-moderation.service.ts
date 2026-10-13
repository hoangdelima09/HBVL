import { Injectable } from '@nestjs/common';
import { normalizeUsername } from '@hbvl/contracts';
import { Prisma, PrismaClient, type Role } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import { isRestricted, type AuthContext } from '../auth/auth.types';
import { E } from '../common/errors';

type Tx = Prisma.TransactionClient;

const memberSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  restrictedAt: true,
  restrictedUntil: true,
  restrictionReason: true,
  _count: { select: { comments: true, posts: true } },
} satisfies Prisma.UserSelect;

/**
 * Restrict (softer) or block (sign-in revoked) accounts.
 * Collaborators act on MEMBER accounts only; administrators act on anyone except themselves (and never on the last active admin).
 */
@Injectable()
export class UserModerationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  private view(u: Prisma.UserGetPayload<{ select: typeof memberSelect }>) {
    const { _count, restrictedAt, restrictedUntil, restrictionReason, ...rest } = u;
    return {
      ...rest,
      commentCount: _count.comments,
      postCount: _count.posts,
      restricted: isRestricted({ restrictedAt, restrictedUntil }),
      restrictedUntil,
      restrictionReason,
    };
  }

  async listMembers(q: { q?: string; state?: 'ACTIVE' | 'RESTRICTED' | 'BLOCKED'; page: number; pageSize: number }) {
    const now = new Date();
    const where: Prisma.UserWhereInput = {
      role: 'MEMBER',
      deletedAt: null,
      status: q.state === 'BLOCKED' ? 'SUSPENDED' : { in: ['ACTIVE', 'SUSPENDED', 'PENDING_RESET'] },
      ...(q.state === 'RESTRICTED' ? { restrictedAt: { not: null }, OR: [{ restrictedUntil: null }, { restrictedUntil: { gt: now } }] } : {}),
      ...(q.state === 'ACTIVE' ? { status: 'ACTIVE' } : {}),
      ...(q.q
        ? {
            OR: [{ usernameNormalized: { contains: normalizeUsername(q.q) } }, { displayName: { contains: q.q, mode: 'insensitive' } }],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, select: memberSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: rows.map((r) => this.view(r)), page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  /** Who may be moderated by this actor? Throws 404 for out-of-scope targets (a collaborator learns nothing about staff accounts). */
  private async target(tx: Tx, a: AuthContext, id: string): Promise<{ id: string; role: Role; status: string; passwordHash: string | null }> {
    if (id === a.user.id) throw E.forbidden('Bạn không thể tự hạn chế hoặc khóa chính mình.', 'FORBIDDEN_ACTION');
    const u = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, passwordHash: true, deletedAt: true } });
    if (!u || u.deletedAt) throw E.notFound();
    if (a.user.role === 'COLLABORATOR' && u.role !== 'MEMBER') throw E.notFound();
    return u;
  }

  /** Serialised so two concurrent blocks cannot leave zero active administrators. */
  private async assertNotLastAdmin(tx: Tx, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('last-admin'))`;
    const others = await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null, id: { not: id } } });
    if (others === 0) throw E.conflict('Không thể khóa quản trị viên hoạt động cuối cùng.', 'CONFLICT');
  }

  /** Transaction-scoped primitives, reused by the report flow so “remove + restrict/block” is one atomic change. */
  async restrictIn(tx: Tx, a: AuthContext, id: string, input: { days?: number; reason: string }, via: string) {
    await this.target(tx, a, id);
    const until = input.days ? new Date(Date.now() + input.days * 86_400_000) : null;
    await tx.user.update({ where: { id }, data: { restrictedAt: new Date(), restrictedUntil: until, restrictionReason: input.reason } });
    await tx.notification.create({
      data: {
        userId: id,
        type: 'account.restricted',
        title: 'Tài khoản của bạn bị hạn chế tương tác',
        body: `${input.reason}${until ? ` (đến ${until.toISOString().slice(0, 10)})` : ''}`,
        data: {},
      },
    });
    await this.audit.log(
      { actorId: a.user.id, actorRole: a.user.role, action: 'user.restrict', resourceType: 'user', resourceId: id, metadata: { days: input.days ?? null, via } },
      tx,
    );
    return { id, restricted: true, restrictedUntil: until };
  }

  async blockIn(tx: Tx, a: AuthContext, id: string, input: { reason: string }, via: string) {
    const u = await this.target(tx, a, id);
    if (u.role === 'ADMIN' && u.status === 'ACTIVE') await this.assertNotLastAdmin(tx, id);
    await tx.user.update({ where: { id }, data: { status: 'SUSPENDED', restrictionReason: input.reason } });
    await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }); // signed out everywhere, now
    await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'user.block', resourceType: 'user', resourceId: id, metadata: { via } }, tx);
    return { id, status: 'SUSPENDED' as const };
  }

  restrict(a: AuthContext, id: string, input: { days?: number; reason: string }) {
    return this.prisma.$transaction((tx) => this.restrictIn(tx, a, id, input, 'manual'));
  }

  block(a: AuthContext, id: string, input: { reason: string }) {
    return this.prisma.$transaction((tx) => this.blockIn(tx, a, id, input, 'manual'));
  }

  async unrestrict(a: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.target(tx, a, id);
      await tx.user.update({ where: { id }, data: { restrictedAt: null, restrictedUntil: null, restrictionReason: null } });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'user.unrestrict', resourceType: 'user', resourceId: id }, tx);
      return { id, restricted: false };
    });
  }

  async unblock(a: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const u = await this.target(tx, a, id);
      if (u.status !== 'SUSPENDED') throw E.conflict('Tài khoản không ở trạng thái bị khóa.');
      // Never ACTIVE without a password (DB check): invited-but-not-activated accounts go back to PENDING_RESET.
      await tx.user.update({ where: { id }, data: { status: u.passwordHash ? 'ACTIVE' : 'PENDING_RESET', restrictionReason: null } });
      await this.audit.log({ actorId: a.user.id, actorRole: a.user.role, action: 'user.unblock', resourceType: 'user', resourceId: id }, tx);
      return { id, status: u.passwordHash ? ('ACTIVE' as const) : ('PENDING_RESET' as const) };
    });
  }
}
