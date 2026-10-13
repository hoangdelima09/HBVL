import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { foldVietnamese, slugify } from '@hbvl/contracts';
import type { Prisma } from '@hbvl/database';
import { AppError } from '../common/errors';
import { classifyMemberRows } from '../map/members.admin.service';
import type { Ctx, Db } from './context';
import { readMembersFile } from './members-source';

const ROUTE_PREFIX = { POST: '/bai-viet', EVENT: '/su-kien', PROGRAM: '/chuong-trinh' } as const;

// ───────────────────────── settings (allowlist only) ─────────────────────────
const SETTINGS_ALLOWLIST = [
  'blogname',
  'blogdescription',
  'timezone_string',
  'date_format',
  'time_format',
  'permalink_structure',
  'posts_per_page',
  'users_can_register',
  'default_role',
  'show_on_front',
  'page_on_front',
  'page_for_posts',
  'WPLANG',
] as const;

/**
 * Only a fixed allowlist of non-secret options is read, and it is stored as ONE reference record (`legacy.wordpress`) for admins to look at —
 * it is never applied to the live site automatically (e.g. the legacy `blogname` is stale). Every other option (SMTP, API keys, salts, plugin
 * data, cron…) is ignored by construction.
 */
export async function settingsPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap, rep } = ctx;
  const value: Record<string, string | null> = {};
  for (const k of SETTINGS_ALLOWLIST) value[k] = snap.options.get(k) ?? null;
  value.siteUrlOrigin = (() => {
    try {
      return new URL(snap.options.get('siteurl') ?? '').origin;
    } catch {
      return null;
    }
  })();
  await db.siteSetting.upsert({
    where: { key: 'legacy.wordpress' },
    update: { value: value as Prisma.InputJsonValue },
    create: { key: 'legacy.wordpress', value: value as Prisma.InputJsonValue },
  });
  rep.bump('settings', 'allowlistedKeys', SETTINGS_ALLOWLIST.length);
  rep.bump('settings', 'ignoredOptions', Math.max(0, snap.options.size - SETTINGS_ALLOWLIST.length));
  if (value.blogname)
    rep.add(
      'INFO',
      'LEGACY_BLOGNAME_NOT_APPLIED',
      'option',
      'blogname',
      'Tên site WordPress được lưu để tham khảo nhưng KHÔNG áp dụng (có thể đã cũ); tên site hiện hành do admin cấu hình.',
    );
}

// ───────────────────────── redirects (derived from real data only) ─────────────────────────
interface RedirectRow {
  fromPath: string;
  fromQuery: string | null;
  toPath: string;
}

