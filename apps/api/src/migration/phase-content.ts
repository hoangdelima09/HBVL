import { htmlToText, isReservedTopLevelPath, LIMITS, normalizeEmail, emailSchema } from '@hbvl/contracts';
import type { Prisma } from '@hbvl/database';
import { buildSearchText } from '../content/sanitize';
import type { Ctx, Db, PostPlan } from './context';
import { meta } from './context';
import { normalizeLegacyContent, type ContentContext, type NormalizedContent } from './content';
import { checksumOf, cleanWpSlug, detectLocale, gmtToDate, looksEncodingDamaged, mapCommentStatus, mapPostStatus, parseLegacyContact, SlugAllocator, wpInstant } from './mappers';
import type { WpPost } from './snapshot';

const KIND: Record<string, 'POST' | 'EVENT' | 'PROGRAM'> = { post: 'POST', event: 'EVENT', program: 'PROGRAM' };
const ROUTE_PREFIX = { POST: '/bai-viet', EVENT: '/su-kien', PROGRAM: '/chuong-trinh' } as const;
export const contentContext = (ctx: Ctx): ContentContext => ({
  siteUrls: ctx.siteUrls,
  resolveUpload: (rel) => {
    const id = ctx.uploads.get(rel);
    return id ? { id } : null;
  },
  resolveLegacyLink: (id) => {
    const p = ctx.planPosts.get(id);
    if (p) return `${ROUTE_PREFIX[p.kind]}/${p.slug}`;
    const pg = ctx.planPagePaths.get(id);
    return pg ? `/${pg}` : null;
  },
});

/** Reports everything the sanitiser/normaliser changed so a human can decide; returns whether the item needs review. */
function reportContent(ctx: Ctx, type: string, id: string, c: NormalizedContent): boolean {
  let review = false;
  const removed = Object.entries(c.removed);
  if (removed.length) {
    ctx.rep.add('INFO', 'CONTENT_TAGS_REMOVED', type, id, 'Sanitiser đã loại bỏ thẻ HTML không nằm trong allowlist.', { removed: c.removed });
    ctx.rep.bump('content', 'itemsSanitised');
  }
  if (c.unresolvedMedia.length) {
    review = true;
    ctx.rep.add('WARNING', 'MEDIA_REFERENCE_UNRESOLVED', type, id, `${c.unresolvedMedia.length} ảnh trong nội dung không còn tệp nguồn; đã gỡ khỏi bài.`, {
      paths: c.unresolvedMedia.slice(0, 20),
    });
    ctx.rep.bump('content', 'unresolvedImages', c.unresolvedMedia.length);
  }
  if (c.shortcodes.length) {
    review = true;
    ctx.rep.add('WARNING', 'SHORTCODE_UNSUPPORTED', type, id, 'Nội dung có shortcode WordPress không có tương ứng.', { shortcodes: [...new Set(c.shortcodes)].slice(0, 10) });
  }
  if (c.rewrittenLinks) ctx.rep.bump('content', 'linksRewritten', c.rewrittenLinks);
  return review;
}

