import { expect, test } from '@playwright/test';
import { apiClient, uiLogin } from './support/helpers';

const POST = '/bai-viet/hoc-bong-dong-thap-nam-nay';
// Counters are shared state: the double-click test gets a post no other test likes, so parallel workers cannot change its number.
const ISOLATED_POST = '/bai-viet/hanh-trinh-quang-ngai';

test.describe('likes (per account, idempotent) and comments', () => {
  test('like → persists across reload and across devices → unlike', async ({ page, browser }) => {
    await uiLogin(page, 'memberA', { returnTo: POST });
    const count = page.getByTestId('like-count');
    const before = Number(await count.innerText());
    await page.getByTestId('like-button').click();
    await expect(count).toHaveText(String(before + 1));
    await page.reload();
    await expect(page.getByTestId('like-button')).toHaveAttribute('aria-pressed', 'true');
    // other device of the same account
    const other = await (await browser.newContext()).newPage();
    await uiLogin(other, 'memberA', { returnTo: POST });
    await expect(other.getByTestId('like-button')).toHaveAttribute('aria-pressed', 'true');
    await other.close();
    await page.getByTestId('like-button').click();
    await expect(count).toHaveText(String(before));
    await expect(page.getByTestId('like-button')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a rapid double click never double-counts', async ({ page }) => {
    await uiLogin(page, 'memberB', { returnTo: ISOLATED_POST });
    // The cached page HTML carries a possibly stale counter; the browser then fetches the per-account state. Always wait for that fetch.
    const freshReload = () => Promise.all([page.waitForResponse((r) => /\/posts\/[^/]+\/engagement/.test(r.url())), page.reload()]);
    await freshReload();
    const count = page.getByTestId('like-count');
    const before = Number(await count.innerText());
    const startedPressed = (await page.getByTestId('like-button').getAttribute('aria-pressed')) === 'true';
    await page.getByTestId('like-button').click({ clickCount: 2, delay: 5 });
    await page.waitForTimeout(800);
    const after = Number(await count.innerText());
    expect([before, before + (startedPressed ? -1 : 1)]).toContain(after); // 2 clicks = toggle twice, never counted twice
    await freshReload();
    const pressed = (await page.getByTestId('like-button').getAttribute('aria-pressed')) === 'true';
    const expected = before + (pressed === startedPressed ? 0 : pressed ? 1 : -1);
    expect(Number(await page.getByTestId('like-count').innerText())).toBe(expected);
  });

  test('comment appears immediately; spam never becomes public; guests cannot comment', async ({ page, browser, request }) => {
    await uiLogin(page, 'memberA', { returnTo: POST });
    const text = `Bình luận E2E ${Date.now().toString(36)}`;
    await page.getByTestId('comment-body').fill(text);
    await page.getByTestId('comment-submit').click();
    // Scope to the published list: a React-controlled <textarea> mirrors its value into its text content, so an unscoped getByText matches the form itself.
    await expect(page.locator('#comments ol').getByText(text)).toBeVisible();
    await page.getByTestId('comment-body').fill('mua ngay http://a.test http://b.test http://c.test http://d.test');
    await page.getByTestId('comment-submit').click();
    await expect(page.getByText('đang chờ kiểm duyệt')).toBeVisible();
    await expect(page.locator('#comments ol').getByText('mua ngay http://a.test')).toHaveCount(0);
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(POST);
    await expect(guest.locator('#comments ol').getByText(text)).toBeVisible();
    await expect(guest.getByText('mua ngay')).toHaveCount(0);
    expect(
      (await request.post('/api/v1/posts/00000000-0000-7000-8000-000000000000/comments', { headers: { origin: 'http://localhost:3200' }, data: { body: 'x' } })).status(),
    ).toBe(403); // no CSRF/session
  });

  test('moderation: collaborator can trash a member comment but not an admin comment', async ({ page, request, browser }) => {
    const post = await (await request.get(`/api/v1/posts/hoc-bong-dong-thap-nam-nay`)).json();
    const admin = await apiClient(request, 'admin');
    const adminCmt = await (await admin.post(`/posts/${post.id}/comments`, { body: 'Bình luận của quản trị viên (được bảo vệ)' })).json();
    const memberApi = await apiClient(request, 'memberB');
    const memCmt = await (await memberApi.post(`/posts/${post.id}/comments`, { body: `Bình luận thành viên cần ẩn ${Date.now()}` })).json();

    await uiLogin(page, 'ctv');
    await page.goto('/cong-tac-vien/binh-luan');
    const row = page.getByRole('row').filter({ hasText: 'Bình luận thành viên cần ẩn' }).first();
    await row.getByRole('button', { name: 'Xóa' }).click();
    await expect(page.getByText('Đã cập nhật bình luận.').first()).toBeVisible();

    const ctvApi = await apiClient(request, 'ctv');
    expect((await ctvApi.patch(`/staff/comments/${adminCmt.id}`, { status: 'TRASHED' })).status()).toBe(403);
    expect((await ctvApi.patch(`/staff/comments/${memCmt.id}`, { status: 'APPROVED' })).status()).toBe(200);
    const member = await (await browser.newContext()).newPage();
    await uiLogin(member, 'memberA');
    await member.goto('/cong-tac-vien/binh-luan');
    await expect(member.getByText('Bạn không có quyền vào khu vực này')).toBeVisible();
    expect((await (await apiClient(request, 'memberA')).patch(`/staff/comments/${memCmt.id}`, { status: 'SPAM' })).status()).toBe(403);
  });
});
