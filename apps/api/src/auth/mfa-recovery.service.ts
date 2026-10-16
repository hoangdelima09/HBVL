import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type MfaResetStatus } from '@hbvl/database';
import { AuditService } from '../audit/audit.service';
import { E } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { adminMfaResetMail, mfaRecoveryCodeMail, mfaRemovedMail, mfaRequestAdminMail, mfaRequestDecisionMail, mfaRequestReceivedMail } from '../mail/templates';
import { OutboxService } from '../outbox/outbox.service';
import type { AuthContext } from './auth.types';
import type { RequestInfo } from './auth.service';
import { TokenService } from './token.service';

type Tx = Prisma.TransactionClient;
const MIN = 60_000;
const ROLE_LABEL = { ADMIN: 'Quản trị viên', COLLABORATOR: 'Cộng tác viên', MEMBER: 'Thành viên' } as const;
const PORTAL = { ADMIN: '/dang-nhap-quan-tri', COLLABORATOR: '/dang-nhap-cong-tac-vien', MEMBER: '/dang-nhap-thanh-vien' } as const;

/**
 * Recovering from a lost authenticator. Every path starts from a CORRECT PASSWORD (a session whose two-factor step is pending) and then
 * proves the mailbox, so neither a stolen password nor a stolen mailbox alone is enough:
 *  - collaborator / member: e-mailed 6-digit code → request → an administrator approves or rejects (both sides are e-mailed);
 *  - administrator: e-mailed one-time link → two-factor authentication is removed → the admin area stays locked until it is enabled again.
 */