// ───────────────────────── planning (slugs/paths decided before any content is written) ─────────────────────────
export async function planPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap } = ctx;
  const posts = await db.post.findMany({ select: { id: true, kind: true, slug: true } });
  const byId = new Map(posts.map((p) => [p.id, p]));
  const alloc = { POST: new SlugAllocator(), EVENT: new SlugAllocator(), PROGRAM: new SlugAllocator() };
  for (const p of posts) alloc[p.kind].take(p.slug);
  ctx.planPosts.clear();
  for (const p of snap.posts) {
    const kind = KIND[p.post_type];
    if (!kind || p.post_status === 'auto-draft') continue;
    const hit = ctx.idMap.get('post', p.ID);
    const existing = hit ? byId.get(hit.entityId) : undefined;
    if (existing) {
      ctx.planPosts.set(p.ID, { kind, slug: existing.slug });
      continue;
    }
    const r = alloc[kind].take(cleanWpSlug(p.post_name, p.post_title, p.ID));
    ctx.planPosts.set(p.ID, { kind, slug: r.slug, slugChanged: r.changed });
  }

  const pageRows = await db.page.findMany({ select: { id: true, slug: true, parentId: true } });
  const pageById = new Map(pageRows.map((p) => [p.id, p]));
  const systemPages = new Set([snap.options.get('page_on_front'), snap.options.get('page_for_posts')].filter((v): v is string => !!v && v !== '0'));
  const wpPages = snap.posts.filter((p) => p.post_type === 'page' && p.post_status !== 'auto-draft' && !systemPages.has(p.ID));
  const byWp = new Map(wpPages.map((p) => [p.ID, p]));
  const slugOf = new Map<string, string>();
  const allocByParent = new Map<string, SlugAllocator>();
  const allocFor = (parentKey: string, dbParentId: string | null): SlugAllocator => {
    let a = allocByParent.get(parentKey);
    if (!a) allocByParent.set(parentKey, (a = new SlugAllocator(pageRows.filter((p) => p.parentId === dbParentId).map((p) => p.slug))));
    return a;
  };
  const depthOf = (p: WpPost): number => {
    let d = 0;
    let cur = p;
    const seen = new Set<string>();
    while (cur.post_parent !== '0' && byWp.has(cur.post_parent) && !seen.has(cur.ID) && d < 8) {
      seen.add(cur.ID);
      cur = byWp.get(cur.post_parent)!;
      d++;
    }
    return d;
  };
  for (const p of [...wpPages].sort((a, b) => depthOf(a) - depthOf(b) || Number(a.ID) - Number(b.ID))) {
    const hit = ctx.idMap.get('page', p.ID);
    const existing = hit ? pageById.get(hit.entityId) : undefined;
    const parentKnown = p.post_parent !== '0' && byWp.has(p.post_parent);
    const parentHit = parentKnown ? ctx.idMap.get('page', p.post_parent) : undefined;
    slugOf.set(p.ID, existing ? existing.slug : allocFor(parentKnown ? p.post_parent : '0', parentHit?.entityId ?? null).take(cleanWpSlug(p.post_name, p.post_title, p.ID)).slug);
  }
  ctx.planPagePaths.clear();
  const pathOf = (p: WpPost, guard = 0): string =>
    p.post_parent !== '0' && byWp.has(p.post_parent) && guard < 8 ? `${pathOf(byWp.get(p.post_parent)!, guard + 1)}/${slugOf.get(p.ID)!}` : slugOf.get(p.ID)!;
  for (const p of wpPages) ctx.planPagePaths.set(p.ID, pathOf(p));
}

// ───────────────────────── pages ─────────────────────────
const PAGE_TEMPLATE: Record<string, 'CONTACT' | 'ANNOUNCEMENTS' | 'ABOUT'> = {
  'page-contact.php': 'CONTACT',
  'page-announcements.php': 'ANNOUNCEMENTS',
  'page-about.php': 'ABOUT',
};
const PAGE_STATUS_CLAMP: Record<string, 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'PRIVATE' | 'TRASHED'> = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  SCHEDULED: 'SCHEDULED',
  PRIVATE: 'PRIVATE',
  TRASHED: 'TRASHED',
  PENDING_REVIEW: 'DRAFT',
  CHANGES_REQUESTED: 'DRAFT',
  REJECTED: 'DRAFT',
};

