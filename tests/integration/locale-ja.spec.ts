import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, insertPublished } from './support/fixtures';
import { createTestApp, type TestApp } from './support/app';

let t: TestApp;
let cat: string;

beforeAll(async () => {
  t = await createTestApp();
  cat = await categoryId(t, 'tin-tuc');
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

describe('Japanese locale', () => {
  it('category names come back in Japanese; Vietnamese stays the default', async () => {
    const anon = await t.newClient();
    const ja = await anon.get('/categories?locale=ja');
    expect(ja.status).toBe(200);
    const news = ja.body.items.find((g: { slug: string }) => g.slug === 'tin-tuc');
    expect(news.name).toBe('ニュース');
    const vi = await anon.get('/categories');
    expect(vi.body.items.find((g: { slug: string }) => g.slug === 'tin-tuc').name).toBe('TIN TỨC');
    expect((await anon.get('/categories?locale=fr')).status).toBe(400);
  });

  it('a post shows its Japanese translation when it has one and falls back to Vietnamese (flagged) when it has not', async () => {
    const author = await t.makeUser();
    const p = await insertPublished(t, { authorId: author.id, categoryId: cat, title: 'Bài viết gốc tiếng Việt' });
    const anon = await t.newClient();
    const before = await anon.get(`/posts/${p.slug}?locale=ja`);
    expect(before.status).toBe(200);
    expect(before.body.title).toBe('Bài viết gốc tiếng Việt');
    expect(before.body.translationMissing).toBe(true);

    const admin = await t.makeUser({ role: 'ADMIN', mfa: true });
    const ac = await t.loginAs(admin);
    const put = await ac.put(`/admin/posts/${p.id}/translations/ja`, { title: '日本語のタイトル', excerpt: '概要', contentHtml: '<p>本文です。</p>' });
    expect(put.status).toBe(200);
    const after = await anon.get(`/posts/${p.slug}?locale=ja`);
    expect(after.body.title).toBe('日本語のタイトル');
    expect(after.body.translationMissing).toBe(false);
    expect((await anon.get(`/posts/${p.slug}?locale=en`)).body.translationMissing).toBe(true); // other languages unaffected
    expect((await ac.put(`/admin/posts/${p.id}/translations/fr`, { title: 'x', contentHtml: '' })).status).toBe(404);
  });

  it('the preferred language can be saved to the account', async () => {
    const u = await t.makeUser();
    const c = await t.loginAs(u);
    expect((await c.patch('/me', { locale: 'ja' })).status).toBe(200);
    expect((await c.get('/auth/me')).body.user.locale).toBe('ja');
    expect((await c.patch('/me', { locale: 'fr' })).status).toBe(400);
  });

  it('the assistant answers in Japanese when it has nothing to go on', async () => {
    const anon = await t.newClient();
    const r = await anon.post('/chat', { message: '存在しないトピックについて教えてください', locale: 'ja', history: [] });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('no-results');
    expect(r.body.answer).toMatch(/ウェブサイト/);
  });
});
