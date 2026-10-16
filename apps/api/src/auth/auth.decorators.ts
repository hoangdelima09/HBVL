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

const ALLOW_BEFORE_MFA = 'hbvl:allow-before-mfa';

/** Handlers that stay usable while a forced password change is pending (change password, sign out, MFA step). */
export const AllowWhilePasswordChangePending = () => SetMetadata(ALLOW_MUST_CHANGE, true);

/**
 * Handlers usable after the password step but BEFORE the two-factor step (verify the code, sign out, recover a lost authenticator).
 * Everything else refuses a session whose two-factor step is still pending.
 */
export const AllowBeforeMfa = () => SetMetadata(ALLOW_BEFORE_MFA, true);

/** A signed-in session of an account with two-factor authentication that has not completed the second step yet. */
export const mfaPending = (a: AuthContext | undefined): boolean => !!a && a.user.mfaEnabled && !a.session.mfaVerifiedAt;

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const opts =
      (Reflect.getMetadata(AUTH_META, context.getHandler()) as AuthOptions | undefined) ?? (Reflect.getMetadata(AUTH_META, context.getClass()) as AuthOptions | undefined) ?? {};
    const auth = req.auth;
    if (!auth) throw E.unauthenticated();
    // Two-factor authentication applies to EVERY role that enabled it, not only to the admin area: until the code is entered the
    // session can only finish (or recover) the second step. Without this, a password alone would open a member's protected account.
    if (mfaPending(auth) && !Reflect.getMetadata(ALLOW_BEFORE_MFA, context.getHandler())) {
      throw E.forbidden('Cần xác thực hai lớp để tiếp tục.', 'MFA_REQUIRED');
    }
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

/** Optional auth: the context if a valid, fully signed-in session exists (two-factor step done when enabled), otherwise undefined. */
export const MaybeAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext | undefined => {
  const a = ctx.switchToHttp().getRequest<Request>().auth;
  return mfaPending(a) ? undefined : a;
});
