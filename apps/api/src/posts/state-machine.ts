import type { PostStatusName, RoleName } from '@hbvl/contracts';

/**
 * Pure submission workflow (no I/O). Single place where "who may do what in which state" is decided.
 *
 *   DRAFT ──submit──▶ PENDING_REVIEW ──request-changes──▶ CHANGES_REQUESTED ──resubmit──▶ PENDING_REVIEW
 *                          │── publish (COLLABORATOR not-own | ADMIN) ──▶ PUBLISHED ──unpublish──▶ PRIVATE ──publish──▶ PUBLISHED
 *                          └── reject ──▶ REJECTED          (any status, staff) ── delete ──▶ TRASHED ── restore ──▶ DRAFT
 *
 * A collaborator may do everything an admin may do to a post EXCEPT things that belong to an administrator: posts written by an
 * ADMIN account (`authorRole`). Administrator-only areas (users' roles, settings, import, audit…) live outside this file.
 */
export type PostAction = 'OWNER_EDIT' | 'SUBMIT' | 'STAFF_EDIT' | 'REQUEST_CHANGES' | 'REJECT' | 'PUBLISH' | 'UNPUBLISH' | 'ADMIN_EDIT' | 'DELETE' | 'RESTORE';

export interface ActorCtx {
  role: RoleName;
  isOwner: boolean;
  /** Role of the post's author (null = unknown/removed). Posts written by an ADMIN are administrator-owned. */
  authorRole?: RoleName | null;
}

export type Decision = { allow: true; to: PostStatusName | null } | { allow: false; code: 'FORBIDDEN_ACTION' | 'STATE_LOCKED' };

const ok = (to: PostStatusName | null = null): Decision => ({ allow: true, to });
const forbidden: Decision = { allow: false, code: 'FORBIDDEN_ACTION' };
const locked: Decision = { allow: false, code: 'STATE_LOCKED' };

const isStaff = (r: RoleName) => r === 'ADMIN' || r === 'COLLABORATOR';
/** A collaborator may not act on content that belongs to an administrator. */
const adminOwned = (a: ActorCtx) => a.role === 'COLLABORATOR' && a.authorRole === 'ADMIN';

export function evaluate(action: PostAction, status: PostStatusName, a: ActorCtx): Decision {
  switch (action) {
    case 'OWNER_EDIT':
      if (!a.isOwner) return forbidden;
      return status === 'DRAFT' || status === 'CHANGES_REQUESTED' ? ok() : locked; // PENDING/PUBLISHED/REJECTED are locked for the sender

    case 'SUBMIT':
      if (!a.isOwner) return forbidden;
      return status === 'DRAFT' || status === 'CHANGES_REQUESTED' ? ok('PENDING_REVIEW') : locked;

    case 'STAFF_EDIT':
    case 'REQUEST_CHANGES': {
      if (!isStaff(a.role) || adminOwned(a)) return forbidden;
      if (a.role === 'COLLABORATOR' && a.isOwner) return forbidden; // no self-review (conflict of interest)
      if (status !== 'PENDING_REVIEW') return locked;
      return ok(action === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : null);
    }

    case 'REJECT':
      if (!isStaff(a.role) || adminOwned(a)) return forbidden;
      if (a.role === 'COLLABORATOR' && a.isOwner) return forbidden; // no self-review
      return status === 'PENDING_REVIEW' ? ok('REJECTED') : locked;

    case 'PUBLISH':
      if (a.role === 'COLLABORATOR') {
        if (a.isOwner || adminOwned(a)) return forbidden; // no self-approval (conflict of interest)
        return status === 'PENDING_REVIEW' || status === 'PRIVATE' ? ok('PUBLISHED') : locked;
      }
      if (a.role !== 'ADMIN') return forbidden;
      return status === 'PENDING_REVIEW' || status === 'PRIVATE' ? ok('PUBLISHED') : locked;

    case 'UNPUBLISH':
      if (!isStaff(a.role) || adminOwned(a)) return forbidden;
      return status === 'PUBLISHED' ? ok('PRIVATE') : locked;

    case 'ADMIN_EDIT':
      // Editing a post that is not waiting for review (published, private, rejected…). Collaborators: any post that is not the administrator's.
      if (!isStaff(a.role) || adminOwned(a)) return forbidden;
      return status === 'TRASHED' ? locked : ok();

    case 'DELETE':
      if (!isStaff(a.role) || adminOwned(a)) return forbidden; // members only had `read`; collaborators: any status, any non-admin author
      return status === 'TRASHED' ? locked : ok('TRASHED');

    case 'RESTORE':
      if (!isStaff(a.role) || adminOwned(a)) return forbidden;
      return status === 'TRASHED' ? ok('DRAFT') : locked;
  }
}

/** Who may SEE a non-public post at all. Anything else must answer 404, never 403 (no existence oracle). */
export function canSeePost(
  a: { role: RoleName; userId: string },
  post: { authorId: string | null; status: PostStatusName; authorRole?: RoleName | null },
  hasReviewedIt = false,
): boolean {
  if (a.role === 'ADMIN') return true;
  if (post.authorId === a.userId) return post.status !== 'TRASHED';
  if (a.role === 'COLLABORATOR') {
    if (post.authorRole === 'ADMIN') return false; // administrator-owned
    // Everything that left the author's hands (never someone else's private DRAFT): review queue, published, hidden, rejected, trashed.
    return post.status !== 'DRAFT' || hasReviewedIt;
  }
  return false;
}
