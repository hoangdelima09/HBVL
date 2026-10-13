import { emailSchema, LIMITS, normalizeEmail, normalizeUsername, slugify, usernameSchema } from '@hbvl/contracts';
import type { Ctx, Db } from './context';
import { checksumOf, mapRoles, wpInstant } from './mappers';

/**
 * Users. WordPress password hashes are NEVER read into the new system: every migrated account is PENDING_RESET with a NULL hash and becomes
 * usable only through the e-mail activation / reset flow (which also proves ownership of the address). Nobody is merged by display name.
 */
export async function usersPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap, rep } = ctx;
  const capKey = `${snap.prefix}capabilities`;
  const existing = await db.user.findMany({ select: { id: true, emailNormalized: true, usernameNormalized: true } });
  const byEmail = new Map(existing.map((u) => [u.emailNormalized, u.id]));
  const usernames = new Set(existing.map((u) => u.usernameNormalized));

  for (const u of snap.users) {
    const caps = snap.usermeta.get(u.ID)?.get(capKey);
    const sourceChecksum = checksumOf({ login: u.user_login, email: u.user_email, name: u.display_name, registered: u.user_registered, caps });
    const hit = ctx.idMap.get('user', u.ID);
    if (hit) {
      ctx.users.set(u.ID, hit.entityId);
      if (hit.sourceChecksum === sourceChecksum) rep.bump('users', 'unchanged');
      else {
        rep.bump('users', 'sourceChanged');
        rep.add('INFO', 'SOURCE_CHANGED_NOT_APPLIED', 'user', u.ID, 'Tài khoản đã nhập có thay đổi ở nguồn; không ghi đè tài khoản trong hệ thống mới.');
      }
      continue;
    }

    const parsed = emailSchema.safeParse(u.user_email);
    if (!parsed.success) {
      rep.bump('users', 'skipped');
      rep.bump('users', 'skipped:no-valid-email');
      rep.add(
        'ERROR',
        'USER_NO_VALID_EMAIL',
        'user',
        u.ID,
        'Tài khoản WordPress không có e-mail hợp lệ nên không thể kích hoạt; admin cần gán e-mail thủ công. Nội dung của tài khoản này mất liên kết tác giả.',
      );
      continue;
    }
    const email = parsed.data;
    const emailNormalized = normalizeEmail(email);
    const conflict = byEmail.get(emailNormalized);
    if (conflict) {
      if (ctx.opts.linkExistingByEmail) {
        ctx.users.set(u.ID, conflict);
        await ctx.idMap.put(db, 'user', u.ID, { entityType: 'user', entityId: conflict, sourceChecksum, importedChecksum: checksumOf({ linked: true }) });
        rep.bump('users', 'linkedExisting');
        rep.add('INFO', 'USER_LINKED_EXISTING', 'user', u.ID, 'Liên kết với tài khoản hiện có cùng e-mail (không đổi vai trò/mật khẩu của tài khoản đó).');
      } else {
        rep.bump('users', 'skipped');
        rep.bump('users', 'skipped:email-conflict');
        rep.add(
          'ERROR',
          'USER_EMAIL_CONFLICT',
          'user',
          u.ID,
          'E-mail đã thuộc về một tài khoản hiện có. Không tự gộp; chạy lại với --link-existing-by-email nếu đó đúng là cùng một người.',
        );
      }
      continue;
    }

    let username = usernameSchema.safeParse(u.user_login).success ? u.user_login.trim() : slugify(u.user_login);
    if (!usernameSchema.safeParse(username).success) username = `wp-user-${u.ID}`;
    if (username !== u.user_login.trim()) rep.add('WARNING', 'USERNAME_ADJUSTED', 'user', u.ID, 'Tên đăng nhập WordPress không hợp lệ ở hệ thống mới nên đã được chuẩn hoá.');
    let normalized = normalizeUsername(username);
    if (usernames.has(normalized)) {
      username = `${username.slice(0, LIMITS.usernameMax - 12)}-wp${u.ID}`;
      normalized = normalizeUsername(username);
      rep.add('WARNING', 'USERNAME_CONFLICT_RENAMED', 'user', u.ID, 'Trùng tên đăng nhập với tài khoản khác; đã thêm hậu tố -wp<ID>.');
    }

    const { role, issue } = mapRoles(caps);
    if (issue) rep.add('WARNING', issue.code, 'user', u.ID, issue.message, issue.detail);
    if (u.user_status !== 0) rep.add('INFO', 'USER_STATUS_NONZERO', 'user', u.ID, `user_status=${u.user_status} (trường WordPress cũ, không dùng).`);

    const created = await db.user.create({
      data: {
        username,
        usernameNormalized: normalized,
        email,
        emailNormalized,
        displayName: (u.display_name || u.user_login).trim().slice(0, LIMITS.displayNameMax) || username,
        passwordHash: null,
        role,
        status: 'PENDING_RESET',
        emailVerifiedAt: null,
        locale: 'vi',
        createdAt: wpInstant('', u.user_registered, ctx.timeZone) ?? new Date(),
        profile: { create: {} },
      },
      select: { id: true },
    });
    byEmail.set(emailNormalized, created.id);
    usernames.add(normalized);
    ctx.users.set(u.ID, created.id);
    await ctx.idMap.put(db, 'user', u.ID, { entityType: 'user', entityId: created.id, sourceChecksum, importedChecksum: checksumOf({ role, status: 'PENDING_RESET' }) });
    rep.bump('users', 'created');
    rep.bump('users', `role:${role}`);
  }
}

