import sanitizeHtml from 'sanitize-html';
import { foldVietnamese, htmlToText } from '@hbvl/contracts';

/** Embeds are limited to these providers (also the only hosts CSP `frame-src` allows). */
export const EMBED_HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com', 'player.vimeo.com'];

const CLASS_RE = [/^wp-block-[a-z0-9-]+$/, /^blog-intro$/, /^has-text-align-(left|center|right)$/, /^align(left|center|right|wide|full)$/, /^is-style-[a-z0-9-]+$/];

const options: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'sub',
    'sup',
    'mark',
    'code',
    'pre',
    'blockquote',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'figure',
    'figcaption',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'div',
    'span',
    'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    iframe: ['src', 'title', 'width', 'height', 'allowfullscreen', 'loading'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    '*': ['class'],
  },
  allowedClasses: { '*': CLASS_RE },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'], iframe: ['https'] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  allowedIframeHostnames: EMBED_HOSTS,
  allowIframeRelativeUrls: false,
  // Drop script/style *contents* instead of leaking them as text.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  transformTags: {
    a: (tag, attribs) => {
      const out: Record<string, string> = { ...attribs };
      if (out.target === '_blank') out.rel = 'noopener noreferrer';
      else delete out.target;
      return { tagName: tag, attribs: out };
    },
    img: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, loading: 'lazy' } }),
  },
};

export interface SanitizeResult {
  html: string;
  text: string;
  searchText: string;
  /** Tag names removed by the allowlist, with counts (used by the migration report). */
  removed: Record<string, number>;
}

const TAG_NAME_RE = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g;
function countTags(html: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of html.matchAll(TAG_NAME_RE)) {
    if (html[m.index + 1] === '/' || /<\s*\//.test(m[0])) continue; // count opening tags only
    const n = m[1]!.toLowerCase();
    out[n] = (out[n] ?? 0) + 1;
  }
  return out;
}

/** Strip WordPress block comments + dangerous markup. Server-side only: the browser's copy is never trusted. */
export function sanitizeRichText(input: string): SanitizeResult {
  const html = sanitizeHtml(input ?? '', options).trim();
  const before = countTags(input ?? '');
  const after = countTags(html);
  const removed: Record<string, number> = {};
  for (const [tag, n] of Object.entries(before)) {
    const diff = n - (after[tag] ?? 0);
    if (diff > 0) removed[tag] = diff;
  }
  const text = htmlToText(html);
  return { html, text, searchText: buildSearchText(text), removed };
}

export function buildSearchText(...parts: (string | null | undefined)[]): string {
  return foldVietnamese(parts.filter(Boolean).join(' ')).slice(0, 8_000);
}

/** Media ids referenced from sanitised content (`/api/v1/media/{uuid}/{variant}`), to flip visibility on publish. */
export function extractMediaIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/\/api\/v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//gi)) ids.add(m[1]!.toLowerCase());
  return [...ids];
}