@Injectable()
export class MfaRecoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private link(path: string) {
    return `${this.env.PUBLIC_ORIGIN.replace(/\/$/, '')}${path}`;
  }

  /** The caller must be half signed in: right password, two-factor step not done yet, two-factor enabled. */
  private assertPending(a: AuthContext) {
    if (!a.user.mfaEnabled) throw E.conflict('Tài khoản này chưa bật xác thực 2 lớp.');
    if (a.session.mfaVerifiedAt) throw E.conflict('Bạn đã xác thực xong; hãy quản lý xác thực 2 lớp trong trang Tài khoản.');
  }

  // ───────────────────────── collaborator / member ─────────────────────────
  async status(a: AuthContext) {
    const r = await this.prisma.mfaResetRequest.findFirst({
      where: { userId: a.user.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true, createdAt: true, reviewedAt: true },
    });
    return { request: r };
  }

  async sendCode(a: AuthContext, req: RequestInfo) {
    this.assertPending(a);
    if (a.user.role === 'ADMIN') throw E.forbidden('Quản trị viên khôi phục bằng liên kết gửi qua email.', 'FORBIDDEN_ACTION');
    if (await this.prisma.mfaResetRequest.count({ where: { userId: a.user.id, status: 'PENDING' } })) {
      throw E.conflict('Bạn đã gửi yêu cầu; vui lòng chờ quản trị viên xử lý.', 'CONFLICT', { reason: 'ALREADY_PENDING' });
    }
    await this.prisma.$transaction(async (tx) => {
      const { code } = await this.tokens.issue(tx, a.user.id, 'MFA_RECOVERY', 30 * MIN);
      await this.outbox.enqueueEmail(
        tx,
        { to: a.user.email, kind: 'MFA_RECOVERY_CODE', ...mfaRecoveryCodeMail(a.user.displayName, code) },
        { aggregateType: 'user', aggregateId: a.user.id },
      );
      await this.audit.log(
        { actorId: a.user.id, actorRole: a.user.role, action: 'auth.mfa_recovery_code', resourceType: 'user', resourceId: a.user.id, requestId: req.requestId, ip: req.ip },
        tx,
      );
    });
    return { sent: true };
  }

  async createRequest(a: AuthContext, code: string, note: string | undefined, req: RequestInfo) {
    this.assertPending(a);
    if (a.user.role === 'ADMIN') throw E.forbidden('Quản trị viên khôi phục bằng liên kết gửi qua email.', 'FORBIDDEN_ACTION');
    const used = await this.tokens.consumeCode(a.user.id, ['MFA_RECOVERY'], code);
    if (!used) throw E.codeInvalid();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const r = await tx.mfaResetRequest.create({ data: { userId: a.user.id, note: note?.trim() || null }, select: { id: true } });
        const admins = await tx.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null }, select: { id: true, displayName: true, email: true } });
        const who = a.user.displayName;
        if (admins.length) {
          await tx.notification.createMany({
            data: admins.map((u) => ({
              userId: u.id,
              type: 'mfa.reset_request',
              title: `Yêu cầu gỡ xác thực 2 lớp: ${who} (${ROLE_LABEL[a.user.role]})`,
              body: note?.trim() ? note.trim().slice(0, 300) : null,
              data: { requestId: r.id, userId: a.user.id },
            })),
          });
        }
        for (const u of admins) {
          const mail = mfaRequestAdminMail({
            adminName: u.displayName,
            who,
            username: a.user.username,
            role: ROLE_LABEL[a.user.role],
            note,
            link: this.link('/admin/yeu-cau-xac-thuc'),
          });
          await this.outbox.enqueueEmail(
            tx,
            { to: u.email, kind: 'MFA_RESET_REQUEST', ...mail },
            { aggregateType: 'mfa_request', aggregateId: r.id, dedupeKey: `mfa-request-${r.id}-${u.id}` },
          );
        }
        await this.outbox.enqueueEmail(tx, { to: a.user.email, kind: 'MFA_RESET_RECEIVED', ...mfaRequestReceivedMail(who) }, { aggregateType: 'mfa_request', aggregateId: r.id });
        await this.audit.log(
          {
            actorId: a.user.id,
            actorRole: a.user.role,
            action: 'auth.mfa_reset_request',
            resourceType: 'user',
            resourceId: a.user.id,
            requestId: req.requestId,
            ip: req.ip,
            metadata: { requestId: r.id },
          },
          tx,
        );
        return { requested: true, id: r.id };
      });
    } catch (e) {
      // the partial unique index allows one open request per person; a double click lands here
      if ((e as { code?: string }).code === 'P2002') throw E.conflict('Bạn đã gửi yêu cầu; vui lòng chờ quản trị viên xử lý.', 'CONFLICT', { reason: 'ALREADY_PENDING' });
      throw e;
    }
  }

  // ───────────────────────── administrators decide ─────────────────────────
  async list(q: { status?: MfaResetStatus; page: number; pageSize: number }) {
    const where: Prisma.MfaResetRequestWhereInput = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.mfaResetRequest.count({ where }),
      this.prisma.mfaResetRequest.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          status: true,
          note: true,
          createdAt: true,
          reviewedAt: true,
          decisionNote: true,
          user: { select: { id: true, username: true, displayName: true, email: true, role: true, mfaEnabled: true, lastLoginAt: true } },
          reviewer: { select: { displayName: true } },
        },
      }),
    ]);
    return { items: rows, page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async pendingCount() {
    return this.prisma.mfaResetRequest.count({ where: { status: 'PENDING' } });
  }

  /** First administrator to decide wins (atomic status flip); a second one gets 409. */
  async decide(a: AuthContext, id: string, approve: boolean, note?: string) {
    const out = await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.mfaResetRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: approve ? 'APPROVED' : 'REJECTED', reviewerId: a.user.id, reviewedAt: new Date(), decisionNote: note?.trim() || null },
      });
      if (flipped.count !== 1) {
        const exists = await tx.mfaResetRequest.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw E.notFound();
        throw E.conflict('Yêu cầu này đã được xử lý.', 'CONFLICT', { reason: 'ALREADY_HANDLED' });
      }
      const r = await tx.mfaResetRequest.findUniqueOrThrow({ where: { id }, select: { user: { select: { id: true, role: true, displayName: true, email: true } } } });
      if (approve) {
        if (r.user.role === 'ADMIN') throw E.forbidden('Quản trị viên tự khôi phục bằng liên kết email.', 'FORBIDDEN_ACTION');
        await this.removeMfa(tx, r.user.id);
      }
      await tx.notification.updateMany({ where: { type: 'mfa.reset_request', readAt: null, data: { path: ['requestId'], equals: id } }, data: { readAt: new Date() } });
      await tx.notification.create({
        data: {
          userId: r.user.id,
          type: approve ? 'account.mfa_removed' : 'account.mfa_request_rejected',
          title: approve ? 'Quản trị viên đã gỡ xác thực 2 lớp cho tài khoản của bạn' : 'Yêu cầu gỡ xác thực 2 lớp bị từ chối',
          body: note?.trim() || null,
          data: { requestId: id },
        },
      });
      const mail = mfaRequestDecisionMail({ name: r.user.displayName, approved: approve, note, link: this.link(PORTAL[r.user.role]) });
      await this.outbox.enqueueEmail(
        tx,
        { to: r.user.email, kind: approve ? 'MFA_RESET_APPROVED' : 'MFA_RESET_REJECTED', ...mail },
        { aggregateType: 'mfa_request', aggregateId: id },
      );
      await this.audit.log(
        {
          actorId: a.user.id,
          actorRole: a.user.role,
          action: approve ? 'user.mfa_reset_approve' : 'user.mfa_reset_reject',
          resourceType: 'user',
          resourceId: r.user.id,
          metadata: { requestId: id },
        },
        tx,
      );
      return { id, status: approve ? 'APPROVED' : 'REJECTED' };
    });
    return out;
  }

  /** Two-factor authentication off, recovery codes gone, every session signed out. */
  private async removeMfa(tx: Tx, userId: string) {
    await tx.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // ───────────────────────── administrators recover themselves ─────────────────────────
  async sendAdminResetLink(a: AuthContext, req: RequestInfo) {
    this.assertPending(a);
    if (a.user.role !== 'ADMIN') throw E.forbidden('Hãy gửi yêu cầu gỡ xác thực tới quản trị viên.', 'FORBIDDEN_ACTION');
    await this.prisma.$transaction(async (tx) => {
      const { raw } = await this.tokens.issue(tx, a.user.id, 'MFA_RESET', 30 * MIN, { withCode: false });
      const mail = adminMfaResetMail(a.user.displayName, this.link(`/go-xac-thuc?token=${encodeURIComponent(raw)}`));
      await this.outbox.enqueueEmail(tx, { to: a.user.email, kind: 'ADMIN_MFA_RESET_LINK', ...mail }, { aggregateType: 'user', aggregateId: a.user.id });
      await this.audit.log(
        { actorId: a.user.id, actorRole: a.user.role, action: 'auth.mfa_reset_link', resourceType: 'user', resourceId: a.user.id, requestId: req.requestId, ip: req.ip },
        tx,
      );
    });
    return { sent: true };
  }

  async useAdminResetLink(token: string, req: RequestInfo) {
    await this.prisma.$transaction(async (tx) => {
      const used = await this.tokens.consume(token, ['MFA_RESET'], tx);
      if (!used) throw E.tokenInvalid();
      const u = await tx.user.findUnique({ where: { id: used.userId }, select: { id: true, role: true, status: true, deletedAt: true, displayName: true, email: true } });
      if (!u || u.deletedAt || u.status !== 'ACTIVE' || u.role !== 'ADMIN') throw E.tokenInvalid();
      await this.removeMfa(tx, u.id);
      await this.outbox.enqueueEmail(
        tx,
        { to: u.email, kind: 'MFA_REMOVED', ...mfaRemovedMail(u.displayName, this.link(PORTAL.ADMIN)) },
        { aggregateType: 'user', aggregateId: u.id },
      );
      await this.audit.log(
        { actorId: u.id, actorRole: 'ADMIN', action: 'auth.mfa_reset_by_link', resourceType: 'user', resourceId: u.id, requestId: req.requestId, ip: req.ip },
        tx,
      );
    });
  }
}
