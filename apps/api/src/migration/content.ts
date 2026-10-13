import { buildSearchText, sanitizeRichText } from '../content/sanitize';

export interface ContentContext {
  /** `siteurl` / `home` options of the legacy site (links to them become relative). */
  siteUrls: string[];
  /** Uploads-relative path (e.g. `2026/08/x.jpg`) → migrated media id, or null when the file was never recovered. */
  resolveUpload(relativePath: string): { id: string } | null;
  /** `?p=ID` / `?page_id=ID` → new internal path, or null. */
  resolveLegacyLink(wpId: string): string | null;
}

export interface NormalizedContent {
  html: string;
  text: string;
  searchText: string;
  /** Tags dropped by the sanitiser allowlist (tag → count). */
  removed: Record<string, number>;
  /** Image URLs whose file could not be mapped (removed from the HTML and reported). */
  unresolvedMedia: string[];
  /** Shortcodes that have no equivalent (removed or left as text) — reported. */
  shortcodes: string[];
  /** Media ids referenced in the final HTML (to be made public together with a published post). */
  mediaIds: string[];
  rewrittenLinks: number;
}

const BLOCK_TAG = /<(p|div|h[1-6]|ul|ol|li|table|blockquote|figure|pre|hr)[\s>/]/i;
const DROP_SHORTCODES = ['gallery', 'embed', 'audio', 'video', 'playlist', 'wp_caption'];

/** Minimal `wpautop`: raw WordPress "classic editor" text has no <p>; blank lines separate paragraphs, single newlines become <br>. */
export function autop(raw: string): string {
  const s = raw.replace(/\r\n?/g, '\n').trim();
  if (!s || BLOCK_TAG.test(s)) return s;
  return s
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** `2026/08/photo-300x200.jpg` / `photo-scaled.jpg` → `2026/08/photo.jpg` (WordPress derived sizes). */
export function originalUploadPath(rel: string): string {
  return rel.replace(/-(?:scaled|\d{1,5}x\d{1,5})(\.[A-Za-z0-9]+)$/, '$1');
}

function uploadsRelative(url: string): string | null {
  const m = /\/wp-content\/uploads\/([^?#"'\s]+)/i.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

export function normalizeLegacyContent(raw: string, ctx: ContentContext): NormalizedContent {
  let html = (raw ?? '').replace(/<!--\s*\/?wp:[\s\S]*?-->/g, '');
  const shortcodes: string[] = [];

  // [caption …]<img …> text[/caption] → keep the inner markup.
  html = html.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, (_m, inner: string) => `<figure>${inner}</figure>`);
  for (const name of DROP_SHORTCODES) {
    html = html.replace(new RegExp(`\\[${name}(?:\\s[^\\]]*)?\\](?:[\\s\\S]*?\\[\\/${name}\\])?`, 'gi'), (m) => {
      shortcodes.push(m.slice(0, 60));
      return '';
    });
  }
  for (const m of html.matchAll(/\[(\/?)([a-z][\w-]{2,})(?:\s[^\]]*)?\]/gi)) shortcodes.push(m[0].slice(0, 60)); // anything left stays as visible text but is reported

  html = autop(html);

  const unresolvedMedia: string[] = [];
  const mediaIds: string[] = [];
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const url = src?.[1] ?? src?.[2];
    if (!url) return '';
    const rel = uploadsRelative(url);
    if (rel === null) return /^https?:\/\//i.test(url) ? tag : (unresolvedMedia.push(url.slice(0, 200)), ''); // external https images stay (sanitiser keeps only http/https)
    const hit = ctx.resolveUpload(rel) ?? ctx.resolveUpload(originalUploadPath(rel));
    if (!hit) {
      unresolvedMedia.push(rel);
      return '';
    }
    mediaIds.push(hit.id);
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    return `<img src="/api/v1/media/${hit.id}/large" alt="${(alt?.[1] ?? alt?.[2] ?? '').replace(/"/g, '&quot;')}">`;
  });

  let rewrittenLinks = 0;
  html = html.replace(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (full, a: string | undefined, b: string | undefined) => {
    const href = (a ?? b ?? '').trim();
    for (const base of ctx.siteUrls) {
      if (base && href.toLowerCase().startsWith(base.toLowerCase())) {
        const rest = href.slice(base.length) || '/';
        const q = /^\/?\?(?:p|page_id)=(\d+)/.exec(rest);
        const target = q ? ctx.resolveLegacyLink(q[1]!) : null;
        rewrittenLinks++;
        return `href="${target ?? (rest.startsWith('/') ? rest : `/${rest}`)}"`;
      }
    }
    return full;
  });

  const s = sanitizeRichText(html);
  return { html: s.html, text: s.text, searchText: s.searchText, removed: s.removed, unresolvedMedia, shortcodes, mediaIds: [...new Set(mediaIds)], rewrittenLinks };
}

export { buildSearchText };