export async function redirectsPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap, rep } = ctx;
  const prefixes = new Set(['']);
  for (const key of ['home', 'siteurl']) {
    try {
      const p = new URL(snap.options.get(key) ?? '').pathname.replace(/\/+$/, '');
      if (p) prefixes.add(p);
    } catch {
      /* not a URL */
    }
  }
  const rows: RedirectRow[] = [];
  const add = (from: string, query: string | null, to: string) => {
    for (const prefix of prefixes) {
      const fromPath = (prefix + (from === '/' ? '' : from)).replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1') || '/';
      if (fromPath !== to || query) rows.push({ fromPath, fromQuery: query, toPath: to });
    }
  };

  for (const p of snap.posts) {
    const plan = ctx.planPosts.get(p.ID);
    const migrated = ctx.posts.get(p.ID);
    if (plan && migrated?.status === 'PUBLISHED') {
      const to = `${ROUTE_PREFIX[plan.kind]}/${plan.slug}`;
      add('/', `p=${p.ID}`, to);
      if (p.post_name && !plan.slugChanged) add(`/${p.post_name}`, null, to); // permalink structure /%postname%/ (a renamed duplicate must not steal the original's URL)
      if (plan.kind !== 'POST' && p.post_name) add(`${ROUTE_PREFIX[plan.kind]}/${p.post_name}`, null, to);
    }
    const pagePath = ctx.planPagePaths.get(p.ID);
    if (pagePath && ctx.pages.get(p.ID)?.status === 'PUBLISHED') {
      add('/', `page_id=${p.ID}`, `/${pagePath}`);
      const legacyPath = legacyPagePath(ctx, p.ID);
      if (legacyPath && legacyPath !== pagePath) add(`/${legacyPath}`, null, `/${pagePath}`);
    }
  }
  // blog index + home page slug
  const blogId = snap.options.get('page_for_posts');
  const blog = blogId ? snap.posts.find((p) => p.ID === blogId) : undefined;
  add('/blog', null, '/category/tin-tuc');
  if (blog?.post_name && blog.post_name !== 'blog') add(`/${blog.post_name}`, null, '/category/tin-tuc');
  const homeId = snap.options.get('page_on_front');
  const home = homeId ? snap.posts.find((p) => p.ID === homeId) : undefined;
  if (home?.post_name) add(`/${home.post_name}`, null, '/');

  for (const t of snap.terms) {
    if (t.taxonomy === 'category') {
      const cat = ctx.categories.get(t.slug);
      if (cat?.parentSlug) add(`/category/${t.slug}`, null, `/category/${cat.parentSlug}/${t.slug}`);
    } else if (t.taxonomy === 'post_tag' && ctx.wpTag.has(t.term_id)) {
      add(`/tag/${slugify(t.slug)}`, null, `/tim-kiem?q=${encodeURIComponent(t.name)}`);
    }
  }

  // Loop guard: a target must never itself be a redirect source (keeps every redirect a single hop).
  const sources = new Set(rows.filter((r) => !r.fromQuery).map((r) => r.fromPath));
  const unique = new Map<string, RedirectRow>();
  for (const r of rows) {
    if (sources.has(r.toPath.split('?')[0]!) && r.toPath !== r.fromPath) {
      rep.add('WARNING', 'REDIRECT_CHAIN_SKIPPED', 'redirect', r.fromPath, 'Đích của chuyển hướng cũng là nguồn của chuyển hướng khác; bỏ qua để tránh chuỗi/vòng lặp.', {
        to: r.toPath,
      });
      continue;
    }
    const key = `${r.fromPath}|${r.fromQuery ?? ''}`;
    if (!unique.has(key)) unique.set(key, r); // first one wins
  }
  const res = await db.redirect.createMany({ data: [...unique.values()].map((r) => ({ ...r, statusCode: 301, source: 'LEGACY_MIGRATION' as const })), skipDuplicates: true });
  rep.bump('redirects', 'candidates', unique.size);
  rep.bump('redirects', 'created', res.count);
  rep.bump('redirects', 'alreadyPresent', unique.size - res.count);
}

/** The path the page had in WordPress (`/%postname%/` for pages = parent chain of post_name). */
function legacyPagePath(ctx: Ctx, id: string): string | null {
  const byId = new Map(ctx.snap.posts.filter((p) => p.post_type === 'page').map((p) => [p.ID, p]));
  const parts: string[] = [];
  let cur = byId.get(id);
  for (let i = 0; cur && i < 8; i++) {
    if (!cur.post_name) return null;
    parts.unshift(cur.post_name);
    cur = cur.post_parent !== '0' ? byId.get(cur.post_parent) : undefined;
  }
  return parts.join('/') || null;
}

// ───────────────────────── scholarship members ─────────────────────────
/**
 * Name + province of origin only. Same rules (and identity hash) as the admin importer. People with the same name are NEVER merged:
 * identical name+province inside the file is reported for a human, never silently collapsed or dropped.
 */
