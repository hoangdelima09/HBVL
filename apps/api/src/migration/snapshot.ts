import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';

/**
 * Read-only in-memory view of a restored WordPress database. WordPress sites of this kind are small (thousands of rows), so the
 * tables are loaded once and transformed in memory; a much larger site would need keyset-paged loading here (documented in docs/MIGRATION.md).
 */
export interface WpUser {
  ID: string;
  user_login: string;
  user_email: string;
  display_name: string;
  user_registered: string;
  user_status: number;
}
export interface WpPost {
  ID: string;
  post_author: string;
  post_date: string;
  post_date_gmt: string;
  post_modified_gmt: string;
  post_content: string;
  post_title: string;
  post_excerpt: string;
  post_status: string;
  comment_status: string;
  post_password: string;
  post_name: string;
  post_parent: string;
  menu_order: number;
  post_type: string;
}
export interface WpComment {
  comment_ID: string;
  comment_post_ID: string;
  comment_author: string;
  comment_date_gmt: string;
  comment_content: string;
  comment_approved: string;
  comment_type: string;
  comment_parent: string;
  user_id: string;
}
export interface WpTerm {
  term_id: string;
  name: string;
  slug: string;
  taxonomy: string;
  parent: string;
  term_taxonomy_id: string;
}
export interface WpRelationship {
  object_id: string;
  term_taxonomy_id: string;
}

export interface LegacySnapshot {
  prefix: string;
  users: WpUser[];
  usermeta: Map<string, Map<string, string>>;
  posts: WpPost[];
  postmeta: Map<string, Map<string, string>>;
  comments: WpComment[];
  terms: WpTerm[];
  relationships: WpRelationship[];
  options: Map<string, string>;
  /** sha256 over the table contents (stable across restores) — identifies "this exact source" for resume. */
  fingerprint: string;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function groupMeta(rows: { owner: unknown; k: unknown; v: unknown }[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const owner = str(r.owner);
    let m = out.get(owner);
    if (!m) out.set(owner, (m = new Map()));
    // WordPress allows duplicate keys; the first value is what get_post_meta(..., true) returns.
    if (r.k !== null && !m.has(str(r.k))) m.set(str(r.k), str(r.v));
  }
  return out;
}

export interface MysqlOptions {
  url: string;
  prefix?: string;
}

/** Opens a read-only connection. Refuses anything that is not loopback unless `LEGACY_ALLOW_REMOTE=1` (the restore DB is meant to be local and throwaway). */
export async function loadSnapshotFromMysql(opts: MysqlOptions): Promise<LegacySnapshot> {
  const u = new URL(opts.url);
  if (!['127.0.0.1', 'localhost', '::1'].includes(u.hostname) && process.env.LEGACY_ALLOW_REMOTE !== '1') {
    throw new Error(`Refusing to read from non-loopback host "${u.hostname}". The legacy database must be a local throwaway restore (set LEGACY_ALLOW_REMOTE=1 to override).`);
  }
  const conn = await mysql.createConnection({ uri: opts.url, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, charset: 'utf8mb4', multipleStatements: false });
  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    const [tables] = await conn.query<mysql.RowDataPacket[]>('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
    const names = new Set(tables.map((r) => str(r.t)));
    const prefix = opts.prefix ?? [...names].map((n) => /^(.*)posts$/.exec(n)?.[1]).find((p) => p !== undefined && names.has(`${p}options`) && names.has(`${p}users`)) ?? 'wp_';
    for (const t of ['posts', 'postmeta', 'users', 'usermeta', 'comments', 'terms', 'term_taxonomy', 'term_relationships', 'options']) {
      if (!names.has(prefix + t)) throw new Error(`Table ${prefix}${t} not found — is this a WordPress database (prefix "${prefix}")?`);
    }
    const q = async <T = mysql.RowDataPacket>(sql: string) => (await conn.query<mysql.RowDataPacket[]>(sql))[0] as unknown as T[];
    const p = (t: string) => `\`${prefix}${t}\``;

    const users = await q<WpUser>(`SELECT ID, user_login, user_email, display_name, user_registered, user_status FROM ${p('users')} ORDER BY ID`);
    const usermeta = groupMeta(
      (await q<{ user_id: string; meta_key: string; meta_value: string }>(`SELECT user_id, meta_key, meta_value FROM ${p('usermeta')} ORDER BY umeta_id`)).map((r) => ({
        owner: r.user_id,
        k: r.meta_key,
        v: r.meta_value,
      })),
    );
    const posts = await q<WpPost>(
      `SELECT ID, post_author, post_date, post_date_gmt, post_modified_gmt, post_content, post_title, post_excerpt, post_status, comment_status, post_password, post_name, post_parent, menu_order, post_type FROM ${p('posts')} ORDER BY ID`,
    );
    const postmeta = groupMeta(
      (await q<{ post_id: string; meta_key: string; meta_value: string }>(`SELECT post_id, meta_key, meta_value FROM ${p('postmeta')} ORDER BY meta_id`)).map((r) => ({
        owner: r.post_id,
        k: r.meta_key,
        v: r.meta_value,
      })),
    );
    const comments = await q<WpComment>(
      `SELECT comment_ID, comment_post_ID, comment_author, comment_date_gmt, comment_content, comment_approved, comment_type, comment_parent, user_id FROM ${p('comments')} ORDER BY comment_ID`,
    );
    const terms = await q<WpTerm>(
      `SELECT t.term_id, t.name, t.slug, tt.taxonomy, tt.parent, tt.term_taxonomy_id FROM ${p('terms')} t JOIN ${p('term_taxonomy')} tt ON tt.term_id = t.term_id ORDER BY t.term_id`,
    );
    const relationships = await q<WpRelationship>(`SELECT object_id, term_taxonomy_id FROM ${p('term_relationships')} ORDER BY object_id, term_taxonomy_id`);
    const optRows = await q<{ option_name: string; option_value: string }>(
      `SELECT option_name, option_value FROM ${p('options')} WHERE option_name NOT LIKE '\\_transient%' AND option_name NOT LIKE '\\_site\\_transient%'`,
    );
    const options = new Map(optRows.map((r) => [str(r.option_name), str(r.option_value)]));

    const h = createHash('sha256');
    for (const part of [
      users,
      posts,
      comments,
      terms,
      relationships,
      [...postmeta].map(([k, m]) => [k, [...m]]),
      [...usermeta].map(([k, m]) => [k, [...m]]),
      [...options].filter(([k]) => !/^(cron|recently_activated|active_plugins|_transient)/.test(k)),
    ]) {
      h.update(JSON.stringify(part)).update('\n');
    }
    return { prefix, users, usermeta, posts, postmeta, comments, terms, relationships, options, fingerprint: h.digest('hex') };
  } finally {
    await conn.end();
  }
}
