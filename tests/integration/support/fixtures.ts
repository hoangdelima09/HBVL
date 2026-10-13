import { foldVietnamese } from '@hbvl/contracts';
import type { Client, TestApp } from './app';

export async function categoryId(t: TestApp, slug: string): Promise<string> {
  const r = await t.admin.query(`SELECT id FROM categories WHERE slug = $1`, [slug]);
  if (!r.rows[0]) throw new Error(`category ${slug} not seeded`);
  return r.rows[0].id as string;
}

let seq = 0;
export const key = () => `test-key-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

export const draftBody = (categoryId: string, over: Record<string, unknown> = {}) => ({
  title: 'Hành trình vươn lên của em',
  categoryId,
  contentHtml: '<p>Nội dung bài viết thử nghiệm với tiếng Việt có dấu và C:\\notes\\new.</p>',
  ...over,
});

/** Creates a DRAFT as `c`, returns the post JSON (with version). */
export async function createDraft(c: Client, categoryId: string, over: Record<string, unknown> = {}) {
  const res = await c.post('/me/posts', draftBody(categoryId, over), { 'Idempotency-Key': key() });
  if (res.status !== 201) throw new Error(`createDraft failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; version: number; status: string };
}

export async function submit(c: Client, id: string, version: number, k = key()) {
  return c.post(`/me/posts/${id}/submit`, undefined, { 'Idempotency-Key': k, 'If-Match': `"${version}"` });
}

/** Inserts an already-PUBLISHED post directly (fast path for tests that are not about the workflow). */
export async function insertPublished(t: TestApp, opts: { authorId: string; categoryId: string; title?: string; slug?: string; legacyLikes?: number; commentsOpen?: boolean }) {
  const title = opts.title ?? 'Bài đã xuất bản';
  const slug = opts.slug ?? `bai-${Math.random().toString(36).slice(2, 10)}`;
  const r = await t.admin.query(
    `INSERT INTO posts (id, kind, slug, "authorId", status, title, "contentHtml", "contentText", "searchText", "publishedAt", "legacyLikeCount", "commentsOpen", "updatedAt")
     VALUES (gen_random_uuid(), 'POST', $1, $2, 'PUBLISHED', $3, '<p>Nội dung</p>', 'Nội dung', $4, now() - interval '1 minute', $5, $6, now()) RETURNING id`,
    [slug, opts.authorId, title, foldVietnamese(title), opts.legacyLikes ?? 0, opts.commentsOpen ?? true],
  );
  const id = r.rows[0].id as string;
  await t.admin.query(`INSERT INTO post_categories ("postId", "categoryId", "isPrimary") VALUES ($1, $2, true)`, [id, opts.categoryId]);
  return { id, slug };
}
