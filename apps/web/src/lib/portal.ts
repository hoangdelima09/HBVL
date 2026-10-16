/** Sign-in portal = the role an account must have to use it (login, forgot password, reset link). */
export type Portal = 'ADMIN' | 'COLLABORATOR' | 'MEMBER';

/** `?cong=` value carried by the forgot-password page and the e-mailed reset link (must match the API's PORTAL_SLUG). */
export const PORTAL_SLUG: Record<Portal, string> = { ADMIN: 'quan-tri', COLLABORATOR: 'cong-tac-vien', MEMBER: 'thanh-vien' };

export const PORTAL_LOGIN_PATH: Record<Portal, string> = {
  ADMIN: '/dang-nhap-quan-tri',
  COLLABORATOR: '/dang-nhap-cong-tac-vien',
  MEMBER: '/dang-nhap-thanh-vien',
};

/** Reads the portal from the page query; anything unknown is the member portal. `?quan-tri=1` is the older admin form of the link. */
export function portalFromQuery(q: Record<string, string | string[] | undefined>): Portal {
  const cong = Array.isArray(q.cong) ? q.cong[0] : q.cong;
  const found = (Object.keys(PORTAL_SLUG) as Portal[]).find((p) => PORTAL_SLUG[p] === cong);
  if (found) return found;
  return q['quan-tri'] === '1' ? 'ADMIN' : 'MEMBER';
}