/** Tags and categories. WordPress categories only map onto the 17 system categories by slug (the theme creates them with these slugs). */
export async function termsPhase(ctx: Ctx, db: Db): Promise<void> {
  const { snap, rep } = ctx;
  for (const t of snap.terms) {
    const sourceChecksum = checksumOf({ n: t.name, s: t.slug, tax: t.taxonomy, p: t.parent });
    if (t.taxonomy === 'post_tag') {
      const slug = slugify(t.slug || t.name).slice(0, 100);
      if (!slug) {
        rep.bump('tags', 'skipped');
        continue;
      }
      const tag = await db.tag.upsert({ where: { slug }, update: {}, create: { slug, name: t.name.slice(0, 100) }, select: { id: true } });
      ctx.wpTag.set(t.term_id, tag.id);
      if (!ctx.idMap.get('term', t.term_id)) {
        await ctx.idMap.put(db, 'term', t.term_id, { entityType: 'tag', entityId: tag.id, sourceChecksum, importedChecksum: sourceChecksum });
        rep.bump('tags', 'created');
      } else rep.bump('tags', 'unchanged');
    } else if (t.taxonomy === 'category') {
      const cat = ctx.categories.get(t.slug);
      ctx.wpCategory.set(t.term_id, cat?.id ?? null);
      if (cat) {
        if (!ctx.idMap.get('term', t.term_id))
          await ctx.idMap.put(db, 'term', t.term_id, { entityType: 'category', entityId: cat.id, sourceChecksum, importedChecksum: sourceChecksum });
        rep.bump('categories', 'mapped');
      } else if (t.slug === 'uncategorized') {
        rep.bump('categories', 'ignored:uncategorized');
      } else {
        rep.bump('categories', 'unmapped');
        rep.add(
          'WARNING',
          'CATEGORY_UNMAPPED',
          'term',
          t.term_id,
          `Chuyên mục WordPress "${t.slug}" không trùng slug với chuyên mục hệ thống; bài thuộc chuyên mục này được xếp vào "tin-tuc" và đánh dấu cần xem lại.`,
          { slug: t.slug },
        );
      }
    } else {
      rep.bump('terms', `ignored:${t.taxonomy}`);
    }
  }
}