export async function membersPhase(ctx: Ctx, db: Db): Promise<void> {
  const { opts, rep } = ctx;
  if (!opts.membersFile) {
    rep.add('INFO', 'MEMBERS_FILE_NOT_PROVIDED', undefined, undefined, 'Không cung cấp --members-file; bỏ qua danh sách học viên.');
    return;
  }
  if (!existsSync(opts.membersFile)) {
    rep.add('ERROR', 'MEMBERS_FILE_MISSING', undefined, undefined, 'Tệp danh sách học viên không tồn tại.');
    return;
  }
  const rows = readMembersFile(opts.membersFile);
  const provinces = await db.province.findMany({ where: { system: 'LEGACY_63' }, select: { id: true, code: true, slug: true, nameVi: true, nameEn: true } });
  const existing = await db.scholarshipMember.findMany({ select: { normalizedName: true, sourceIdentity: true, legacyProvince: { select: { slug: true } } } });
  const classified = classifyMemberRows(
    rows,
    provinces,
    existing.map((e) => ({ normalizedName: e.normalizedName, sourceIdentity: e.sourceIdentity, provinceSlug: e.legacyProvince.slug })),
  );
  const bySlug = new Map(provinces.map((p) => [p.slug, p.id]));
  const toCreate = classified.filter((r) => r.status === 'OK' || r.status === 'AMBIGUOUS_SAME_NAME');
  const res = await db.scholarshipMember.createMany({
    data: toCreate.map((r) => ({
      fullName: r.name,
      normalizedName: foldVietnamese(r.name),
      legacyProvinceId: bySlug.get(r.provinceSlug!)!,
      sourceIdentity: r.identity!,
      importRunId: ctx.runId,
    })),
    skipDuplicates: true,
  });
  rep.bump('members', 'rows', rows.length);
  rep.bump('members', 'created', res.count);
  for (const r of classified) {
    if (r.status === 'ALREADY_EXISTS') rep.bump('members', 'unchanged');
    else if (r.status === 'AMBIGUOUS_SAME_NAME') {
      rep.bump('members', 'sameNameOtherProvince');
      rep.add(
        'INFO',
        'MEMBER_SAME_NAME_OTHER_PROVINCE',
        'member',
        String(r.row),
        'Cùng họ tên với người đã có ở tỉnh khác: nhập là người khác nhau (không gộp). Admin có thể kiểm tra.',
      );
    } else if (r.status === 'DUPLICATE_IN_FILE') {
      rep.bump('members', 'skipped:duplicate-in-file');
      rep.add(
        'WARNING',
        'MEMBER_DUPLICATE_ROW',
        'member',
        String(r.row),
        'Dòng trùng họ tên + tỉnh với dòng trước; không nhập tự động (có thể là hai người khác nhau — thêm thủ công với "khác người").',
      );
    } else if (r.status === 'UNKNOWN_PROVINCE') {
      rep.bump('members', 'skipped:unknown-province');
      rep.add('ERROR', 'MEMBER_UNKNOWN_PROVINCE', 'member', String(r.row), `Không nhận diện được địa danh "${r.province}".`, { province: r.province });
    } else if (r.status === 'INVALID') {
      rep.bump('members', 'skipped:invalid');
      rep.add('ERROR', 'MEMBER_INVALID_ROW', 'member', String(r.row), r.message ?? 'Dòng không hợp lệ.');
    }
  }
  // The same name under different provinces is imported as different people (never merged) but flagged once so a human can double-check.
  const provincesByName = new Map<string, Set<string>>();
  for (const r of toCreate) {
    const k = foldVietnamese(r.name);
    (provincesByName.get(k) ?? provincesByName.set(k, new Set()).get(k)!).add(r.provinceSlug!);
  }
  for (const r of toCreate) {
    if ((provincesByName.get(foldVietnamese(r.name))?.size ?? 0) > 1 && r.status === 'OK') {
      rep.bump('members', 'sameNameOtherProvince');
      rep.add(
        'INFO',
        'MEMBER_SAME_NAME_OTHER_PROVINCE',
        'member',
        String(r.row),
        'Cùng họ tên với người ở tỉnh khác trong cùng tệp: nhập là người khác nhau (không gộp). Admin có thể kiểm tra.',
      );
    }
  }
  const sheetOrigin = statSync(opts.membersFile).size;
  rep.bump('members', 'sourceBytes', sheetOrigin);
}

// ───────────────────────── province photos (theme assets; flagged placeholder) ─────────────────────────
export async function provincePhotosPhase(ctx: Ctx, db: Db): Promise<void> {
  const { opts, rep } = ctx;
  if (!opts.provinceImagesDir) {
    rep.add('INFO', 'PROVINCE_PHOTOS_NOT_PROVIDED', undefined, undefined, 'Không cung cấp --province-images-dir; bỏ qua ảnh tỉnh.');
    return;
  }
  if (!existsSync(opts.provinceImagesDir)) {
    rep.add('WARNING', 'PROVINCE_PHOTOS_DIR_MISSING', undefined, undefined, 'Thư mục ảnh tỉnh không tồn tại.');
    return;
  }
  const provinces = await db.province.findMany({ where: { system: 'LEGACY_63' }, select: { id: true, slug: true, photoAssetId: true } });
  for (const p of provinces) {
    const file = join(opts.provinceImagesDir, `${p.slug}.jpg`);
    if (!existsSync(file)) {
      rep.bump('provincePhotos', 'missing');
      continue;
    }
    const buffer = readFileSync(file);
    const sum = createHash('sha256').update(buffer).digest('hex');
    const prior = ctx.idMap.get('province-photo', p.slug);
    if (prior && prior.sourceChecksum === sum && p.photoAssetId) {
      rep.bump('provincePhotos', 'unchanged');
      continue;
    }
    try {
      const asset = await ctx.media.uploadImage(null, { buffer, originalname: `${p.slug}.jpg` }, 'PROVINCE_PHOTO', {
        status: 'ACTIVE',
        visibility: 'PUBLIC',
        isPlaceholder: true,
        db: ctx.dry ? db : undefined,
        skipStorage: ctx.dry,
      });
      await db.province.update({ where: { id: p.id }, data: { photoAssetId: asset.id } });
      await ctx.idMap.put(db, 'province-photo', p.slug, { entityType: 'media_asset', entityId: asset.id, sourceChecksum: sum, importedChecksum: sum });
      rep.bump('provincePhotos', 'created');
    } catch (e) {
      if (!(e instanceof AppError)) throw e; // infrastructure failure → abort so the run can be resumed
      rep.bump('provincePhotos', 'failed');
      rep.add('WARNING', 'PROVINCE_PHOTO_UNREADABLE', 'province', p.slug, `Không xử lý được ảnh tỉnh (${e.message}).`);
    }
  }
  rep.add(
    'INFO',
    'PROVINCE_PHOTOS_PLACEHOLDER',
    undefined,
    undefined,
    'Ảnh tỉnh là ảnh minh hoạ đi kèm theme (nguồn/bản quyền chưa xác minh): nhập với cờ isPlaceholder=true, cần thay bằng ảnh có giấy phép.',
  );
}

