import { createHash } from 'node:crypto';
import { foldVietnamese, slugify, type LocaleName } from '@hbvl/contracts';
import type { PostStatus, Role } from '@hbvl/database';
import { tryPhpUnserialize } from './php-unserialize';

/** Canonical JSON (sorted keys) → sha256. Used for `LegacyIdMap.sourceChecksum` / `importedChecksum`. */
export function checksumOf(value: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, x]) => [k, canon(x)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canon(value)))
    .digest('hex');
}

// ───────────────────────── roles ─────────────────────────
export interface RoleMapping {
  role: Role;
  issue?: { code: 'UNKNOWN_ROLE' | 'NO_ROLE' | 'MULTIPLE_ROLES'; message: string; detail: Record<string, unknown> };
}

const ROLE_MAP: Record<string, Role> = { administrator: 'ADMIN', riseup_collaborator: 'COLLABORATOR', riseup_member: 'MEMBER', subscriber: 'MEMBER' };
const RANK: Record<Role, number> = { MEMBER: 0, COLLABORATOR: 1, ADMIN: 2 };

/** Unknown WordPress roles NEVER escalate: they become MEMBER and are reported for a human decision. */
export function mapRoles(capabilitiesSerialized: string | undefined): RoleMapping {
  const caps = tryPhpUnserialize(capabilitiesSerialized);
  const wpRoles =
    caps && typeof caps === 'object' && !Array.isArray(caps)
      ? Object.entries(caps)
          .filter(([, v]) => v === true || v === 1)
          .map(([k]) => k)
      : [];
  if (wpRoles.length === 0) return { role: 'MEMBER', issue: { code: 'NO_ROLE', message: 'Tài khoản WordPress không có vai trò nào; gán MEMBER.', detail: {} } };
  const known = wpRoles.filter((r) => r in ROLE_MAP);
  const unknown = wpRoles.filter((r) => !(r in ROLE_MAP));
  const role = known.map((r) => ROLE_MAP[r]!).sort((a, b) => RANK[b] - RANK[a])[0] ?? 'MEMBER';
  if (unknown.length)
    return {
      role,
      issue: { code: 'UNKNOWN_ROLE', message: `Vai trò WordPress không có tương ứng (${unknown.join(', ')}); không nâng quyền — gán ${role}.`, detail: { wpRoles, unknown } },
    };
  if (known.length > 1)
    return { role, issue: { code: 'MULTIPLE_ROLES', message: `Nhiều vai trò (${known.join(', ')}); chọn quyền cao nhất đã biết: ${role}.`, detail: { wpRoles } } };
  return { role };
}

// ───────────────────────── dates ─────────────────────────
const ZERO = /^0000-00-00/;

/** Interprets a WordPress "local" datetime (site timezone) as UTC. Works for any IANA zone via Intl. */
export function localToUtc(local: string, timeZone: string): Date | null {
  if (!local || ZERO.test(local)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    // Offset of `timeZone` at that instant, found by formatting the guess and measuring the difference (two passes settle DST edges).
    let guess = asUtc;
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date(guess));
      const g = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)])) as Record<string, number>;
      const shown = Date.UTC(g.year!, g.month! - 1, g.day!, g.hour!, g.minute!, g.second!);
      guess = asUtc - (shown - guess);
    }
    return new Date(guess);
  } catch {
    return new Date(asUtc);
  }
}

