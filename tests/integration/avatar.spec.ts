import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, insertPublished } from './support/fixtures';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';

let t: TestApp;
let cat: string;
let member: TestUser, collab: TestUser, admin: TestUser;
let mc: Client, cc: Client, ac: Client;

beforeAll(async () => {
  t = await createTestApp();
  cat = await categoryId(t, 'chuyen-vuon-len');
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  member = await t.makeUser();
  collab = await t.makeUser({ role: 'COLLABORATOR' });
  admin = await t.makeUser({ role: 'ADMIN', mfa: true });
  [mc, cc, ac] = await Promise.all([t.loginAs(member), t.loginAs(collab), t.loginAs(admin)]);
});

const upload = (c: Client, buf: Buffer, filename = 'a.jpg', type = 'image/jpeg') =>
  c.raw().post('/api/v1/me/avatar').set('Origin', 'http://localhost:3100').set('X-CSRF-Token', c.csrf).attach('file', buf, { filename, contentType: type });
const jpeg = (w = 300, h = 200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#1d4ed8' } })
    .jpeg()
    .toBuffer();
const assetOf = async (userId: string) => (await t.admin.query(`SELECT "avatarAssetId" FROM users WHERE id=$1`, [userId])).rows[0].avatarAssetId as string | null;
const statusOf = async (assetId: string) => (await t.admin.query(`SELECT status, purpose, visibility FROM media_assets WHERE id=$1`, [assetId])).rows[0];

describe('profile picture (own account)', () => {
  it('upload → square public variants shown in the session, comments and lists; replacing retires the old one; removing clears it', async () => {
    const r = await upload(mc, await jpeg(300, 200));
    expect(r.status).toBe(200);
    expect(r.body.avatarUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f-]{36}\/card$/);
    const first = (await assetOf(member.id))!;
    expect(await statusOf(first)).toEqual({ status: 'ACTIVE', purpose: 'AVATAR', visibility: 'PUBLIC' });
    expect((await mc.get('/auth/me')).body.user.avatarUrl).toBe(r.body.avatarUrl);

    // anyone can load it (it sits next to public comments); every variant is a square crop
    const anon = await t.newClient();
    for (const [variant, side] of [
      ['thumb', 96],
      ['card', 256],
      ['large', 512],
    ] as const) {
      const img = await anon.raw().get(`/api/v1/media/${first}/${variant}`).buffer(true);
      expect(img.status).toBe(200);
      expect(img.headers['cache-control']).toContain('public');
      const meta = await sharp(img.body as Buffer).metadata();
      expect([meta.width, meta.height]).toEqual([side, side]);
    }

    const post = await insertPublished(t, { authorId: admin.id, categoryId: cat });
    expect((await mc.post(`/posts/${post.id}/comments`, { body: 'Có ảnh đại diện' })).body.authorAvatar).toBe(`/api/v1/media/${first}/thumb`);
    expect((await anon.get(`/posts/${post.id}/comments`)).body.items[0].authorAvatar).toBe(`/api/v1/media/${first}/thumb`);
    const listed = (await ac.get(`/admin/users?q=${member.username}`)).body.items[0];
    expect(listed.avatarUrl).toBe(`/api/v1/media/${first}/thumb`);

    // replace: the previous picture is retired and no longer served
    expect((await upload(mc, await jpeg(800, 1200))).status).toBe(200);
    const second = (await assetOf(member.id))!;
    expect(second).not.toBe(first);
    expect((await statusOf(first)).status).toBe('DELETED');
    expect((await anon.raw().get(`/api/v1/media/${first}/card`)).status).toBe(404);

    // remove (idempotent)
    expect((await mc.delete('/me/avatar')).status).toBe(204);
    expect((await mc.delete('/me/avatar')).status).toBe(204);
    expect(await assetOf(member.id)).toBeNull();
    expect((await statusOf(second)).status).toBe('DELETED');
    expect((await mc.get('/auth/me')).body.user.avatarUrl).toBeNull();
    expect((await anon.get(`/posts/${post.id}/comments`)).body.items[0].authorAvatar).toBeNull();
  });

  it('refuses non-images, anonymous, unverified and restricted accounts', async () => {
    expect((await upload(mc, Buffer.from('<?php echo 1; ?>'), 'a.jpg')).status).toBe(415);
    expect((await upload(mc, Buffer.alloc(0))).status).toBe(400);
    const anon = await t.newClient();
    expect(
      (
        await anon
          .raw()
          .post('/api/v1/me/avatar')
          .set('Origin', 'http://localhost:3100')
          .set('X-CSRF-Token', anon.csrf)
          .attach('file', await jpeg(), 'a.jpg')
      ).status,
    ).toBe(401);

    const unverified = await t.loginAs(await t.makeUser({ verified: false }));
    const u = await upload(unverified, await jpeg());
    expect(u.status).toBe(403);
    expect(u.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    await t.admin.query(`UPDATE users SET "restrictedAt"=now(), "restrictionReason"='spam' WHERE id=$1`, [member.id]);
    const restricted = await upload(mc, await jpeg());
    expect(restricted.status).toBe(403);
    expect(restricted.body.error.code).toBe('ACCOUNT_RESTRICTED');
    expect(await assetOf(member.id)).toBeNull();
  });
});

describe('profile picture (staff take-down)', () => {
  it('a collaborator removes a member’s picture with a reason (owner notified); not an administrator’s; members cannot', async () => {
    await upload(mc, await jpeg());
    await upload(ac, await jpeg());
    const memberAsset = (await assetOf(member.id))!;

    const other = await t.loginAs(await t.makeUser());
    expect((await other.post(`/staff/users/${member.id}/remove-avatar`, { reason: 'x' })).status).toBe(403);
    expect((await cc.post(`/staff/users/${member.id}/remove-avatar`, {})).status).toBe(400); // reason required
    const r = await cc.post(`/staff/users/${member.id}/remove-avatar`, { reason: 'Ảnh không phù hợp' });
    expect(r.status).toBe(200);
    expect(await assetOf(member.id)).toBeNull();
    expect((await statusOf(memberAsset)).status).toBe('DELETED');
    const n = await t.admin.query(`SELECT body FROM notifications WHERE "userId"=$1 AND type='account.avatar_removed'`, [member.id]);
    expect(n.rows).toEqual([{ body: 'Ảnh không phù hợp' }]);
    expect((await cc.post(`/staff/users/${member.id}/remove-avatar`, { reason: 'lại' })).status).toBe(409); // nothing left to remove

    expect((await cc.post(`/staff/users/${admin.id}/remove-avatar`, { reason: 'x' })).status).toBe(404); // out of a collaborator's scope
    expect(await assetOf(admin.id)).not.toBeNull();

    await upload(cc, await jpeg());
    expect((await ac.post(`/staff/users/${collab.id}/remove-avatar`, { reason: 'Ảnh không phù hợp' })).status).toBe(200);
    const audit = await t.admin.query(`SELECT count(*)::int n FROM audit_logs WHERE action='user.avatar_remove' AND metadata->>'by'='staff'`);
    expect(audit.rows[0].n).toBe(2);
  });

  it('anonymising an account deletes its picture too (personal data)', async () => {
    await upload(mc, await jpeg());
    const asset = (await assetOf(member.id))!;
    expect((await ac.delete(`/admin/users/${member.id}`)).status).toBeLessThan(300);
    expect(await assetOf(member.id)).toBeNull();
    expect((await statusOf(asset)).status).toBe('DELETED');
  });
});
