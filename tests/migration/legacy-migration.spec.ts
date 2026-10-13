import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient, type PrismaClient } from '@hbvl/database';
import mysql from 'mysql2/promise';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../apps/api/src/config/env';
import { MediaService } from '../../apps/api/src/media/media.service';
import { StorageService } from '../../apps/api/src/media/storage.service';
import { runLegacyMigration, type RunSummary } from '../../apps/api/src/migration/runner';
import { loadSnapshotFromMysql } from '../../apps/api/src/migration/snapshot';
import { migrationTestEnv } from './support/env';

const t = migrationTestEnv();
let prisma: PrismaClient;
let pgAdmin: pg.Client;
let legacy: mysql.Connection;
let media: MediaService;
let tmp: string;
const dirs = { uploads: '', members: '', directory: '', provinceImages: '' };

const count = async (table: string): Promise<number> => Number((await pgAdmin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const snapshot = () => loadSnapshotFromMysql({ url: t.legacy.rootUrl });
const baseOpts = () => ({ uploadsDir: dirs.uploads, membersFile: dirs.members, directoryFile: dirs.directory, provinceImagesDir: dirs.provinceImages });
const run = async (mode: 'DRY_RUN' | 'APPLY', extra: Record<string, unknown> = {}, mediaSvc: MediaService = media): Promise<RunSummary> =>
  runLegacyMigration(prisma, await snapshot(), mediaSvc, { mode, ...baseOpts(), ...extra });
const issueCodes = (s: RunSummary) => new Map(s.issues.map((i) => [i.code, i.count]));

async function png(color: string, size = 64): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: color } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  const env = loadEnv({ ...t.baseEnv, NODE_ENV: 'test', DATABASE_URL: t.appUrl, S3_BUCKET_PRIVATE: t.bucket });
  const storage = new StorageService(env);
  await storage.ensureBucket();
  prisma = createPrismaClient({ connectionString: t.migratorUrl, poolMax: 4 });
  media = new MediaService(prisma, storage);
  pgAdmin = new pg.Client({ connectionString: t.adminDbUrl });
  await pgAdmin.connect();
  legacy = await mysql.createConnection({ uri: t.legacy.rootUrl, multipleStatements: false });

  tmp = mkdtempSync(join(tmpdir(), 'hbvl-migration-'));
  dirs.uploads = join(tmp, 'uploads');
  mkdirSync(join(dirs.uploads, '2026/08'), { recursive: true });
  mkdirSync(join(dirs.uploads, '2026/09'), { recursive: true });
  const a = await png('#cc3300');
  const b = await png('#0033cc');
  writeFileSync(join(dirs.uploads, '2026/08/a.png'), a);
  writeFileSync(join(dirs.uploads, '2026/08/a-300x200.png'), await png('#cc3301', 32)); // derived size → skipped
  writeFileSync(join(dirs.uploads, '2026/08/b.png'), b); // orphan (no attachment row)
  writeFileSync(join(dirs.uploads, '2026/09/b-copy.png'), b); // identical bytes → stored once
  writeFileSync(join(dirs.uploads, '2026/08/notes.txt'), 'not an image');
  dirs.members = join(tmp, 'members.csv');
  writeFileSync(dirs.members, 'name,province\nNGUYỄN VĂN A,Hà Nội\nTRẦN B,Cao Bằng\nTRẦN B,Hà Giang\nLÊ C,Tuyên Quang\nLÊ C,Tuyên Quang\nPHẠM D,Atlantis\n');
  dirs.directory = join(tmp, 'directory.json');
  writeFileSync(
    dirs.directory,
    JSON.stringify({
      p11: {
        name: 'Hà Nội',
        slug: 'ha-noi',
        members: [
          { name: 'Mẫu 1', role: 'Đại diện tỉnh', contact: '/lien-he' },
          { name: 'Mẫu 2', role: 'Thành viên', contact: 'https://evil.example/x' },
        ],
      },
      p99: { name: 'Không tồn tại', slug: 'khong-ton-tai', members: [{ name: 'Mẫu 3', role: 'Thành viên', contact: '/lien-he' }] },
    }),
  );
  dirs.provinceImages = join(tmp, 'provinces');
  mkdirSync(dirs.provinceImages);
  writeFileSync(
    join(dirs.provinceImages, 'ha-noi.jpg'),
    await sharp({ create: { width: 80, height: 60, channels: 3, background: '#228822' } })
      .jpeg()
      .toBuffer(),
  );
});

