import type { LocaleName } from '@hbvl/contracts';
import type { Role, UserStatus } from '@hbvl/database';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  mfaEnabled: boolean;
  locale: LocaleName;
  /** An administrator reset the password to the default: only changing it (and signing out) is allowed until then. */
  mustChangePassword: boolean;
  /** Set while the account is restricted (cannot comment/like/submit); `until` null = until lifted by staff. */
  restrictedAt: Date | null;
  restrictedUntil: Date | null;
  restrictionReason: string | null;
}

export const isRestricted = (u: Pick<AuthUser, 'restrictedAt' | 'restrictedUntil'>, now = Date.now()): boolean =>
  u.restrictedAt !== null && (u.restrictedUntil === null || u.restrictedUntil.getTime() > now);

export interface AuthSession {
  id: string;
  mfaVerifiedAt: Date | null;
  rememberMe: boolean;
  expiresAt: Date;
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
}

/** What the browser is allowed to see about the current user. */
export function toPublicUser(u: AuthUser) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    emailVerified: u.emailVerifiedAt !== null,
    mfaEnabled: u.mfaEnabled,
    locale: u.locale,
    mustChangePassword: u.mustChangePassword,
    restriction: isRestricted(u) ? { until: u.restrictedUntil, reason: u.restrictionReason } : null,
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;