export async function pagesPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap, rep } = ctx;
  const systemPages = new Map<string, string>([
    [snap.options.get('page_on_front') ?? '', 'trang chủ'],
    [snap.options.get('page_for_posts') ?? '', 'trang blog'],
  ]);
  const pages = snap.posts.filter((p) => p.post_type === 'page' && p.post_status !== 'auto-draft');
  for (const p of pages)
    if (systemPages.has(p.ID) && p.ID !== '0') {
      rep.bump('pages', 'skipped:system-page');
      rep.add('INFO', 'SYSTEM_PAGE_REPLACED', 'page', p.ID, `Trang WordPress "${systemPages.get(p.ID)}" được thay bằng route của hệ thống mới (nội dung không nhập).`);
      if (looksEncodingDamaged(p.post_title))
        rep.add('WARNING', 'DATA_LOSS_ENCODING', 'page', p.ID, 'Tiêu đề trang đã mất dấu tiếng Việt (ký tự "?") ngay trong file dump; không khôi phục tự động.');
    }
  const wp = pages.filter((p) => ctx.planPagePaths.has(p.ID));
  const depth = (p: WpPost): number => ctx.planPagePaths.get(p.ID)!.split('/').length;
  for (const p of [...wp].sort((a, b) => depth(a) - depth(b) || Number(a.ID) - Number(b.ID))) {
    const m = meta(snap, p.ID, '_wp_page_template');
    const statusMap = mapPostStatus({ status: p.post_status, password: p.post_password, meta: snap.postmeta.get(p.ID), isSubmissionType: false });
    let status = PAGE_STATUS_CLAMP[statusMap.status]!;
    const slug = ctx.planPagePaths.get(p.ID)!.split('/').pop()!;
    const parentWp = p.post_parent !== '0' ? p.post_parent : null;
    const parentEntry = parentWp ? ctx.pages.get(parentWp) : undefined;
    const sourceChecksum = checksumOf({ t: p.post_title, c: p.post_content, s: p.post_status, n: p.post_name, par: p.post_parent, tpl: m, o: p.menu_order, pw: !!p.post_password });
    const hit = ctx.idMap.get('page', p.ID);

    const content = normalizeLegacyContent(p.post_content, contentContext(ctx));
    let needsReview = reportContent(ctx, 'page', p.ID, content) || !!statusMap.needsReview;
    if (statusMap.issue) rep.add(statusMap.issue.severity, statusMap.issue.code, 'page', p.ID, statusMap.issue.message);
    if (parentWp && !parentEntry) {
      needsReview = true;
      rep.add('WARNING', 'PAGE_PARENT_MISSING', 'page', p.ID, 'Trang cha không được nhập; trang được đặt ở cấp gốc.');
    }
    if (looksEncodingDamaged(p.post_title)) {
      needsReview = true;
      rep.add('WARNING', 'DATA_LOSS_ENCODING', 'page', p.ID, 'Tiêu đề có thể đã mất dấu tiếng Việt (ký tự "?") trong dump; cần admin sửa tay.');
    }
    const parentId = parentEntry?.id ?? null;
    if (!parentId && isReservedTopLevelPath(slug) && status !== 'TRASHED') {
      rep.add('WARNING', 'RESERVED_PATH', 'page', p.ID, `Đường dẫn /${slug} thuộc về hệ thống mới nên trang không thể truy cập; nhập ở dạng DRAFT.`, { slug });
      status = 'DRAFT';
      needsReview = true;
    }
    const created = wpInstant(p.post_date_gmt, p.post_date, ctx.timeZone) ?? new Date();
    const modified = gmtToDate(p.post_modified_gmt) ?? created;
    const data = {
      title: p.post_title.slice(0, 300) || slug,
      contentHtml: content.html,
      contentText: content.text,
      searchText: buildSearchText(p.post_title, content.text),
      status,
      publishedAt: status === 'PUBLISHED' ? created : null,
      needsReview,
    };
    const fp = (d: { title: string; contentHtml: string; status: string }) => checksumOf({ t: d.title, c: d.contentHtml, s: d.status });

    if (hit) {
      ctx.pages.set(p.ID, { id: hit.entityId, status });
      if (hit.sourceChecksum === sourceChecksum) {
        rep.bump('pages', 'unchanged');
        continue;
      }
      const cur = await db.page.findUnique({ where: { id: hit.entityId }, select: { title: true, contentHtml: true, status: true } });
      if (!cur || fp(cur) !== hit.importedChecksum) {
        rep.bump('pages', 'conflict');
        rep.add('WARNING', 'EDITED_IN_NEW_SYSTEM', 'page', p.ID, 'Trang đã được sửa trong hệ thống mới nên không ghi đè bằng nội dung WordPress đã thay đổi.');
        continue;
      }
      await db.page.update({ where: { id: hit.entityId }, data: { ...data, version: { increment: 1 } } });
      await ctx.idMap.put(db, 'page', p.ID, { entityType: 'page', entityId: hit.entityId, sourceChecksum, importedChecksum: fp(data) });
      rep.bump('pages', 'updated');
      continue;
    }
    const row = await db.page.create({
      data: {
        ...data,
        slug,
        parentId,
        template: m ? (PAGE_TEMPLATE[m] ?? 'DEFAULT') : 'DEFAULT',
        sortOrder: p.menu_order,
        origin: 'WORDPRESS',
        createdAt: created,
        updatedAt: modified,
        deletedAt: status === 'TRASHED' ? modified : null,
      },
      select: { id: true },
    });
    ctx.pages.set(p.ID, { id: row.id, status });
    await ctx.idMap.put(db, 'page', p.ID, { entityType: 'page', entityId: row.id, sourceChecksum, importedChecksum: fp(data) });
    rep.bump('pages', 'created');
    rep.bump('pages', `status:${status}`);
  }
}

