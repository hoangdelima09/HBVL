import { applyDecorators, CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiExtension } from '@nestjs/swagger';
import type { Role } from '@hbvl/database';
import type { Request } from 'express';
import { E } from '../common/errors';
import { isRestricted, type AuthContext } from './auth.types';

export interface AuthOptions {
  /** Allowed roles (any if omitted). */
  roles?: Role[];
  /** Require a verified e-mail address (anti-abuse for write actions; see docs/PERMISSIONS.md §3). */
  verified?: boolean;
  /** Require a completed MFA step (admin area). */
  mfa?: boolean;
}

const AUTH_META = 'hbvl:auth';
const ALLOW_MUST_CHANGE = 'hbvl:allow-must-change';

/** Handlers that stay usable while a forced password change is pending (change password, sign out, MFA step). */
export const AllowWhilePasswordChangePending = () => SetMetadata(ALLOW_MUST_CHANGE, true);

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const opts =
      (Reflect.getMetadata(AUTH_META, context.getHandler()) as AuthOptions | undefined) ?? (Reflect.getMetadata(AUTH_META, context.getClass()) as AuthOptions | undefined) ?? {};
    const auth = req.auth;
    if (!auth) throw E.unauthenticated();
    if (auth.user.mustChangePassword && !Reflect.getMetadata(ALLOW_MUST_CHANGE, context.getHandler())) {
      throw E.forbidden('Bạn cần đổi mật khẩu trước khi tiếp tục.', 'PASSWORD_CHANGE_REQUIRED');
    }
    if (opts.roles && !opts.roles.includes(auth.user.role)) throw E.forbidden();
    if (opts.verified && !auth.user.emailVerifiedAt) {
      throw E.forbidden('Bạn cần xác minh email trước khi thực hiện thao tác này.', 'EMAIL_NOT_VERIFIED');
    }
    // `verified` marks the interactive write endpoints (comment, like, submit, feedback, contact): restricted accounts stay signed in but cannot use them.
    if (opts.verified && isRestricted(auth.user)) {
      const until = auth.user.restrictedUntil ? ` đến ${auth.user.restrictedUntil.toISOString().slice(0, 10)}` : '';
      throw E.forbidden(`Tài khoản của bạn đang bị hạn chế tương tác${until}.`, 'ACCOUNT_RESTRICTED');
    }
    if (opts.mfa) {
      if (!auth.user.mfaEnabled) throw E.forbidden('Tài khoản quản trị cần bật xác thực hai lớp (MFA).', 'MFA_ENROLL_REQUIRED');
      if (!auth.session.mfaVerifiedAt) throw E.forbidden('Cần xác thực hai lớp để tiếp tục.', 'MFA_REQUIRED');
    }
    return true;
  }
}

/** Require an authenticated session (+ optional role / verified-email / MFA). Works on a controller or a handler. */
export const Auth = (opts: AuthOptions = {}) =>
  applyDecorators(SetMetadata(AUTH_META, opts), UseGuards(AuthGuard), ApiCookieAuth(), ApiExtension('x-roles', opts.roles ?? ['ANY_AUTHENTICATED']));

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) throw E.unauthenticated();
  return req.auth;
});

/** Optional auth: the context if a valid session exists, otherwise undefined. */
export const MaybeAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext | undefined => ctx.switchToHttp().getRequest<Request>().auth);
