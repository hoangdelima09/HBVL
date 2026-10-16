import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LIMITS, mfaDecisionSchema, mfaRecoveryRequestSchema, mfaRejectSchema, mfaResetLinkSchema } from '@hbvl/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { clientIp } from '../common/ip';
import { RateLimit } from '../common/rate-limit';
import { body, query, ZodBody } from '../common/zod';
import { AllowBeforeMfa, Auth, CurrentAuth } from './auth.decorators';
import type { RequestInfo } from './auth.service';
import type { AuthContext } from './auth.types';
import { MfaRecoveryService } from './mfa-recovery.service';

const info = (req: Request): RequestInfo => ({ ip: clientIp(req), userAgent: req.header('user-agent') ?? undefined, requestId: req.id });

/** Lost authenticator, from the two-factor step of the sign-in (the password is already correct). */
@ApiTags('auth')
@Controller('auth/mfa')
export class MfaRecoveryController {
  constructor(private readonly svc: MfaRecoveryService) {}

  @Get('recovery/status')
  @Auth()
  @AllowBeforeMfa()
  status(@CurrentAuth() a: AuthContext) {
    return this.svc.status(a);
  }

  /** Collaborator / member, step 1: a 6-digit code to the account e-mail. */
  @Post('recovery/send-code')
  @HttpCode(200)
  @Auth()
  @AllowBeforeMfa()
  @RateLimit({ name: 'mfa-recovery-code', limit: 3, windowSeconds: 3600, scope: 'actor' })
  sendCode(@CurrentAuth() a: AuthContext, @Req() req: Request) {
    return this.svc.sendCode(a, info(req));
  }

  /** Collaborator / member, step 2: the right code sends the request to the administrators. */
  @Post('recovery/request')
  @HttpCode(200)
  @Auth()
  @AllowBeforeMfa()
  @RateLimit({ name: 'mfa-recovery-request', limit: 10, windowSeconds: 3600, scope: 'actor' })
  @ZodBody(mfaRecoveryRequestSchema)
  request(@body(mfaRecoveryRequestSchema) dto: z.infer<typeof mfaRecoveryRequestSchema>, @CurrentAuth() a: AuthContext, @Req() req: Request) {
    return this.svc.createRequest(a, dto.code, dto.note, info(req));
  }

  /** Administrator: e-mail a one-time link that removes two-factor authentication. */
  @Post('reset-link')
  @HttpCode(200)
  @Auth()
  @AllowBeforeMfa()
  @RateLimit({ name: 'mfa-reset-link', limit: 3, windowSeconds: 3600, scope: 'actor' })
  resetLink(@CurrentAuth() a: AuthContext, @Req() req: Request) {
    return this.svc.sendAdminResetLink(a, info(req));
  }

  /** Administrator: open the e-mailed link. Public on purpose (like password reset): the link itself is the proof. */
  @Post('reset')
  @HttpCode(204)
  @RateLimit({ name: 'mfa-reset', limit: 10, windowSeconds: 3600 })
  @ZodBody(mfaResetLinkSchema)
  async reset(@body(mfaResetLinkSchema) dto: z.infer<typeof mfaResetLinkSchema>, @Req() req: Request) {
    await this.svc.useAdminResetLink(dto.token, info(req));
  }
}

const listQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(20),
});

@ApiTags('admin')
@Controller('admin/mfa-requests')
@Auth({ roles: ['ADMIN'], mfa: true })
export class AdminMfaRequestsController {
  constructor(private readonly svc: MfaRecoveryService) {}

  @Get()
  list(@query(listQuery) q: z.infer<typeof listQuery>) {
    return this.svc.list(q);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ZodBody(mfaDecisionSchema)
  approve(@Param('id', new ParseUUIDPipe()) id: string, @body(mfaDecisionSchema) dto: z.infer<typeof mfaDecisionSchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.decide(a, id, true, dto.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ZodBody(mfaRejectSchema)
  reject(@Param('id', new ParseUUIDPipe()) id: string, @body(mfaRejectSchema) dto: z.infer<typeof mfaRejectSchema>, @CurrentAuth() a: AuthContext) {
    return this.svc.decide(a, id, false, dto.note);
  }
}
