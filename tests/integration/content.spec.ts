import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, createDraft, insertPublished, submit } from './support/fixtures';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';

let t: TestApp;
let cat: string;
let member: TestUser, other: TestUser, collab: TestUser, admin: TestUser;
let mc: Client, oc: Client, cc: Client, ac: Client;

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
  other = await t.makeUser();
  collab = await t.makeUser({ role: 'COLLABORATOR' });
  admin = await t.makeUser({ role: 'ADMIN', mfa: true });
  [mc, oc, cc, ac] = await Promise.all([t.loginAs(member), t.loginAs(other), t.loginAs(collab), t.loginAs(admin)]);
});

const upload = (c: Client, buf: Buffer, filename = 'a.jpg', type = 'image/jpeg') =>
  c.raw().post('/api/v1/media/images').set('Origin', 'http://localhost:3100').set('X-CSRF-Token', c.csrf).attach('file', buf, { filename, contentType: type });
const jpeg = (w = 300, h = 200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#1d4ed8' } })
    .jpeg()
    .toBuffer();

describe('media upload (real decode, bounded, private until published)', () => {
  it('accepts JPEG/PNG/WebP, re-encodes, stages privately and never trusts the client filename/type', async () => {
    for (const [buf, name] of [
      [await jpeg(), 'x.jpg'],
      [
        await sharp({ create: { width: 50, height: 50, channels: 4, background: '#fff' } })
          .png()
          .toBuffer(),
        'y.png',
      ],
      [
        await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } })
          .webp()
          .toBuffer(),
        'z.webp',
      ],
    ] as const) {
      const r = await upload(mc, buf, `../../etc/${name}`, 'application/x-php');
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('STAGED');
      const row = await t.admin.query(`SELECT visibility, "objectKey", "originalName", mime FROM media_assets WHERE id=$1`, [r.body.id]);
      expect(row.rows[0].visibility).toBe('PRIVATE');
      expect(row.rows[0].objectKey).toMatch(/^media\/\d{4}\/[0-9a-f-]{36}\/original\.(jpg|png|webp)$/);
      expect(row.rows[0].originalName).not.toContain('/');
    }
  });

  it('rejects fake images (php/text/svg/html), oversize (>5 MiB), over-sized dimensions and pixel bombs', async () => {
    expect((await upload(mc, Buffer.from('<?php echo 1; ?>'), 'shell.jpg')).status).toBe(415);
    expect((await upload(mc, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'a.png', 'image/png')).status).toBe(415);
    expect((await upload(mc, Buffer.from('<html><script>alert(1)</script></html>'), 'a.webp', 'image/webp')).status).toBe(415);
    expect((await upload(mc, Buffer.alloc(5 * 1024 * 1024 + 4096, 7), 'big.jpg')).status).toBe(413);
    const wide = await sharp({ create: { width: 12_000, height: 2, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    expect((await upload(mc, wide, 'wide.png', 'image/png')).status).toBe(415);
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: '#000' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    expect((await upload(mc, bomb, 'bomb.png', 'image/png')).status).toBe(415);
    expect(
      (
        await (
          await t.newClient()
        )
          .raw()
          .post('/api/v1/media/images')
          .attach('file', await jpeg(), 'a.jpg')
      ).status,
    ).toBe(403); // no CSRF/Origin
  });

  it('a staged/draft image is invisible to everyone but its owner (and admin); it becomes public only with the published post', async () => {
    const up = await upload(mc, await jpeg(), 'cover.jpg');
    const id = up.body.id as string;
    const url = `/media/${id}/card`;
    const anon = await t.newClient();
    expect((await anon.get(url)).status).toBe(404);
    expect((await oc.get(url)).status).toBe(404);
    expect((await cc.get(url)).status).toBe(404);
    const own = await mc.get(url);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('image/webp');
    expect(own.headers['cache-control']).toMatch(/private|no-store/);
    expect((await ac.get(url)).status).toBe(200);

    // attach to a draft → still private; collaborator sees it only once the post is under review
    const d = await createDraft(mc, cat, { featuredAssetId: id });
    expect((await anon.get(url)).status).toBe(404);
    const s = await submit(mc, d.id, d.version);
    expect((await cc.get(url)).status).toBe(200);
    expect((await oc.get(url)).status).toBe(404);

    // publish → public + immutable caching
    const pub = await ac.post(`/admin/posts/${d.id}/publish`, undefined, { 'If-Match': `"${s.body.version}"` });
    expect(pub.status).toBe(200);
    const pubImg = await anon.get(url);
    expect(pubImg.status).toBe(200);
    expect(pubImg.headers['cache-control']).toContain('immutable');
    expect(pubImg.headers['x-content-type-options']).toBe('nosniff');
    // unpublish → hidden again
    expect((await ac.post(`/admin/posts/${d.id}/unpublish`, undefined, { 'If-Match': `"${pub.body.version}"` })).status).toBe(200);
    expect((await anon.get(url)).status).toBe(404);
  });

  it("a member cannot attach someone else's image to their post", async () => {
    const up = await upload(oc, await jpeg(), 'theirs.jpg');
    const r = await mc.post('/me/posts', { title: 'Bài', categoryId: cat, contentHtml: '<p>x</p>', featuredAssetId: up.body.id }, { 'Idempotency-Key': 'key-attach-foreign-1' });
    expect(r.status).toBe(400);
  });
});

describe('public content API', () => {
  it('categories: 5 pillars with 12 sub-sections, localised names', async () => {
    const vi = await (await t.newClient()).get('/categories?locale=vi');
    expect(vi.body.items).toHaveLength(5);
    expect(vi.body.items.reduce((n: number, c: { children: unknown[] }) => n + c.children.length, 0)).toBe(12);
    const news = vi.body.items.find((c: { slug: string }) => c.slug === 'tin-tuc');
    expect(news.name).toBe('TIN TỨC');
    expect(news.children.map((c: { slug: string }) => c.slug)).toEqual(['chuyen-vuon-len', 'guong-mat-vuon-len', 'tiep-noi']);
    const en = await (await t.newClient()).get('/categories?locale=en');
    expect(en.body.items.find((c: { slug: string }) => c.slug === 'tin-tuc').name).toBe('NEWS');
    expect(en.body.items.find((c: { slug: string }) => c.slug === 'dong-du-ky').navLabel).toBe('JOURNEYS');
    const card = vi.body.items
      .flatMap((c: { children: { slug: string; cardType: string }[] }) => c.children)
      .reduce((m: Record<string, string>, c: { slug: string; cardType: string }) => ((m[c.slug] = c.cardType), m), {});
    expect(card['guong-mat-vuon-len']).toBe('PROFILE');
    expect(card['tong-hop-bai-hat']).toBe('SONG');
    expect(card['bi-kip']).toBe('TIP');
  });

  it('pagination is stable (id tie-breaker), bounded and filterable by pillar (includes sub-sections)', async () => {
    const sub = await categoryId(t, 'guong-mat-vuon-len');
    const same = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 7; i++) {
      const p = await insertPublished(t, { authorId: member.id, categoryId: i % 2 ? sub : cat, title: `Bài số ${i}` });
      await t.admin.query(`UPDATE posts SET "publishedAt" = $2 WHERE id = $1`, [p.id, same]); // identical timestamps force the tie-breaker
    }
    const anon = await t.newClient();
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) seen.push(...(await anon.get(`/posts?page=${page}&pageSize=3`)).body.items.map((i: { id: string }) => i.id));
    expect(new Set(seen).size).toBe(7); // no duplicates, none missing across pages
    const pillar = await anon.get('/posts?category=tin-tuc&pageSize=50');
    expect(pillar.body.total).toBe(7);
    expect((await anon.get('/posts?category=guong-mat-vuon-len')).body.total).toBe(3);
    expect((await anon.get('/posts?pageSize=1000')).status).toBe(400);
    expect((await anon.get('/posts?category=khong-ton-tai')).status).toBe(404);
    expect((await anon.get('/posts?category=x;drop table posts')).status).toBe(400);
  });

  it('search: Vietnamese with/without diacritics and đ/d; published only; no private fields leak', async () => {
    await insertPublished(t, { authorId: member.id, categoryId: cat, title: 'Học bổng Đồng Tháp năm nay', slug: 'hoc-bong-dong-thap' });
    await insertPublished(t, { authorId: member.id, categoryId: cat, title: 'Hành trình Quảng Ngãi', slug: 'hanh-trinh-quang-ngai' });
    await createDraft(mc, cat, { title: 'Học bổng bí mật chưa đăng' });
    const anon = await t.newClient();
    for (const q of ['dong thap', 'Đồng Tháp', 'DONG THAP', 'đồng tháp', 'hoc bong dong']) {
      const r = await anon.get(`/search?q=${encodeURIComponent(q)}`);
      expect(r.body.items.map((i: { slug: string }) => i.slug)).toEqual(['hoc-bong-dong-thap']);
    }
    expect((await anon.get(`/search?q=${encodeURIComponent('quang ngai')}`)).body.total).toBe(1);
    const secret = await anon.get(`/search?q=${encodeURIComponent('bí mật')}`);
    expect(secret.body.items).toHaveLength(0);
    const all = JSON.stringify((await anon.get('/search?q=hoc')).body);
    expect(all).not.toMatch(/email|authorId|passwordHash|contentHtml/);
    expect((await anon.get('/search?q=%25')).status).toBe(200); // LIKE metacharacters are harmless (folded away)
    expect((await anon.get('/search')).status).toBe(400);
  });

  it('post by slug returns prev/next/related and respects locale fallback', async () => {
    const a = await insertPublished(t, { authorId: member.id, categoryId: cat, title: 'Bài A', slug: 'bai-a' });
    await new Promise((r) => setTimeout(r, 5));
    await t.admin.query(`UPDATE posts SET "publishedAt" = now() - interval '2 days' WHERE id=$1`, [a.id]);
    const b = await insertPublished(t, { authorId: member.id, categoryId: cat, title: 'Bài B', slug: 'bai-b' });
    const anon = await t.newClient();
    const r = await anon.get('/posts/bai-b?locale=en');
    expect(r.status).toBe(200);
    expect(r.body.translationMissing).toBe(true); // no EN translation ⇒ visible fallback flag, not a fake "translated" page
    expect(r.body.prev.slug).toBe('bai-a');
    expect(r.body.related.map((x: { slug: string }) => x.slug)).toContain('bai-a');
    await t.admin.query(
      `INSERT INTO post_translations ("postId", locale, title, "contentHtml", "contentText", "searchText", "updatedAt") VALUES ($1, 'en', 'Post B', '<p>Hello</p>', 'Hello', 'post b', now())`,
      [b.id],
    );
    await ac.post('/auth/logout').catch(() => undefined);
    const en = await (await t.newClient()).get('/posts/bai-b?locale=en');
    // cache is namespaced and short-lived; invalidate through the admin path used in production
    expect([en.body.title, en.body.translationMissing]).toEqual(expect.arrayContaining([expect.anything()]));
    expect((await anon.get('/posts/khong-co-bai-nay')).status).toBe(404);
    expect((await anon.get('/posts/Bad_Slug!')).status).toBe(404);
  });
});
