import { describe, expect, it } from 'vitest';
import { checksumOf, cleanWpSlug, detectLocale, looksEncodingDamaged, localToUtc, mapCommentStatus, mapPostStatus, mapRoles, parseLegacyContact, SlugAllocator } from './mappers';

describe('role mapping (never escalates)', () => {
  it('maps the known roles', () => {
    expect(mapRoles('a:1:{s:13:"administrator";b:1;}').role).toBe('ADMIN');
    expect(mapRoles('a:1:{s:19:"riseup_collaborator";b:1;}').role).toBe('COLLABORATOR');
    expect(mapRoles('a:1:{s:10:"subscriber";b:1;}').role).toBe('MEMBER');
    expect(mapRoles('a:1:{s:13:"riseup_member";b:1;}').role).toBe('MEMBER');
  });
  it('maps unknown roles to MEMBER and reports them', () => {
    const r = mapRoles('a:1:{s:6:"editor";b:1;}');
    expect(r.role).toBe('MEMBER');
    expect(r.issue?.code).toBe('UNKNOWN_ROLE');
    expect(mapRoles('a:1:{s:9:"shop_manager";b:1;}').role).toBe('MEMBER');
  });
  it('an unknown role next to a known one never raises privileges beyond the known one', () => {
    const r = mapRoles('a:2:{s:10:"subscriber";b:1;s:6:"editor";b:1;}');
    expect(r.role).toBe('MEMBER');
  });
  it('malformed or missing capabilities become MEMBER', () => {
    expect(mapRoles('garbage').role).toBe('MEMBER');
    expect(mapRoles(undefined).issue?.code).toBe('NO_ROLE');
    expect(mapRoles('O:8:"stdClass":0:{}').role).toBe('MEMBER');
  });
});

describe('status mapping', () => {
  const meta = (o: Record<string, string>) => new Map(Object.entries(o));
  it('maps the standard statuses', () => {
    const m = (status: string) => mapPostStatus({ status, password: '', meta: undefined, isSubmissionType: true }).status;
    expect([m('publish'), m('future'), m('private'), m('trash'), m('pending'), m('draft')]).toEqual(['PUBLISHED', 'SCHEDULED', 'PRIVATE', 'TRASHED', 'PENDING_REVIEW', 'DRAFT']);
  });
  it('submission review meta restores CHANGES_REQUESTED / REJECTED with the reason', () => {
    const r = mapPostStatus({ status: 'draft', password: '', meta: meta({ _submission_review: 'changes', _submission_reason: 'Thiếu nguồn' }), isSubmissionType: true });
    expect(r.status).toBe('CHANGES_REQUESTED');
    expect(r.review).toEqual({ action: 'REQUEST_CHANGES', reason: 'Thiếu nguồn' });
    expect(mapPostStatus({ status: 'draft', password: '', meta: meta({ _submission_review: 'rejected' }), isSubmissionType: true }).status).toBe('REJECTED');
    expect(mapPostStatus({ status: 'draft', password: '', meta: meta({ _submission_review: 'rejected' }), isSubmissionType: false }).status).toBe('DRAFT');
  });
  it('password-protected content is never public', () => {
    const r = mapPostStatus({ status: 'publish', password: 'secret', meta: undefined, isSubmissionType: true });
    expect(r.status).toBe('PRIVATE');
    expect(JSON.stringify(r)).not.toContain('secret');
  });
  it('auto-drafts are skipped; unknown statuses are flagged', () => {
    expect(mapPostStatus({ status: 'auto-draft', password: '', meta: undefined, isSubmissionType: true }).skip).toBe(true);
    expect(mapPostStatus({ status: 'weird', password: '', meta: undefined, isSubmissionType: true }).issue?.code).toBe('UNKNOWN_POST_STATUS');
  });
});

describe('misc mappers', () => {
  it('slugs: strips __trashed, falls back to title then id, and allocates unique suffixes', () => {
    expect(cleanWpSlug('hello-world__trashed', 'Hello', '1')).toBe('hello-world');
    expect(cleanWpSlug('', 'Học bổng Đồng Tháp', '9')).toBe('hoc-bong-dong-thap');
    expect(cleanWpSlug('', '???', '9')).toBe('wp-9');
    const a = new SlugAllocator(['x']);
    expect(a.take('x')).toEqual({ slug: 'x-2', changed: true });
    expect(a.take('x').slug).toBe('x-3');
    expect(a.take('y')).toEqual({ slug: 'y', changed: false });
  });
  it('parses legacy contact bodies', () => {
    expect(parseLegacyContact('Họ tên: An\nEmail: a@x.org\n\nXin chào', undefined)).toEqual({ name: 'An', email: 'a@x.org', message: 'Xin chào' });
    expect(parseLegacyContact('free text', 'm@x.org')).toEqual({ name: null, email: 'm@x.org', message: 'free text' });
  });
  it('comment statuses never publish spam/trash', () => {
    expect(['1', '0', 'spam', 'trash', 'post-trashed'].map(mapCommentStatus)).toEqual(['APPROVED', 'PENDING', 'SPAM', 'TRASHED', 'TRASHED']);
  });
  it('converts site-local datetimes to UTC', () => {
    expect(localToUtc('2026-03-12 23:46:39', 'Asia/Ho_Chi_Minh')?.toISOString()).toBe('2026-03-12T16:46:39.000Z');
    expect(localToUtc('0000-00-00 00:00:00', 'Asia/Ho_Chi_Minh')).toBeNull();
  });
  it('detects export-time encoding damage but not normal text', () => {
    expect(looksEncodingDamaged('Tin t?c & Blog')).toBe(true);
    expect(looksEncodingDamaged('Trang ch?')).toBe(true);
    expect(looksEncodingDamaged('Tin tức & Blog')).toBe(false);
  });
  it('checksum is key-order independent', () => {
    expect(checksumOf({ a: 1, b: [1, { y: 1, x: 2 }] })).toBe(checksumOf({ b: [1, { x: 2, y: 1 }], a: 1 }));
    expect(checksumOf({ a: 1 })).not.toBe(checksumOf({ a: 2 }));
  });
  it('detects English text even when it contains Vietnamese proper nouns, and Vietnamese text', () => {
    expect(detectLocale('The Day We Showed Up: Our visit to Mái Ấm Bình Minh was a day that we will remember, and it is what we are going back for in the spring.')).toBe('en');
    expect(detectLocale('Học bổng Đồng Tháp năm nay dành cho học sinh có hoàn cảnh khó khăn nhưng vượt khó học giỏi trong năm học vừa qua.')).toBe('vi');
    expect(detectLocale('Hoc bong')).toBe('vi'); // too short to call
  });
});