afterAll(async () => {
  await legacy?.end();
  await pgAdmin?.end();
  await prisma?.$disconnect();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('WordPress → HBVL migration (synthetic fixture)', () => {
  let failed: RunSummary;
  let resumed: RunSummary;

  it('reads the restored database read-only and identifies the source by a content fingerprint', async () => {
    const snap = await snapshot();
    expect(snap.prefix).toBe('wp_');
    expect(snap.users).toHaveLength(10);
    expect(snap.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    await expect(legacy.query('SELECT 1')).resolves.toBeTruthy();
  });

  it('refuses a non-loopback legacy host', async () => {
    await expect(loadSnapshotFromMysql({ url: 'mysql://root:x@db.example.org:3306/wp' })).rejects.toThrow(/non-loopback/);
  });

  it('DRY RUN reports what would happen and writes nothing (only the run record)', async () => {
    const s = await run('DRY_RUN');
    expect(s.status).toBe('COMPLETED');
    expect(s.stats.users).toMatchObject({ created: 8, 'skipped:no-valid-email': 1, 'skipped:email-conflict': 1 });
    expect(s.stats.posts).toBeDefined();
    for (const table of [
      'users',
      'posts',
      'pages',
      'comments',
      'media_assets',
      'legacy_id_map',
      'redirects',
      'scholarship_members',
      'directory_contacts',
      'feedbacks',
      'contact_messages',
      'tags',
    ]) {
      expect(await count(table), `${table} must be untouched by a dry run`).toBe(0);
    }
    expect(await count('migration_runs')).toBe(1);
    expect((await pgAdmin.query(`SELECT mode, status FROM migration_runs`)).rows[0]).toEqual({ mode: 'DRY_RUN', status: 'COMPLETED' });
  });

  it('a run that fails midway keeps the finished phases and is marked FAILED', async () => {
    const outage = {
      uploadImage: async () => {
        throw new Error('object storage unavailable');
      },
    } as unknown as MediaService;
    failed = await run('APPLY', {}, outage);
    expect(failed.status).toBe('FAILED');
    expect(failed.phases).toEqual(['users', 'terms']);
    expect(issueCodes(failed).has('RUN_ABORTED')).toBe(true);
    expect(await count('users')).toBe(8);
    expect(await count('posts')).toBe(0);
    const row = (await pgAdmin.query(`SELECT status, checkpoint FROM migration_runs WHERE id = $1`, [failed.runId])).rows[0];
    expect(row.status).toBe('FAILED');
    expect(Object.keys(row.checkpoint.phases).sort()).toEqual(['terms', 'users']);
  });

  it('resume continues the same run, creating nothing twice', async () => {
    resumed = await run('APPLY', { resume: true });
    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.resumed).toBe(true);
    expect(resumed.runId).toBe(failed.runId);
    expect(resumed.stats.users).toMatchObject({ unchanged: 8 });
    expect(resumed.stats.users!.created).toBeUndefined();
    expect(await count('users')).toBe(8);
    expect(resumed.errorCount).toBeGreaterThan(0); // data problems (e.g. user without e-mail) are reported, not hidden
  });

  it('users: roles are mapped without escalation and nobody is usable until e-mail activation', async () => {
    const rows = (await pgAdmin.query(`SELECT username, role, status, "passwordHash", "emailVerifiedAt", "mfaEnabled" FROM users ORDER BY username`)).rows;
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.passwordHash).toBeNull();
      expect(r.status).toBe('PENDING_RESET');
      expect(r.emailVerifiedAt).toBeNull();
      expect(r.mfaEnabled).toBe(false);
    }
    const role = (u: string) => rows.find((r) => r.username === u)?.role;
    expect(role('admin_user')).toBe('ADMIN');
    expect(role('collab')).toBe('COLLABORATOR');
    expect(role('member1')).toBe('MEMBER');
    expect(role('sub1')).toBe('MEMBER');
    expect(role('editor1')).toBe('MEMBER'); // unknown WordPress role never escalates
    expect(role('evilcaps')).toBe('MEMBER'); // serialised object refused
    expect(rows.filter((r) => r.role === 'ADMIN')).toHaveLength(1);
    expect(rows.map((r) => r.username)).toContain('wp-user-9'); // "ab" is too short for the new rules
    expect(rows.map((r) => r.username)).toContain('Member1-wp10'); // same login (case-insensitive) as member1 → renamed, not merged
    expect(rows.map((r) => r.username)).not.toContain('noemail');
    expect(rows.map((r) => r.username)).not.toContain('dupemail');
    const codes = issueCodes(resumed);
    expect(codes.get('USER_NO_VALID_EMAIL')).toBe(1);
    expect(codes.get('USER_EMAIL_CONFLICT')).toBe(1);
    expect(codes.get('UNKNOWN_ROLE')).toBe(1);
    expect(codes.get('NO_ROLE')).toBe(1);
  });

  it('posts: statuses, workflow state, dates, slugs and authors', async () => {
    const posts = (
      await pgAdmin.query(
        `SELECT p.kind, p.slug, p.status, p."originalLocale", p."needsReview", p."legacyLikeCount", p."publishedAt", p."scheduledAt", p."deletedAt", p."authorId", p.title, p.excerpt, p.origin FROM posts p`,
      )
    ).rows;
    expect(posts).toHaveLength(15);
    const by = (slug: string) => posts.find((p) => p.slug === slug)!;
    expect(by('bai-moi').status).toBe('PUBLISHED');
    expect(by('bai-moi').publishedAt.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(by('bai-moi').legacyLikeCount).toBe(12);
    expect(by('bai-moi').excerpt).toBe('Tóm tắt ngắn');
    expect(by('bai-moi').origin).toBe('WORDPRESS');
    expect(by('bai-moi-2').status).toBe('PUBLISHED'); // duplicate slug renamed, never overwritten
    expect(by('bai-hen-gio').status).toBe('SCHEDULED');
    expect(by('bai-hen-gio').scheduledAt.toISOString()).toBe('2030-01-01T03:00:00.000Z');
    expect(by('bai-rieng').status).toBe('PRIVATE');
    expect(by('bai-xoa').status).toBe('TRASHED'); // "__trashed" suffix removed
    expect(by('bai-xoa').deletedAt.toISOString()).toBe(new Date(1790000000 * 1000).toISOString());
    expect(by('bai-mat-khau').status).toBe('PRIVATE'); // password-protected is never public
    expect(by('bai-cho-duyet').status).toBe('PENDING_REVIEW');
    expect(by('can-sua').status).toBe('CHANGES_REQUESTED');
    expect(by('bi-tu-choi').status).toBe('REJECTED');
    expect(by('trang-thai-la').status).toBe('DRAFT');
    expect(by('su-kien-a').kind).toBe('EVENT');
    expect(by('chuong-trinh-b').kind).toBe('PROGRAM');
    expect(by('tac-gia-mat').authorId).toBeNull();
    expect(by('bai-cho-duyet').authorId).not.toBeNull();
    expect(posts.some((p) => p.title === 'Auto Draft')).toBe(false);
    const codes = issueCodes(resumed);
    expect(codes.get('PASSWORD_PROTECTED')).toBe(1);
    expect(codes.get('SLUG_CONFLICT_RENAMED')).toBe(1);
    expect(codes.get('UNKNOWN_POST_STATUS')).toBe(1);
    expect(codes.get('POST_AUTHOR_MISSING')).toBeGreaterThanOrEqual(1);
  });

  it('submission feedback survives as review events with the reasons the authors saw', async () => {
    const rows = (await pgAdmin.query(`SELECT p.slug, e.action, e.reason, e."toStatus" FROM review_events e JOIN posts p ON p.id = e."postId" ORDER BY p.slug`)).rows;
    expect(rows).toEqual([
      { slug: 'bi-tu-choi', action: 'REJECT', reason: 'Không phù hợp.', toStatus: 'REJECTED' },
      { slug: 'can-sua', action: 'REQUEST_CHANGES', reason: 'Cần bổ sung nguồn.', toStatus: 'CHANGES_REQUESTED' },
    ]);
  });

  it('content: sanitised, links rewritten, images mapped to migrated media, unresolved ones reported, language detected', async () => {
    const q = async (slug: string) => (await pgAdmin.query(`SELECT * FROM posts WHERE slug = $1`, [slug])).rows[0];
    const p100 = await q('bai-moi');
    expect(p100.contentHtml).not.toMatch(/<script|alert\(1\)|missing\.png/);
    const asset = (await pgAdmin.query(`SELECT a.* FROM media_assets a JOIN legacy_id_map m ON m."entityId" = a.id WHERE m."legacyType" = 'attachment' AND m."legacyId" = '200'`))
      .rows[0];
    expect(p100.contentHtml).toContain(`/api/v1/media/${asset.id}/large`);
    expect(p100.featuredAssetId).toBe(asset.id);
    expect(asset.visibility).toBe('PUBLIC'); // published post ⇒ its images become public with it
    expect(asset.status).toBe('ACTIVE');
    expect(p100.needsReview).toBe(true); // an image could not be recovered
    const tags = (await pgAdmin.query(`SELECT t.slug FROM post_tags pt JOIN tags t ON t.id = pt."tagId" WHERE pt."postId" = $1 ORDER BY 1`, [p100.id])).rows.map((r) => r.slug);
    expect(tags).toEqual(['tag-a', 'tag-b']);
    const cats = (await pgAdmin.query(`SELECT c.slug FROM post_categories pc JOIN categories c ON c.id = pc."categoryId" WHERE pc."postId" = $1`, [p100.id])).rows.map(
      (r) => r.slug,
    );
    expect(cats).toEqual(['chuyen-vuon-len']);

    const p111 = await q('bai-shortcode');
    expect(p111.contentHtml).toContain('<p>Dòng một</p>');
    expect(p111.contentHtml).not.toContain('[gallery');
    expect(p111.contentHtml).toContain('href="/bai-viet/bai-moi"'); // ?p=100 → new URL
    expect(p111.contentHtml).toContain('href="/gioi-thieu/"');

    const en = await q('the-day-we-showed-up');
    expect(en.originalLocale).toBe('en');
    expect(Number((await pgAdmin.query(`SELECT count(*)::int n FROM post_translations WHERE "postId" = $1 AND locale = 'en'`, [en.id])).rows[0].n)).toBe(1);
    const defCat = (await pgAdmin.query(`SELECT c.slug FROM post_categories pc JOIN categories c ON c.id = pc."categoryId" WHERE pc."postId" = $1`, [en.id])).rows.map(
      (r) => r.slug,
    );
    expect(defCat).toEqual(['tin-tuc']);
    expect(en.needsReview).toBe(true);
    expect(issueCodes(resumed).get('CATEGORY_UNMAPPED')).toBe(1);
    expect(issueCodes(resumed).get('MEDIA_REFERENCE_UNRESOLVED')).toBe(1);
    expect(issueCodes(resumed).get('SHORTCODE_UNSUPPORTED')).toBe(1);
  });

  it('pages: hierarchy kept, system pages replaced, reserved paths never shadowed, encoding damage reported', async () => {
    const pages = (
      await pgAdmin.query(`SELECT p.slug, p.status, p."needsReview", p."deletedAt", (SELECT slug FROM pages x WHERE x.id = p."parentId") AS parent FROM pages p ORDER BY p.slug`)
    ).rows;
    expect(pages.map((p) => p.slug)).toEqual(['gioi-thieu', 'lien-he', 'nhap', 'tong-quan', 'trang-xoa']);
    expect(pages.find((p) => p.slug === 'tong-quan')!.parent).toBe('gioi-thieu');
    expect(pages.find((p) => p.slug === 'lien-he')).toMatchObject({ status: 'DRAFT', needsReview: true }); // /lien-he is an application route
    expect(pages.find((p) => p.slug === 'trang-xoa')).toMatchObject({ status: 'TRASHED' });
    const codes = issueCodes(resumed);
    expect(codes.get('RESERVED_PATH')).toBe(1);
    expect(codes.get('SYSTEM_PAGE_REPLACED')).toBe(2);
    expect(codes.get('DATA_LOSS_ENCODING')).toBe(2);
    expect(pages.find((p) => p.slug === 'home')).toBeUndefined();
  });

  it('comments: spam/trash never public, pingbacks and orphans skipped, personal fields dropped', async () => {
    const rows = (
      await pgAdmin.query(
        `SELECT "authorName", body, status, depth, "parentId" IS NOT NULL AS reply, "authorId" IS NOT NULL AS has_author FROM comments ORDER BY "createdAt", body`,
      )
    ).rows;
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.body === 'Hay quá!')).toMatchObject({ status: 'APPROVED', has_author: true }); // markup stripped
    expect(rows.find((r) => r.body === 'Cảm ơn bạn.')).toMatchObject({ reply: true, depth: 1 });
    expect(rows.find((r) => /Mua hàng/.test(r.body))!.status).toBe('SPAM');
    expect(rows.find((r) => r.body === 'Đã xoá')!.status).toBe('TRASHED');
    expect(rows.find((r) => r.body === 'Đang chờ')!.status).toBe('PENDING');
    expect(rows.some((r) => /pingback|trên trang|không tồn tại/.test(r.body))).toBe(false);
    expect(resumed.stats.comments).toMatchObject({ created: 5, 'skipped:pingback': 1 });
  });

  it('inboxes: feedback and contact imported, deleted items skipped, delivery state never claims DELIVERED', async () => {
    const fb = (await pgAdmin.query(`SELECT subject, message, status, origin FROM feedbacks`)).rows;
    expect(fb).toEqual([{ subject: 'Góp ý A', message: 'Nội dung góp ý.', status: 'NEW', origin: 'WORDPRESS' }]);
    const ct = (await pgAdmin.query(`SELECT "receiptCode", name, email, subject, message, status, "mailState" FROM contact_messages ORDER BY "receiptCode"`)).rows;
    expect(ct).toHaveLength(2);
    expect(ct[0]).toMatchObject({
      receiptCode: 'LH-WP-000410',
      name: 'An Nguyễn',
      email: 'an@legacy.example.org',
      message: 'Xin chào, cho tôi hỏi.',
      status: 'DONE',
      mailState: 'SENT_TO_PROVIDER',
    });
    expect(ct[1]).toMatchObject({ receiptCode: 'LH-WP-000411', email: 'khong-co-email@invalid.example', mailState: 'FAILED' });
    expect(ct.every((c) => c.mailState !== 'DELIVERED')).toBe(true);
  });

  it('media: recoverable files kept PRIVATE until used, duplicates stored once, missing files reported', async () => {
    const assets = (await pgAdmin.query(`SELECT status, visibility, purpose, "isPlaceholder" FROM media_assets ORDER BY purpose`)).rows;
    expect(assets.filter((a) => a.purpose === 'LEGACY_IMPORT')).toHaveLength(2); // a.png + b.png (b-copy deduplicated, derived size skipped)
    const orphan = assets.find((a) => a.status === 'ORPHAN')!;
    expect(orphan).toMatchObject({ visibility: 'PRIVATE', purpose: 'LEGACY_IMPORT' });
    const photos = assets.filter((a) => a.purpose === 'PROVINCE_PHOTO');
    expect(photos).toEqual([{ status: 'ACTIVE', visibility: 'PUBLIC', purpose: 'PROVINCE_PHOTO', isPlaceholder: true }]);
    expect(resumed.stats.media).toMatchObject({ created: 2, deduplicated: 1, 'skipped:derived-size': 1, 'skipped:unsupported-type': 1 });
    expect(issueCodes(resumed).get('MEDIA_FILE_MISSING')).toBe(1);
    expect(issueCodes(resumed).get('MEDIA_UNSUPPORTED_TYPE')).toBe(1);
  });

  it('revisions are kept as read-only WordPress history for migrated posts only', async () => {
    const r = (await pgAdmin.query(`SELECT kind, version, title FROM post_revisions`)).rows;
    expect(r).toEqual([{ kind: 'WP_REVISION', version: 0, title: 'Bài mới (bản cũ)' }]);
  });

  it('members: only name + province, same names never merged, duplicates and unknown places reported by row number', async () => {
    const rows = (await pgAdmin.query(`SELECT m."fullName", p.slug FROM scholarship_members m JOIN provinces p ON p.id = m."legacyProvinceId" ORDER BY m."fullName", p.slug`)).rows;
    expect(rows).toEqual([
      { fullName: 'LÊ C', slug: 'tuyen-quang' },
      { fullName: 'NGUYỄN VĂN A', slug: 'ha-noi' },
      { fullName: 'TRẦN B', slug: 'cao-bang' },
      { fullName: 'TRẦN B', slug: 'ha-giang' },
    ]);
    expect(resumed.stats.members).toMatchObject({ rows: 6, created: 4, 'skipped:duplicate-in-file': 1, 'skipped:unknown-province': 1, sameNameOtherProvince: 2 });
    const issues = (await pgAdmin.query(`SELECT code, "legacyId", message FROM migration_issues WHERE code LIKE 'MEMBER_%' ORDER BY code`)).rows;
    expect(JSON.stringify(issues)).not.toMatch(/LÊ C|TRẦN B|NGUYỄN/); // issues carry row numbers, not people's names
  });

  it('directory contacts from the theme are UNVERIFIED samples, never matched on theme codes, with internal links only', async () => {
    const rows = (await pgAdmin.query(`SELECT d.name, d.verification, d."contactPath", p.slug FROM directory_contacts d JOIN provinces p ON p.id = d."provinceId" ORDER BY d.name`))
      .rows;
    expect(rows).toEqual([
      { name: 'Mẫu 1', verification: 'UNVERIFIED_SAMPLE', contactPath: '/lien-he', slug: 'ha-noi' },
      { name: 'Mẫu 2', verification: 'UNVERIFIED_SAMPLE', contactPath: '/lien-he', slug: 'ha-noi' }, // external link refused → internal default
    ]);
    expect(issueCodes(resumed).get('DIRECTORY_PROVINCE_UNKNOWN')).toBe(1);
  });

  it('redirects come from real data: ?p=ID, page ids, blog, categories, tags — internal targets only, single hop', async () => {
    const rows = (await pgAdmin.query(`SELECT "fromPath", "fromQuery", "toPath", "statusCode", source FROM redirects`)).rows;
    const has = (fromPath: string, fromQuery: string | null, toPath: string) =>
      rows.some((r) => r.fromPath === fromPath && r.fromQuery === fromQuery && r.toPath === toPath && r.statusCode === 301 && r.source === 'LEGACY_MIGRATION');
    expect(has('/', 'p=100', '/bai-viet/bai-moi')).toBe(true);
    expect(has('/wp', 'p=100', '/bai-viet/bai-moi')).toBe(true); // site lived under /wp
    expect(has('/bai-moi', null, '/bai-viet/bai-moi')).toBe(true);
    expect(has('/', 'p=101', '/bai-viet/bai-moi-2')).toBe(true);
    expect(rows.some((r) => r.fromPath === '/bai-moi' && r.toPath === '/bai-viet/bai-moi-2')).toBe(false); // the renamed duplicate does not steal the original URL
    expect(has('/', 'p=112', '/su-kien/su-kien-a')).toBe(true);
    expect(has('/blog', null, '/category/tin-tuc')).toBe(true);
    expect(has('/category/chuyen-vuon-len', null, '/category/tin-tuc/chuyen-vuon-len')).toBe(true);
    expect(has('/tag/tag-a', null, '/tim-kiem?q=tag%20a')).toBe(true);
    expect(rows.some((r) => r.fromQuery === 'p=102' || r.fromQuery === 'p=103' || r.fromQuery === 'p=104' || r.fromQuery === 'p=105')).toBe(false); // non-public content gets no public redirect
    const sources = new Set(rows.filter((r) => !r.fromQuery).map((r) => r.fromPath));
    expect(rows.every((r) => r.toPath.startsWith('/') && !r.toPath.startsWith('//'))).toBe(true);
    expect(rows.every((r) => !sources.has(r.toPath.split('?')[0]))).toBe(true); // no chains
  });

  it('settings: only an allowlist is kept (as a reference record); secrets in wp_options never arrive', async () => {
    const row = (await pgAdmin.query(`SELECT value FROM site_settings WHERE key = 'legacy.wordpress'`)).rows[0].value;
    expect(Object.keys(row)).toContain('blogname');
    expect(JSON.stringify(row)).not.toMatch(/SMTP|AUTH-KEY|mailserver|auth_key/);
  });

  it('SECURITY: no WordPress password hash, option secret, commenter e-mail/IP or page password exists anywhere in the new database', async () => {
    const tables = (
      await pgAdmin.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`)
    ).rows.map((r) => r.table_name as string);
    const needles = ['FIXTURE.HASH', '$wp$2y$', 'pw-must-not-be-imported', 'SMTP-SECRET', 'AUTH-KEY-MUST', '203.0.113.9', 'visitor@legacy.example.org', 'session_tokens'];
    for (const table of tables) {
      for (const needle of needles) {
        const n = Number((await pgAdmin.query(`SELECT count(*)::int AS n FROM "${table}" x WHERE row_to_json(x)::text LIKE $1`, [`%${needle}%`])).rows[0].n);
        expect(n, `${needle} found in ${table}`).toBe(0);
      }
    }
    const issues = (await pgAdmin.query(`SELECT message, detail FROM migration_issues`)).rows;
    expect(JSON.stringify(issues)).not.toContain('@'); // no e-mail address in any report row
  });

  it('reconciliation: every migrated source row is traceable through legacy_id_map', async () => {
    expect(resumed.reconciliation.mismatches).toEqual([]);
    expect(resumed.reconciliation.mapped).toMatchObject({ user: 8, post: 15, page: 5, comment: 5, attachment: 1, revision: 1, feedback: 1, contact: 2, file: 3 });
    expect(resumed.reconciliation.source).toMatchObject({ users: 10, comments: 8, posts: 13, event: 1, program: 1, pages: 7 });
  });

  it('IDEMPOTENT: running apply again creates nothing and changes nothing', async () => {
    const tables = [
      'users',
      'posts',
      'pages',
      'comments',
      'media_assets',
      'legacy_id_map',
      'redirects',
      'scholarship_members',
      'directory_contacts',
      'feedbacks',
      'contact_messages',
      'tags',
      'post_revisions',
      'review_events',
    ];
    const snapshotCounts = async () => {
      const o: Record<string, number> = {};
      for (const x of tables) o[x] = await count(x);
      return o;
    };
    const before = await snapshotCounts();
    const again = await run('APPLY');
    expect(again.status).toBe('COMPLETED');
    expect(await snapshotCounts()).toEqual(before);
    for (const [entity, counters] of Object.entries(again.stats)) expect(counters.created ?? 0, `${entity}.created`).toBe(0);
    expect(again.stats.posts).toMatchObject({ unchanged: 13 });
    expect(again.stats.events).toMatchObject({ unchanged: 1 });
    expect(again.stats.programs).toMatchObject({ unchanged: 1 });
  });

  it('a changed source is applied to untouched content, but never over an edit made in the new system', async () => {
    await legacy.query(`UPDATE wp_posts SET post_content = '<p>Nội dung đã cập nhật ở WordPress.</p>' WHERE ID = 111`);
    const first = await run('APPLY');
    expect(first.stats.posts).toMatchObject({ updated: 1 });
    expect((await pgAdmin.query(`SELECT "contentHtml", version FROM posts WHERE slug = 'bai-shortcode'`)).rows[0]).toMatchObject({
      contentHtml: '<p>Nội dung đã cập nhật ở WordPress.</p>',
      version: 2,
    });

    await pgAdmin.query(`UPDATE posts SET title = 'Sửa bởi quản trị viên' WHERE slug = 'bai-shortcode'`);
    await legacy.query(`UPDATE wp_posts SET post_content = '<p>Lại đổi ở WordPress.</p>' WHERE ID = 111`);
    const second = await run('APPLY');
    expect(second.stats.posts).toMatchObject({ conflict: 1 });
    expect(issueCodes(second).get('EDITED_IN_NEW_SYSTEM')).toBe(1);
    expect((await pgAdmin.query(`SELECT title, "contentHtml" FROM posts WHERE slug = 'bai-shortcode'`)).rows[0]).toMatchObject({
      title: 'Sửa bởi quản trị viên',
      contentHtml: '<p>Nội dung đã cập nhật ở WordPress.</p>',
    });
  });
});