// ───────────────────────── contact directory (sample data → UNVERIFIED) ─────────────────────────
interface DirectoryFile {
  [themeCode: string]: { name?: string; slug?: string; members?: { name?: string; role?: string; contact?: string }[] };
}

/** The theme's province contacts are demo personas, not real representatives: they are imported UNVERIFIED and are never shown publicly until an admin verifies them. */
export async function directoryPhase(ctx: Ctx, db: Db): Promise<void> {
  const { opts, rep } = ctx;
  if (!opts.directoryFile) {
    rep.add('INFO', 'DIRECTORY_FILE_NOT_PROVIDED', undefined, undefined, 'Không cung cấp --directory-file; bỏ qua danh bạ tỉnh.');
    return;
  }
  if (!existsSync(opts.directoryFile)) {
    rep.add('WARNING', 'DIRECTORY_FILE_MISSING', undefined, undefined, 'Tệp danh bạ không tồn tại.');
    return;
  }
  const data = JSON.parse(readFileSync(opts.directoryFile, 'utf8')) as DirectoryFile;
  const provinces = await db.province.findMany({ where: { system: 'LEGACY_63' }, select: { id: true, slug: true, nameVi: true } });
  const bySlug = new Map(provinces.map((p) => [p.slug, p.id]));
  const byName = new Map(provinces.map((p) => [foldVietnamese(p.nameVi), p.id]));
  const source = 'wp-theme:province-directory.json';
  // Match on slug or name — NEVER on the theme's `pNN` codes (those are not administrative codes).
  for (const entry of Object.values(data)) {
    const provinceId = (entry.slug ? bySlug.get(entry.slug) : undefined) ?? (entry.name ? byName.get(foldVietnamese(entry.name)) : undefined);
    if (!provinceId) {
      rep.bump('directory', 'skipped:unknown-province');
      rep.add('WARNING', 'DIRECTORY_PROVINCE_UNKNOWN', 'directory', entry.slug ?? entry.name ?? '?', 'Không khớp tỉnh nào trong 63 đơn vị cũ.');
      continue;
    }
    for (const [i, m] of (entry.members ?? []).entries()) {
      const name = (m.name ?? '').trim().slice(0, 120);
      const role = (m.role ?? 'Thành viên').trim().slice(0, 80);
      if (!name) continue;
      const path =
        (m.contact ?? '').startsWith('/') && !(m.contact ?? '').startsWith('//') && !(m.contact ?? '').includes('\\') ? (m.contact ?? '').split('#')[0]! || '/lien-he' : '/lien-he';
      if (await db.directoryContact.findFirst({ where: { provinceId, name, role, source }, select: { id: true } })) {
        rep.bump('directory', 'unchanged');
        continue;
      }
      await db.directoryContact.create({ data: { provinceId, name, role, contactPath: path, verification: 'UNVERIFIED_SAMPLE', source, sortOrder: i } });
      rep.bump('directory', 'created');
    }
  }
  rep.add(
    'INFO',
    'DIRECTORY_SAMPLE_DATA',
    undefined,
    undefined,
    'Danh bạ tỉnh trong theme là dữ liệu mẫu: nhập ở trạng thái UNVERIFIED_SAMPLE, không hiển thị công khai cho tới khi admin xác minh.',
  );
}
