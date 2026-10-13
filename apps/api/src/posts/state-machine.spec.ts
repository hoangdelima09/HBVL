import { describe, expect, it } from 'vitest';
import { POST_STATUSES, type PostStatusName, type RoleName } from '@hbvl/contracts';
import { canSeePost, evaluate, type PostAction } from './state-machine';

const ROLES: RoleName[] = ['ADMIN', 'COLLABORATOR', 'MEMBER'];
const ACTIONS: PostAction[] = ['OWNER_EDIT', 'SUBMIT', 'STAFF_EDIT', 'REQUEST_CHANGES', 'REJECT', 'PUBLISH', 'UNPUBLISH', 'ADMIN_EDIT', 'DELETE', 'RESTORE'];

const outcome = (a: PostAction, s: PostStatusName, role: RoleName, isOwner: boolean, authorRole: RoleName | null = 'MEMBER') => {
  const d = evaluate(a, s, { role, isOwner, authorRole });
  return d.allow ? `ok:${d.to ?? '-'}` : d.code;
};

describe('submission state machine', () => {
  it('sender: submit from DRAFT / CHANGES_REQUESTED only', () => {
    expect(outcome('SUBMIT', 'DRAFT', 'MEMBER', true)).toBe('ok:PENDING_REVIEW');
    expect(outcome('SUBMIT', 'CHANGES_REQUESTED', 'MEMBER', true)).toBe('ok:PENDING_REVIEW');
    for (const s of ['PENDING_REVIEW', 'REJECTED', 'PUBLISHED', 'PRIVATE', 'TRASHED'] as const) {
      expect(outcome('SUBMIT', s, 'MEMBER', true)).toBe('STATE_LOCKED');
    }
    expect(outcome('SUBMIT', 'DRAFT', 'MEMBER', false)).toBe('FORBIDDEN_ACTION');
  });

  it('sender cannot edit locked states (pending, published, rejected)', () => {
    expect(outcome('OWNER_EDIT', 'DRAFT', 'MEMBER', true)).toBe('ok:-');
    expect(outcome('OWNER_EDIT', 'CHANGES_REQUESTED', 'MEMBER', true)).toBe('ok:-');
    for (const s of ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED'] as const) expect(outcome('OWNER_EDIT', s, 'MEMBER', true)).toBe('STATE_LOCKED');
    expect(outcome('OWNER_EDIT', 'DRAFT', 'MEMBER', false)).toBe('FORBIDDEN_ACTION');
  });

  it("collaborator handles everything that is not the administrator's: review, publish, reject, unpublish, edit, delete, restore", () => {
    expect(outcome('STAFF_EDIT', 'PENDING_REVIEW', 'COLLABORATOR', false)).toBe('ok:-');
    expect(outcome('REQUEST_CHANGES', 'PENDING_REVIEW', 'COLLABORATOR', false)).toBe('ok:CHANGES_REQUESTED');
    expect(outcome('PUBLISH', 'PENDING_REVIEW', 'COLLABORATOR', false)).toBe('ok:PUBLISHED');
    expect(outcome('PUBLISH', 'PRIVATE', 'COLLABORATOR', false)).toBe('ok:PUBLISHED');
    expect(outcome('REJECT', 'PENDING_REVIEW', 'COLLABORATOR', false)).toBe('ok:REJECTED');
    expect(outcome('UNPUBLISH', 'PUBLISHED', 'COLLABORATOR', false)).toBe('ok:PRIVATE');
    expect(outcome('ADMIN_EDIT', 'PUBLISHED', 'COLLABORATOR', false)).toBe('ok:-');
    expect(outcome('DELETE', 'PUBLISHED', 'COLLABORATOR', false)).toBe('ok:TRASHED');
    expect(outcome('RESTORE', 'TRASHED', 'COLLABORATOR', false)).toBe('ok:DRAFT');
    // wrong state is still locked
    expect(outcome('STAFF_EDIT', 'PUBLISHED', 'COLLABORATOR', false)).toBe('STATE_LOCKED');
    expect(outcome('STAFF_EDIT', 'DRAFT', 'COLLABORATOR', false)).toBe('STATE_LOCKED');
    expect(outcome('REJECT', 'PUBLISHED', 'COLLABORATOR', false)).toBe('STATE_LOCKED');
  });

  it('collaborator never reviews their own post (conflict of interest)', () => {
    expect(outcome('PUBLISH', 'PENDING_REVIEW', 'COLLABORATOR', true, 'COLLABORATOR')).toBe('FORBIDDEN_ACTION');
    expect(outcome('REQUEST_CHANGES', 'PENDING_REVIEW', 'COLLABORATOR', true, 'COLLABORATOR')).toBe('FORBIDDEN_ACTION');
    expect(outcome('REJECT', 'PENDING_REVIEW', 'COLLABORATOR', true, 'COLLABORATOR')).toBe('FORBIDDEN_ACTION');
  });

  it('collaborator cannot touch a post written by an administrator; the administrator can', () => {
    for (const a of ['STAFF_EDIT', 'REQUEST_CHANGES', 'REJECT', 'PUBLISH', 'UNPUBLISH', 'ADMIN_EDIT', 'DELETE', 'RESTORE'] as const) {
      for (const s of POST_STATUSES) expect(outcome(a, s, 'COLLABORATOR', false, 'ADMIN')).toBe('FORBIDDEN_ACTION');
    }
    expect(outcome('DELETE', 'PUBLISHED', 'ADMIN', false, 'ADMIN')).toBe('ok:TRASHED');
    expect(outcome('UNPUBLISH', 'PUBLISHED', 'ADMIN', false, 'ADMIN')).toBe('ok:PRIVATE');
  });

  it('admin publishes / rejects / unpublishes per the diagram', () => {
    expect(outcome('PUBLISH', 'PENDING_REVIEW', 'ADMIN', false)).toBe('ok:PUBLISHED');
    expect(outcome('REJECT', 'PENDING_REVIEW', 'ADMIN', false)).toBe('ok:REJECTED');
    expect(outcome('UNPUBLISH', 'PUBLISHED', 'ADMIN', false)).toBe('ok:PRIVATE');
    expect(outcome('PUBLISH', 'PRIVATE', 'ADMIN', false)).toBe('ok:PUBLISHED');
    expect(outcome('PUBLISH', 'DRAFT', 'ADMIN', false)).toBe('STATE_LOCKED');
    expect(outcome('REJECT', 'PUBLISHED', 'ADMIN', false)).toBe('STATE_LOCKED');
  });

  it('delete: admin any; collaborator any non-admin post; member never', () => {
    expect(outcome('DELETE', 'PUBLISHED', 'ADMIN', false)).toBe('ok:TRASHED');
    expect(outcome('DELETE', 'DRAFT', 'COLLABORATOR', true)).toBe('ok:TRASHED');
    expect(outcome('DELETE', 'PUBLISHED', 'COLLABORATOR', true)).toBe('ok:TRASHED');
    expect(outcome('DELETE', 'PUBLISHED', 'COLLABORATOR', false)).toBe('ok:TRASHED');
    expect(outcome('DELETE', 'TRASHED', 'COLLABORATOR', false)).toBe('STATE_LOCKED');
    expect(outcome('DELETE', 'DRAFT', 'MEMBER', true)).toBe('FORBIDDEN_ACTION');
  });

  it('is total: every (role × owner × status × action) yields a defined decision and no member can ever publish/reject', () => {
    for (const role of ROLES)
      for (const isOwner of [true, false])
        for (const s of POST_STATUSES)
          for (const a of ACTIONS) {
            const o = outcome(a, s, role, isOwner);
            expect(o).toBeTruthy();
            if (role === 'MEMBER' && ['PUBLISH', 'REJECT', 'UNPUBLISH', 'ADMIN_EDIT', 'STAFF_EDIT', 'REQUEST_CHANGES', 'RESTORE'].includes(a)) {
              expect(o.startsWith('ok')).toBe(false);
            }
            if (role === 'MEMBER' && ['REJECT', 'UNPUBLISH'].includes(a)) expect(o.startsWith('ok')).toBe(false);
            if (role === 'MEMBER' && a === 'PUBLISH') expect(o.startsWith('ok')).toBe(false);
          }
  });
});

describe('canSeePost (404 vs 403 policy input)', () => {
  const post = (status: PostStatusName, authorId: string | null = 'author') => ({ authorId, status });
  it('member sees only own non-trashed posts', () => {
    expect(canSeePost({ role: 'MEMBER', userId: 'author' }, post('DRAFT'))).toBe(true);
    expect(canSeePost({ role: 'MEMBER', userId: 'other' }, post('DRAFT'))).toBe(false);
    expect(canSeePost({ role: 'MEMBER', userId: 'author' }, post('TRASHED'))).toBe(false);
  });
  it("collaborator sees others' posts once submitted (not their drafts), never an administrator's", () => {
    expect(canSeePost({ role: 'COLLABORATOR', userId: 'c' }, post('PENDING_REVIEW'))).toBe(true);
    expect(canSeePost({ role: 'COLLABORATOR', userId: 'c' }, post('PUBLISHED'))).toBe(true);
    expect(canSeePost({ role: 'COLLABORATOR', userId: 'c' }, post('TRASHED'))).toBe(true);
    expect(canSeePost({ role: 'COLLABORATOR', userId: 'c' }, post('DRAFT'))).toBe(false);
    expect(canSeePost({ role: 'COLLABORATOR', userId: 'c' }, post('CHANGES_REQUESTED'), true)).toBe(true);
    expect(canSeePost({ role: 'COLLABORATOR', userId: 'c' }, { ...post('PENDING_REVIEW'), authorRole: 'ADMIN' })).toBe(false);
    expect(canSeePost({ role: 'ADMIN', userId: 'a' }, { ...post('DRAFT'), authorRole: 'MEMBER' })).toBe(true);
  });
  it('admin sees everything', () => {
    expect(canSeePost({ role: 'ADMIN', userId: 'a' }, post('TRASHED'))).toBe(true);
  });
});