// ───────────────────────── posts / events / programs ─────────────────────────
function plain(html: string, max: number): string | null {
  const t = htmlToText(html).trim();
  return t ? t.slice(0, max) : null;
}

export async function postsPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap, rep } = ctx;
  const tagByPost = new Map<string, string[]>();
  const catByPost = new Map<string, string[]>();
  const ttToTerm = new Map(snap.terms.map((t) => [t.term_taxonomy_id, t]));
  for (const r of snap.relationships) {
    const t = ttToTerm.get(r.term_taxonomy_id);
    if (!t) continue;
    if (t.taxonomy === 'post_tag') tagByPost.set(r.object_id, [...(tagByPost.get(r.object_id) ?? []), t.term_id]);
    if (t.taxonomy === 'category') catByPost.set(r.object_id, [...(catByPost.get(r.object_id) ?? []), t.term_id]);
  }
  const fallback = ctx.categories.get('tin-tuc');

  for (const p of snap.posts) {
    const kind = KIND[p.post_type];
    if (!kind) continue;
    if (p.post_status === 'auto-draft') {
      rep.bump(`${p.post_type}s`, 'skipped:auto-draft');
      continue;
    }
    const plan = ctx.planPosts.get(p.ID) as PostPlan;
    const pm = snap.postmeta.get(p.ID);
    const sm = mapPostStatus({ status: p.post_status, password: p.post_password, meta: pm, isSubmissionType: kind === 'POST' });
    let status = sm.status;
    if (kind !== 'POST' && ['PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'].includes(status)) status = 'DRAFT';
    const created = wpInstant(p.post_date_gmt, p.post_date, ctx.timeZone) ?? new Date();
    const modified = gmtToDate(p.post_modified_gmt) ?? created;
    const likes = Math.max(0, Number.parseInt(pm?.get('_post_likes') ?? '0', 10) || 0);
    const sourceChecksum = checksumOf({
      t: p.post_title,
      c: p.post_content,
      x: p.post_excerpt,
      s: p.post_status,
      n: p.post_name,
      a: p.post_author,
      likes,
      pw: !!p.post_password,
      review: pm?.get('_submission_review'),
      cats: catByPost.get(p.ID),
      tags: tagByPost.get(p.ID),
    });
    const fp = (d: { title: string; contentHtml: string; excerpt: string | null; status: string }) => checksumOf({ t: d.title, c: d.contentHtml, e: d.excerpt, s: d.status });
    const hit = ctx.idMap.get('post', p.ID);
    const label = p.post_type;

    const content = normalizeLegacyContent(p.post_content, contentContext(ctx));
    let needsReview = reportContent(ctx, 'post', p.ID, content) || !!sm.needsReview;
    if (sm.issue) rep.add(sm.issue.severity, sm.issue.code, 'post', p.ID, sm.issue.message);
    if (plan.slugChanged) {
      needsReview = true;
      rep.add('WARNING', 'SLUG_CONFLICT_RENAMED', 'post', p.ID, `Slug trùng nên đổi thành "${plan.slug}"; URL cũ được chuyển hướng.`);
    }
    if (looksEncodingDamaged(p.post_title)) {
      needsReview = true;
      rep.add('WARNING', 'DATA_LOSS_ENCODING', 'post', p.ID, 'Tiêu đề có thể đã mất dấu tiếng Việt trong dump.');
    }

    const authorId = ctx.users.get(p.post_author) ?? null;
    if (!authorId)
      rep.add('WARNING', 'POST_AUTHOR_MISSING', 'post', p.ID, 'Tác giả WordPress không được nhập (hoặc không còn); bài không có tác giả.', { wpAuthor: p.post_author });

    // categories (articles only)
    let categoryIds: string[] = [];
    if (kind === 'POST') {
      for (const termId of catByPost.get(p.ID) ?? []) {
        const id = ctx.wpCategory.get(termId);
        if (id) categoryIds.push(id);
      }
      categoryIds = [...new Set(categoryIds)];
      if (!categoryIds.length) {
        if (fallback) categoryIds = [fallback.id];
        needsReview = true;
        rep.add('WARNING', 'POST_CATEGORY_DEFAULTED', 'post', p.ID, 'Bài không thuộc chuyên mục hệ thống nào; xếp vào "tin-tuc" và cần xem lại.');
      }
    }
    const tagIds = [...new Set((tagByPost.get(p.ID) ?? []).map((t) => ctx.wpTag.get(t)).filter((x): x is string => !!x))];

    const featuredWp = pm?.get('_thumbnail_id');
    const featuredAssetId = featuredWp ? (ctx.attachments.get(featuredWp) ?? null) : null;
    if (featuredWp && !featuredAssetId) {
      needsReview = true;
      rep.add('WARNING', 'MEDIA_FEATURED_MISSING', 'post', p.ID, 'Ảnh đại diện (thumbnail) không còn tệp nguồn.', { attachment: featuredWp });
    }

    const locale = detectLocale(`${p.post_title} ${content.text}`);
    if (locale === 'en')
      rep.add('INFO', 'CONTENT_LANGUAGE_EN', 'post', p.ID, 'Nội dung gốc bằng tiếng Anh: lưu originalLocale=en và bản dịch EN; bản VI hiển thị nội dung gốc kèm nhãn ngôn ngữ.');
    const excerpt = plain(p.post_excerpt, 1000);
    const data = {
      title: (p.post_title || plan.slug).slice(0, 300),
      excerpt,
      contentHtml: content.html,
      contentText: content.text,
      searchText: buildSearchText(p.post_title, content.text),
      status,
    };

    if (hit) {
      ctx.posts.set(p.ID, { id: hit.entityId, kind, status });
      if (hit.sourceChecksum === sourceChecksum) {
        rep.bump(`${label}s`, 'unchanged');
        continue;
      }
      const cur = await db.post.findUnique({ where: { id: hit.entityId }, select: { title: true, contentHtml: true, excerpt: true, status: true } });
      if (!cur || fp(cur) !== hit.importedChecksum) {
        rep.bump(`${label}s`, 'conflict');
        rep.add('WARNING', 'EDITED_IN_NEW_SYSTEM', 'post', p.ID, 'Bài đã được sửa/đổi trạng thái trong hệ thống mới nên không ghi đè bằng nội dung WordPress đã thay đổi.');
        continue;
      }
      await db.post.update({ where: { id: hit.entityId }, data: { ...data, legacyLikeCount: likes, version: { increment: 1 } } });
      await ctx.idMap.put(db, 'post', p.ID, { entityType: 'post', entityId: hit.entityId, sourceChecksum, importedChecksum: fp(data) });
      rep.bump(`${label}s`, 'updated');
      continue;
    }

    const trashAt = Number(pm?.get('_wp_trash_meta_time'));
    const deletedAt = status === 'TRASHED' ? (trashAt > 0 ? new Date(trashAt * 1000) : modified) : null;
    const inline = content.mediaIds.filter((id) => id !== featuredAssetId);
    const row = await db.post.create({
      data: {
        kind,
        slug: plan.slug,
        authorId,
        ...data,
        featuredAssetId,
        publishedAt: status === 'PUBLISHED' ? created : null,
        scheduledAt: status === 'SCHEDULED' ? created : null,
        submittedAt: ['PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'].includes(status) ? modified : null,
        commentsOpen: p.comment_status === 'open',
        legacyLikeCount: likes,
        origin: 'WORDPRESS',
        needsReview,
        originalLocale: locale,
        createdAt: created,
        updatedAt: modified,
        deletedAt,
        categories: categoryIds.length ? { create: categoryIds.map((categoryId, i) => ({ categoryId, isPrimary: i === 0 })) } : undefined,
        tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        translations:
          locale === 'en'
            ? { create: [{ locale: 'en', title: data.title, excerpt, contentHtml: data.contentHtml, contentText: data.contentText, searchText: data.searchText }] }
            : undefined,
        media: {
          create: [
            ...(featuredAssetId ? [{ assetId: featuredAssetId, role: 'FEATURED' as const, sortOrder: 0 }] : []),
            ...inline.map((assetId, i) => ({ assetId, role: 'INLINE' as const, sortOrder: i })),
          ],
        },
        eventDetail: kind === 'EVENT' ? { create: {} } : undefined,
        programDetail: kind === 'PROGRAM' ? { create: {} } : undefined,
      } as Prisma.PostUncheckedCreateInput,
      select: { id: true },
    });
    ctx.posts.set(p.ID, { id: row.id, kind, status });
    await ctx.idMap.put(db, 'post', p.ID, { entityType: 'post', entityId: row.id, sourceChecksum, importedChecksum: fp(data) });

    if (sm.review) {
      await db.reviewEvent.create({
        data: {
          postId: row.id,
          actorId: null,
          action: sm.review.action,
          fromStatus: 'PENDING_REVIEW',
          toStatus: status,
          reason: (sm.review.reason ?? '(Lý do không được ghi lại trong WordPress)').slice(0, LIMITS.reasonMax),
          postVersion: 1,
          createdAt: modified,
        },
      });
      rep.bump('posts', 'reviewEvents');
    }
    const assetIds = [...(featuredAssetId ? [featuredAssetId] : []), ...inline];
    if (assetIds.length) {
      if (status === 'PUBLISHED') await ctx.media.setVisibility(db, assetIds, 'PUBLIC');
      else await db.mediaAsset.updateMany({ where: { id: { in: assetIds }, status: 'ORPHAN' }, data: { status: 'ACTIVE', attachedAt: new Date() } });
    }
    rep.bump(`${label}s`, 'created');
    rep.bump(`${label}s`, `status:${status}`);
    if (likes) rep.bump('posts', 'legacyLikes', likes);
  }

  // WordPress revisions (kept as read-only history; never part of the new workflow versions)
  for (const r of snap.posts.filter((x) => x.post_type === 'revision')) {
    const parent = ctx.posts.get(r.post_parent);
    if (!parent) {
      rep.bump('revisions', 'skipped:parent-not-migrated');
      continue;
    }
    if (ctx.idMap.get('revision', r.ID)) {
      rep.bump('revisions', 'unchanged');
      continue;
    }
    const c = normalizeLegacyContent(r.post_content, contentContext(ctx));
    const row = await db.postRevision.create({
      data: {
        postId: parent.id,
        version: 0,
        kind: 'WP_REVISION',
        actorId: ctx.users.get(r.post_author) ?? null,
        title: (r.post_title || '(không tiêu đề)').slice(0, 300),
        contentHtml: c.html,
        categoryIds: [],
        createdAt: wpInstant(r.post_date_gmt, r.post_date, ctx.timeZone) ?? new Date(),
      },
      select: { id: true },
    });
    const sum = checksumOf({ t: r.post_title, c: r.post_content });
    await ctx.idMap.put(db, 'revision', r.ID, { entityType: 'post_revision', entityId: row.id, sourceChecksum: sum, importedChecksum: sum });
    rep.bump('revisions', 'created');
  }
  const pageRevisions = snap.posts.filter((x) => x.post_type === 'revision' && !ctx.posts.has(x.post_parent) && ctx.pages.has(x.post_parent)).length;
  if (pageRevisions)
    rep.add('INFO', 'PAGE_REVISIONS_NOT_IMPORTED', undefined, undefined, `${pageRevisions} bản sửa đổi của trang không được nhập (mô hình mới chỉ lưu lịch sử bài viết).`);
  for (const ignored of ['customize_changeset', 'wp_global_styles', 'wp_navigation', 'nav_menu_item']) {
    const n = snap.posts.filter((x) => x.post_type === ignored).length;
    if (n) rep.bump('ignored', `post_type:${ignored}`, n);
  }
}

