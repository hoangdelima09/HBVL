import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { changePasswordSchema, mfaVerifySchema, updateProfileSchema } from '@hbvl/contracts';
import { PrismaClient } from '@hbvl/database';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AllowWhilePasswordChangePending, Auth, CurrentAuth } from '../auth/auth.decorators';
import { AuthService } from '../auth/auth.service';
import { toPublicUser, type AuthContext } from '../auth/auth.types';
import { setSessionCookie } from '../auth/cookies';
import { CsrfService } from '../auth/csrf';
import { MfaService } from '../auth/mfa.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { E } from '../common/errors';
import { clientIp } from '../common/ip';
import { RateLimit } from '../common/rate-limit';
import { body, ZodBody } from '../common/zod';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';

@ApiTags('me')
@Controller('me')
@Auth()
export class MeController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly passwords: PasswordService,
    private readonly csrf: CsrfService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async profile(@CurrentAuth() ctx: AuthContext, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const p = await this.prisma.userProfile.findUnique({ where: { userId: ctx.user.id } });
    return { user: toPublicUser(ctx.user), bio: p?.bio ?? '' };
  }

  @Patch()
  @ZodBody(updateProfileSchema)
  async update(@body(updateProfileSchema) dto: z.infer<typeof updateProfileSchema>, @CurrentAuth() ctx: AuthContext) {
    const { bio, ...userFields } = dto;
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: ctx.user.id }, data: userFields }),
      this.prisma.userProfile.upsert({ where: { userId: ctx.user.id }, update: bio === undefined ? {} : { bio }, create: { userId: ctx.user.id, bio } }),
    ]);
    return { ok: true };
  }

  @Post('password')
  @HttpCode(204)
  @AllowWhilePasswordChangePending()
  @RateLimit({ name: 'pwchange', limit: 5, windowSeconds: 900, scope: 'both' })
  @ZodBody(changePasswordSchema)
  async changePassword(@body(changePasswordSchema) dto: z.infer<typeof changePasswordSchema>, @CurrentAuth() ctx: AuthContext, @Req() req: Request) {
    await this.auth.changePassword(ctx, dto.currentPassword, dto.newPassword, { ip: clientIp(req), requestId: req.id });
  }

  @Get('sessions')
  async listSessions(@CurrentAuth() ctx: AuthContext, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const rows = await this.sessions.listForUser(ctx.user.id);
    return { items: rows.map((s) => ({ ...s, current: s.id === ctx.session.id })) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() ctx: AuthContext) {
    const own = await this.prisma.session.findFirst({ where: { id, userId: ctx.user.id }, select: { id: true } });
    if (!own) throw E.notFound(); // do not reveal other users' session ids
    await this.sessions.revoke(id);
  }

  // ───── MFA (TOTP) ─────
  @Post('mfa/setup')
  @RateLimit({ name: 'mfa-setup', limit: 10, windowSeconds: 3600, scope: 'actor' })
  async mfaSetup(@CurrentAuth() ctx: AuthContext) {
    if (ctx.user.mfaEnabled) throw E.conflict('MFA đã được bật.');
    return this.mfa.beginEnrollment(ctx.user.id, ctx.user.email);
  }

  @Post('mfa/enable')
  @RateLimit({ name: 'mfa-enable', limit: 10, windowSeconds: 900, scope: 'actor' })
  @ZodBody(mfaVerifySchema)
  async mfaEnable(@body(mfaVerifySchema) dto: z.infer<typeof mfaVerifySchema>, @CurrentAuth() ctx: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const recoveryCodes = await this.mfa.completeEnrollment(ctx.user.id, dto.code);
    // Rotate: the session that existed before MFA must not outlive the privilege change.
    await this.sessions.revoke(ctx.session.id);
    const s = await this.sessions.create(ctx.user, { rememberMe: false, ip: clientIp(req), userAgent: req.header('user-agent') ?? undefined, mfaVerified: true });
    setSessionCookie(res, this.env, s.token, null);
    const csrfToken = this.csrf.issue(res, s.sessionId);
    await this.audit.log({
      actorId: ctx.user.id,
      actorRole: ctx.user.role,
      action: 'auth.mfa_enable',
      resourceType: 'user',
      resourceId: ctx.user.id,
      requestId: req.id,
      ip: clientIp(req),
    });
    return { recoveryCodes, csrfToken };
  }

  @Post('mfa/disable')
  @HttpCode(204)
  @RateLimit({ name: 'mfa-disable', limit: 5, windowSeconds: 900, scope: 'actor' })
  @ZodBody(changePasswordSchema)
  async mfaDisable(
    @body(changePasswordSchema.pick({ currentPassword: true }).extend({ code: mfaVerifySchema.shape.code })) dto: { currentPassword: string; code: string },
    @CurrentAuth() ctx: AuthContext,
    @Req() req: Request,
  ) {
    if (ctx.user.role === 'ADMIN') throw E.forbidden('Quản trị viên bắt buộc dùng xác thực hai lớp.');
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { passwordHash: true } });
    if (!row.passwordHash || !(await this.passwords.verify(row.passwordHash, dto.currentPassword)) || !(await this.mfa.verifyLogin(ctx.user.id, dto.code))) {
      throw E.validation([{ path: 'currentPassword', message: 'Mật khẩu hoặc mã không đúng.' }], 'Mật khẩu hoặc mã không đúng.');
    }
    await this.mfa.disable(ctx.user.id);
    await this.audit.log({
      actorId: ctx.user.id,
      actorRole: ctx.user.role,
      action: 'auth.mfa_disable',
      resourceType: 'user',
      resourceId: ctx.user.id,
      requestId: req.id,
      ip: clientIp(req),
    });
  }
}
