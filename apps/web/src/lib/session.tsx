'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, post, setCsrfToken } from './client';
import type { Locale } from './i18n';

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'COLLABORATOR' | 'MEMBER';
  emailVerified: boolean;
  mfaEnabled: boolean;
  locale: Locale | 'ja';
  /** An administrator reset the password: only "change password" works until the person picks a new one. */
  mustChangePassword: boolean;
  /** Set while the account is restricted (cannot comment/like/submit); `until` null = until lifted. */
  restriction: { until: string | null; reason: string | null } | null;
}
interface Ctx {
  user: SessionUser | null;
  mfaVerified: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const SessionCtx = createContext<Ctx>({ user: null, mfaVerified: false, loading: true, refresh: async () => undefined, logout: async () => undefined });

/** Personal state lives ONLY here (fetched in the browser, `no-store`); server-rendered HTML never contains it. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ user: SessionUser | null; mfaVerified: boolean; loading: boolean }>({ user: null, mfaVerified: false, loading: true });
  const refresh = useCallback(async () => {
    try {
      const r = await get<{ user: SessionUser | null; mfaVerified: boolean; csrfToken?: string }>('/auth/me');
      setCsrfToken(r.csrfToken);
      setState({ user: r.user, mfaVerified: r.mfaVerified, loading: false });
    } catch {
      setState({ user: null, mfaVerified: false, loading: false });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setState({ user: null, mfaVerified: false, loading: false });
    }
  }, []);
  const value = useMemo(() => ({ ...state, refresh, logout }), [state, refresh, logout]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
export const useSession = () => useContext(SessionCtx);