// ───────────────────────── comments ─────────────────────────
export async function commentsPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap, rep } = ctx;
  const done = new Map<string, { id: string; depth: number }>(); // WP comment id → entity
  for (const c of snap.comments) {
    const sourceChecksum = checksumOf({ p: c.comment_post_ID, a: c.comment_author, d: c.comment_date_gmt, t: c.comment_content, ap: c.comment_approved, par: c.comment_parent });
    const hit = ctx.idMap.get('comment', c.comment_ID);
    if (hit) {
      done.set(c.comment_ID, { id: hit.entityId, depth: 0 });
      rep.bump('comments', hit.sourceChecksum === sourceChecksum ? 'unchanged' : 'sourceChanged');
      continue;
    }
    if (c.comment_type && c.comment_type !== 'comment') {
      rep.bump('comments', `skipped:${c.comment_type}`);
      continue;
    }
    const post = ctx.posts.get(c.comment_post_ID);
    if (!post) {
      rep.bump('comments', 'skipped:not-on-migrated-post');
      rep.add('WARNING', 'COMMENT_TARGET_MISSING', 'comment', c.comment_ID, 'Bình luận thuộc nội dung không được nhập (trang hoặc bài bị bỏ); không nhập.');
      continue;
    }
    if (post.kind !== 'POST') {
      rep.bump('comments', 'skipped:event-or-program');
      continue;
    }
    const body = htmlToText(c.comment_content).trim().slice(0, LIMITS.commentMax);
    if (!body) {
      rep.bump('comments', 'skipped:empty');
      continue;
    }
    const parentRow = c.comment_parent !== '0' ? done.get(c.comment_parent) : undefined;
    if (c.comment_parent !== '0' && !parentRow) rep.add('WARNING', 'COMMENT_PARENT_MISSING', 'comment', c.comment_ID, 'Bình luận cha không được nhập; đặt ở cấp gốc.');
    const depth = parentRow ? Math.min(LIMITS.commentMaxDepth, parentRow.depth + 1) : 0;
    const row = await db.comment.create({
      data: {
        postId: post.id,
        authorId: ctx.users.get(c.user_id) ?? null,
        authorName: (c.comment_author || 'Khách').slice(0, 100),
        parentId: parentRow?.id ?? null,
        depth: parentRow ? depth : 0,
        body,
        status: mapCommentStatus(c.comment_approved),
        createdAt: gmtToDate(c.comment_date_gmt) ?? new Date(),
      },
      select: { id: true },
    });
    done.set(c.comment_ID, { id: row.id, depth: parentRow ? depth : 0 });
    await ctx.idMap.put(db, 'comment', c.comment_ID, { entityType: 'comment', entityId: row.id, sourceChecksum, importedChecksum: sourceChecksum });
    rep.bump('comments', 'created');
    rep.bump('comments', `status:${mapCommentStatus(c.comment_approved)}`);
  }
  if (snap.comments.length) rep.add('INFO', 'COMMENT_PII_DROPPED', undefined, undefined, 'E-mail, IP, URL và user-agent của người bình luận không được nhập (chỉ tên hiển thị).');
}

