/** Fold Vietnamese text for diacritic-insensitive search: NFD, strip marks, đ→d, lowercase, collapse non-alphanumerics. */
export function foldVietnamese(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slugify(value: string): string {
  return foldVietnamese(value)
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

/** NFKC + lowercase + trim: identity key for usernames. */
export function normalizeUsername(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** Lowercase + trim (+NFKC). Gmail dot/plus tricks are NOT collapsed: that would merge distinct mailboxes. */
export function normalizeEmail(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

const TAG_RE = /<[^>]*>/g;
const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Plain text from (already sanitised) HTML. Used for excerpts, search and the "not blank" rule on submit. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/blockquote)\s*\/?>/gi, '\n')
    .replace(TAG_RE, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITY_MAP[m] ?? m)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Reject control characters except TAB/LF/CR; keeps every other Unicode code point and backslashes untouched. */
export function hasForbiddenControlChars(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

/** Open-redirect-safe return URL: only same-site absolute paths. */
export function safeReturnTo(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\u0000-\u001f\u007f]/.test(v)) {
    return fallback;
  }
  try {
    const u = new URL(v, 'http://internal.invalid');
    if (u.origin !== 'http://internal.invalid') return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
