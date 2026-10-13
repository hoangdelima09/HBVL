import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  forgotPasswordSchema,
  loginSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordCodeSchema,
  resetPasswordSchema,
  verifyEmailCodeSchema,
  verifyEmailSchema,
} from '@hbvl/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { clientIp } from '../common/ip';
import { RateLimit } from '../common/rate-limit';
import { body, ZodBody } from '../common/zod';
import { ENV, type Env } from '../config/env';
import { Inject } from '@nestjs/common';
import { AllowWhilePasswordChangePending, Auth, CurrentAuth } from './auth.decorators';
import { toPublicUser, type AuthContext } from './auth.types';
import { AuthService, type LoginResult, type RequestInfo } from './auth.service';
import { clearSessionCookie, setSessionCookie } from './cookies';
import { CsrfService } from './csrf';

const info = (req: Request): RequestInfo => ({ ip: clientIp(req), userAgent: req.header('user-agent') ?? undefined, requestId: req.id });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly csrf: CsrfService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private respond(res: Response, r: LoginResult) {
    setSessionCookie(res, this.env, r.token, r.persistentMs);
    const csrfToken = this.csrf.issue(res, r.sessionId);
    return { user: toPublicUser(r.user), mfaRequired: r.mfaRequired, redirectTo: r.redirectTo, csrfToken };
  }

  /** Mints a CSRF token for the current session (or "anon"), sets the double-submit cookie. */
  @Get('csrf')
  csrfToken(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return { csrfToken: this.csrf.ensure(req, res, req.auth?.session.id) };
  }

  /** Current user (or null). Always `no-store`: personal data must never be cached by a shared cache. */
  @Get('me')
  me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    const a = req.auth;
    return {
      user: a ? toPublicUser(a.user) : null,
      mfaVerified: a ? a.session.mfaVerifiedAt !== null : false,
      csrfToken: this.csrf.ensure(req, res, a?.session.id),
    };
  }

  @Post('register')
  @RateLimit({ name: 'register', limit: 5, windowSeconds: 3600 }, { name: 'register-min', limit: 3, windowSeconds: 60 })
  @ZodBody(registerSchema)
  async register(@body(registerSchema) dto: z.infer<typeof registerSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.register(dto, info(req));
    res.status(201);
    return this.respond(res, r);
  }

  @Post('login')
  @HttpCode(200)
  @RateLimit({ name: 'login', limit: 20, windowSeconds: 60 }, { name: 'login-hour', limit: 100, windowSeconds: 3600 })
  @ZodBody(loginSchema)
  async login(@body(loginSchema) dto: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto, info(req), req.auth?.session.id);
    return this.respond(res, r);
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @Auth()
  @AllowWhilePasswordChangePending()
  @RateLimit({ name: 'mfa', limit: 10, windowSeconds: 300, scope: 'both' })
  @ZodBody(mfaVerifySchema)
  async mfaVerify(@body(mfaVerifySchema) dto: z.infer<typeof mfaVerifySchema>, @CurrentAuth() ctx: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.verifyMfa(ctx, dto.code, info(req));
    return this.respond(res, r);
  }

  @Post('logout')
  @HttpCode(204)
  @Auth()
  @AllowWhilePasswordChangePending()
  async logout(@CurrentAuth() ctx: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx.session.id, ctx.user, info(req));
    clearSessionCookie(res, this.env);
    this.csrf.issue(res); // fresh anonymous token
  }

  @Post('verify-email')
  @HttpCode(204)
  @RateLimit({ name: 'verify', limit: 20, windowSeconds: 3600 })
  @ZodBody(verifyEmailSchema)
  async verifyEmail(@body(verifyEmailSchema) dto: z.infer<typeof verifyEmailSchema>) {
    await this.auth.verifyEmail(dto.token);
  }

  @Post('verify-email-code')
  @HttpCode(204)
  @Auth()
  @RateLimit({ name: 'verify-code', limit: 15, windowSeconds: 3600, scope: 'both' })
  @ZodBody(verifyEmailCodeSchema)
  async verifyEmailCode(@body(verifyEmailCodeSchema) dto: z.infer<typeof verifyEmailCodeSchema>, @CurrentAuth() ctx: AuthContext) {
    await this.auth.verifyEmailCode(ctx.user.id, dto.code);
  }

  @Post('resend-verification')
  @HttpCode(202)
  @Auth()
  @RateLimit({ name: 'resend', limit: 3, windowSeconds: 3600, scope: 'both' })
  async resend(@CurrentAuth() ctx: AuthContext) {
    await this.auth.resendVerification(ctx.user);
    return { accepted: true };
  }

  @Post('forgot-password')
  @HttpCode(202)
  @RateLimit({ name: 'forgot', limit: 10, windowSeconds: 3600 })
  @ZodBody(forgotPasswordSchema)
  async forgot(@body(forgotPasswordSchema) dto: z.infer<typeof forgotPasswordSchema>, @Req() req: Request) {
    await this.auth.requestPasswordReset(dto.email, info(req));
    return { accepted: true }; // identical whether or not the address exists
  }

  @Post('reset-password')
  @HttpCode(204)
  @RateLimit({ name: 'reset', limit: 10, windowSeconds: 3600 })
  @ZodBody(resetPasswordSchema)
  async reset(@body(resetPasswordSchema) dto: z.infer<typeof resetPasswordSchema>, @Req() req: Request) {
    await this.auth.resetPassword(dto.token, dto.password, info(req));
  }

  @Post('reset-password-code')
  @HttpCode(204)
  @RateLimit({ name: 'reset-code', limit: 20, windowSeconds: 3600 })
  @ZodBody(resetPasswordCodeSchema)
  async resetWithCode(@body(resetPasswordCodeSchema) dto: z.infer<typeof resetPasswordCodeSchema>, @Req() req: Request) {
    await this.auth.resetPasswordWithCode(dto.email, dto.code, dto.password, info(req));
  }
}