// ───────────────────────── feedback + contact inboxes ─────────────────────────
export async function inboxesPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap, rep } = ctx;
  const userEmail = new Map(snap.users.map((u) => [u.ID, u.user_email]));
  const userName = new Map(snap.users.map((u) => [u.ID, u.display_name || u.user_login]));
  for (const p of snap.posts) {
    if (p.post_type !== 'riseup_feedback' && p.post_type !== 'riseup_contact') continue;
    const isFeedback = p.post_type === 'riseup_feedback';
    const type = isFeedback ? 'feedback' : 'contact';
    const sourceChecksum = checksumOf({ t: p.post_title, c: p.post_content, a: p.post_author, d: p.post_date_gmt, s: p.post_status });
    if (ctx.idMap.get(type, p.ID)) {
      rep.bump(`${type}s`, 'unchanged');
      continue;
    }
    if (p.post_status === 'trash') {
      rep.bump(`${type}s`, 'skipped:trashed');
      rep.add('INFO', 'INBOX_ITEM_TRASHED', type, p.ID, 'Mục đã bị xoá (thùng rác) trong WordPress; không nhập.');
      continue;
    }
    const createdAt = wpInstant(p.post_date_gmt, p.post_date, ctx.timeZone) ?? new Date();
    const authorId = ctx.users.get(p.post_author) ?? null;
    const pm = snap.postmeta.get(p.ID);
    if (isFeedback) {
      const row = await db.feedback.create({
        data: {
          authorId,
          subject: (p.post_title.trim() || '(không có tiêu đề)').slice(0, LIMITS.feedbackSubjectMax),
          message: (p.post_content.trim() || '(trống)').slice(0, LIMITS.feedbackMessageMax),
          status: 'NEW',
          createdAt,
          origin: 'WORDPRESS',
        },
        select: { id: true },
      });
      await ctx.idMap.put(db, 'feedback', p.ID, { entityType: 'feedback', entityId: row.id, sourceChecksum, importedChecksum: sourceChecksum });
      rep.bump('feedbacks', 'created');
      if (!authorId) rep.add('WARNING', 'FEEDBACK_AUTHOR_MISSING', 'feedback', p.ID, 'Người gửi góp ý không còn tài khoản nhập được.');
    } else {
      const parsed = parseLegacyContact(p.post_content, pm?.get('_contact_email'));
      const rawEmail = parsed.email ?? userEmail.get(p.post_author) ?? '';
      const email = emailSchema.safeParse(rawEmail);
      if (!email.success) rep.add('WARNING', 'CONTACT_EMAIL_INVALID', 'contact', p.ID, 'Liên hệ không có e-mail hợp lệ; dùng địa chỉ giữ chỗ để không mất nội dung.');
      const mail = pm?.get('_contact_mail');
      const row = await db.contactMessage.create({
        data: {
          receiptCode: `LH-WP-${p.ID.padStart(6, '0')}`.slice(0, 24),
          userId: authorId,
          name: (parsed.name ?? userName.get(p.post_author) ?? 'Không rõ').slice(0, LIMITS.contactNameMax),
          email: email.success ? normalizeEmail(email.data) : 'khong-co-email@invalid.example',
          subject: p.post_title.trim().slice(0, LIMITS.contactSubjectMax),
          message: (parsed.message || '(trống)').slice(0, LIMITS.contactMessageMax),
          status: pm?.get('_contact_status') === 'done' ? 'DONE' : 'NEW',
          mailState: mail === 'accepted' ? 'SENT_TO_PROVIDER' : mail === 'failed' ? 'FAILED' : 'NONE',
          origin: 'WORDPRESS',
          createdAt,
        },
        select: { id: true },
      });
      await ctx.idMap.put(db, 'contact', p.ID, { entityType: 'contact_message', entityId: row.id, sourceChecksum, importedChecksum: sourceChecksum });
      rep.bump('contacts', 'created');
    }
  }
}