export function gmtToDate(gmt: string): Date | null {
  if (!gmt || ZERO.test(gmt)) return null;
  const d = new Date(gmt.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Best available UTC creation/publication time: `_gmt` column first, else the local column converted with the site timezone. */
export function wpInstant(gmt: string, local: string, timeZone: string): Date | null {
  return gmtToDate(gmt) ?? localToUtc(local, timeZone);
}

// ───────────────────────── post status ─────────────────────────
export interface StatusMapping {
  status: PostStatus;
  issue?: { code: string; message: string; severity: 'INFO' | 'WARNING' };
  review?: { action: 'REQUEST_CHANGES' | 'REJECT'; reason: string | null };
  skip?: boolean;
  needsReview?: boolean;
}

/**
 * WordPress → new workflow. Submission outcomes were stored as `draft` + `_submission_review` ∈ {changes, rejected} (+ `_submission_reason`);
 * `pending` is awaiting review. Password-protected content is never made public (and the password is never imported).
 */
export function mapPostStatus(input: { status: string; password: string; meta: ReadonlyMap<string, string> | undefined; isSubmissionType: boolean }): StatusMapping {
  const review = input.meta?.get('_submission_review');
  const reason = input.meta?.get('_submission_reason')?.trim() || null;
  if (input.password) {
    return {
      status: 'PRIVATE',
      needsReview: true,
      issue: {
        code: 'PASSWORD_PROTECTED',
        severity: 'WARNING',
        message: 'Nội dung có mật khẩu: nhập ở trạng thái riêng tư, KHÔNG nhập mật khẩu; admin quyết định công khai hay không.',
      },
    };
  }
  switch (input.status) {
    case 'publish':
      return { status: 'PUBLISHED' };
    case 'future':
      return { status: 'SCHEDULED' };
    case 'private':
      return { status: 'PRIVATE' };
    case 'trash':
      return { status: 'TRASHED' };
    case 'pending':
      return { status: 'PENDING_REVIEW' };
    case 'draft':
      if (input.isSubmissionType && review === 'changes') return { status: 'CHANGES_REQUESTED', review: { action: 'REQUEST_CHANGES', reason } };
      if (input.isSubmissionType && review === 'rejected') return { status: 'REJECTED', review: { action: 'REJECT', reason } };
      return { status: 'DRAFT' };
    case 'auto-draft':
      return { status: 'DRAFT', skip: true };
    default:
      return {
        status: 'DRAFT',
        needsReview: true,
        issue: { code: 'UNKNOWN_POST_STATUS', severity: 'WARNING', message: `Trạng thái WordPress "${input.status}" không có tương ứng; nhập dưới dạng DRAFT.` },
      };
  }
}

// ───────────────────────── slugs ─────────────────────────
/** WordPress appends `__trashed` to the slug of trashed posts. */
export function cleanWpSlug(name: string, title: string, id: string): string {
  const base = name.replace(/__trashed$/, '');
  const s = slugify(base) || slugify(title) || `wp-${id}`;
  return s.slice(0, 190);
}

export class SlugAllocator {
  private readonly used: Set<string>;
  constructor(existing: Iterable<string> = []) {
    this.used = new Set(existing);
  }
  /** Returns a free slug (suffix -2, -3… on collision) and whether it had to change. */
  take(slug: string): { slug: string; changed: boolean } {
    if (!this.used.has(slug)) {
      this.used.add(slug);
      return { slug, changed: false };
    }
    for (let i = 2; ; i++) {
      const candidate = `${slug.slice(0, 190)}-${i}`;
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        return { slug: candidate, changed: true };
      }
    }
  }
}

// ───────────────────────── contact / feedback ─────────────────────────
/** The legacy theme stored contact messages as "Họ tên: X\nEmail: Y\n\nBody". */
export function parseLegacyContact(content: string, metaEmail: string | undefined): { name: string | null; email: string | null; message: string } {
  const m = /^Họ tên:\s*(.*)\r?\nEmail:\s*(.*)\r?\n\r?\n([\s\S]*)$/.exec(content);
  if (m) return { name: m[1]!.trim() || null, email: metaEmail || m[2]!.trim() || null, message: m[3]!.trim() };
  return { name: null, email: metaEmail || null, message: content.trim() };
}

export function mapCommentStatus(approved: string): 'APPROVED' | 'PENDING' | 'SPAM' | 'TRASHED' {
  switch (approved) {
    case '1':
      return 'APPROVED';
    case '0':
      return 'PENDING';
    case 'spam':
      return 'SPAM';
    default:
      return 'TRASHED'; // 'trash' | 'post-trashed' | unknown → never public
  }
}

export const folded = (s: string): string => foldVietnamese(s);

/**
 * Heuristic for the export-time encoding loss seen in the real dump ("Trang ch?", "Tin t?c"): a literal `?` glued to a letter
 * (inside a word or ending one). Over-reporting is intentional — the result is a WARNING for a human, never an automatic change.
 */
export function looksEncodingDamaged(title: string): boolean {
  return /\p{L}\?(?:\p{L}|\s|$)/u.test(title);
}

// ───────────────────────── language ─────────────────────────
const ENGLISH_STOPWORDS = new Set(['the', 'and', 'of', 'to', 'we', 'our', 'is', 'in', 'for', 'with', 'that', 'this', 'it', 'are', 'was', 'you', 'a', 'on', 'as', 'at', 'by']);
const VIETNAMESE_LETTERS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/gi;

/**
 * Original language of a legacy item. English text can contain Vietnamese proper nouns ("Mái Ấm Bình Minh"), so a single diacritic is not
 * enough: English needs a high density of English function words AND a low density of Vietnamese-only letters.
 */
export function detectLocale(text: string): LocaleName {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 12) return 'vi';
  const letters = words.join('').length;
  const viLetters = text.match(VIETNAMESE_LETTERS)?.length ?? 0;
  const stop = words.filter((w) => ENGLISH_STOPWORDS.has(w)).length;
  return stop / words.length >= 0.2 && viLetters / letters < 0.04 ? 'en' : 'vi';
}
