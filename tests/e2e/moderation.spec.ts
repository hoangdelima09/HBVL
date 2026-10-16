import { expect, test } from './support/test';
import { apiClient, uiLogin, watchErrors } from './support/helpers';

const POST = '/bai-viet/bai-hat-sinh-hoat-vui';
const COMMENT = 'Bình luận thô lỗ dùng cho kiểm thử tố cáo';

test.describe.serial('comment reports and member moderation (member → collaborator → admin, through the UI)', () => {
  test('MEMBER C writes a comment; MEMBER A reports it from the page', async ({ page, browser }) => {
    await uiLogin(page, 'memberC', { returnTo: POST });
    await page.getByTestId('comment-body').fill(COMMENT);
    await page.getByTestId('comment-submit').click();
    await expect(page.getByText(COMMENT)).toBeVisible();

    const other = await (await browser.newContext()).newPage();
    const problems = watchErrors(other);
    await uiLogin(other, 'memberA', { returnTo: POST });
    const item = other.locator('li', { hasText: COMMENT });
    await item.getByTestId('report-comment').click();
    await expect(other.getByRole('dialog')).toBeVisible();
    await other.getByTestId('report-reason-ABUSE').check();
    await other.getByTestId('report-note').fill('Lời lẽ xúc phạm.');
    await other.getByTestId('report-submit').click();
    await expect(other.getByText(/Đã gửi tố cáo/).first()).toBeVisible();
    // reporting again is harmless
    await item.getByTestId('report-comment').click();
    await other.getByTestId('report-submit').click();
    await expect(other.getByText(/Đã gửi tố cáo/).first()).toBeVisible();
    expect(problems.filter((p) => !p.includes('400'))).toEqual([]);
    await other.close();
  });

  test('COLLABORATOR sees an alert in the bell and in the queue, claims it, and the administrator sees who is on it', async ({ page, browser }) => {
    await uiLogin(page, 'ctv');
    await page.goto('/cong-tac-vien');
    await expect(page.getByTestId('stat-Bình luận bị tố cáo')).toHaveText('1');
    await expect(page.getByTestId('bell-count')).toBeVisible();
    await page.getByTestId('bell').click();
    await expect(page.getByRole('region', { name: 'Thông báo' })).toContainText('Bình luận bị tố cáo');

    await page.goto('/cong-tac-vien/to-cao');
    const item = page.getByTestId('report-item').filter({ hasText: COMMENT });
    await expect(item).toContainText('Xúc phạm, quấy rối');
    await item.getByTestId('claim').click();
    await expect(item).toContainText('Đang xử lý: E2E ctv');

    // the administrator opens the same item and sees it is taken
    const adminPage = await (await browser.newContext()).newPage();
    await uiLogin(adminPage, 'admin');
    await adminPage.goto('/admin/to-cao');
    await expect(adminPage.getByTestId('report-item').filter({ hasText: COMMENT })).toContainText('Đang xử lý: E2E ctv');
    await adminPage.close();
  });

  test('COLLABORATOR removes the comment and restricts the author; the author sees why and cannot comment', async ({ page, browser }) => {
    await uiLogin(page, 'ctv');
    await page.goto('/cong-tac-vien/to-cao');
    const item = page.getByTestId('report-item').filter({ hasText: COMMENT });
    await item.getByTestId('remove-restrict').click();
    await page.getByTestId('resolve-note').fill('Phát ngôn xúc phạm người khác.');
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByText('Đã xử lý tố cáo.').first()).toBeVisible();
    await expect(page.getByTestId('report-item').filter({ hasText: COMMENT })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Đã xử lý' }).click();
    await expect(page.getByTestId('report-item').filter({ hasText: COMMENT })).toContainText('Gỡ bình luận + hạn chế tài khoản');

    const author = await (await browser.newContext()).newPage();
    await uiLogin(author, 'memberC', { returnTo: '/tai-khoan' });
    await expect(author.getByText('Tài khoản của bạn đang bị hạn chế tương tác')).toBeVisible();
    await expect(author.getByText('Phát ngôn xúc phạm người khác.').first()).toBeVisible();
    await author.goto(POST);
    await expect(author.getByText(COMMENT)).toHaveCount(0); // removed from the site
    await expect(author.getByTestId('comment-body')).toHaveCount(0); // the form is replaced by the notice
    await expect(author.getByText('Tài khoản của bạn đang bị hạn chế tương tác')).toBeVisible();
    await author.close();
  });

  test('COLLABORATOR lifts the restriction from the members screen; the author can comment again', async ({ page, browser }) => {
    await uiLogin(page, 'ctv');
    await page.goto('/cong-tac-vien/thanh-vien');
    await page.getByRole('searchbox').fill('e2e_memberC');
    const row = page.getByRole('row').filter({ hasText: 'e2e_memberC' });
    await expect(row).toContainText('Hạn chế');
    await row.getByRole('button', { name: 'Bỏ hạn chế' }).click();
    await expect(page.getByText('Đã bỏ hạn chế.').first()).toBeVisible();

    const author = await (await browser.newContext()).newPage();
    await uiLogin(author, 'memberC', { returnTo: POST });
    await expect(author.getByTestId('comment-body')).toBeVisible();
    await author.close();
  });

  test('COLLABORATOR deletes a published post of a member, but does not see an administrator’s', async ({ page, request, playwright }) => {
    const member = await apiClient(request, 'memberA');
    const key = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cats = await (await member.get('/categories')).json();
    const categoryId = cats.items[0].children[0].id as string;
    const created = await (
      await member.post('/me/posts', { title: 'Bài sẽ bị cộng tác viên xóa', categoryId, contentHtml: '<p>Nội dung ngắn.</p>' }, { 'Idempotency-Key': key() })
    ).json();
    const submitted = await (await member.post(`/me/posts/${created.id}/submit`, undefined, { 'Idempotency-Key': key(), 'If-Match': `"${created.version}"` })).json();
    const ctv = await apiClient(request, 'ctv');
    expect((await ctv.post(`/staff/posts/${created.id}/publish`, undefined, { 'If-Match': `"${submitted.version}"` })).status()).toBe(200);

    await uiLogin(page, 'ctv');
    await page.goto('/cong-tac-vien/bai-viet');
    await page.getByRole('link', { name: 'Bài sẽ bị cộng tác viên xóa' }).click();
    await page.getByRole('button', { name: 'Xóa bài' }).click();
    await page.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(page.getByText('Đã xóa.').first()).toBeVisible();
    await expect(page).toHaveURL(/\/cong-tac-vien\/bai-viet$/);

    // administrator-owned content is invisible to the collaborator
    const admin = await apiClient(await playwright.request.newContext(), 'admin'); // its own cookie jar: the collaborator session must stay
    const adminPost = await (await admin.post('/me/posts', { title: 'Bài của quản trị viên', categoryId, contentHtml: '<p>Nội dung.</p>' }, { 'Idempotency-Key': key() })).json();
    const adminSub = await (await admin.post(`/me/posts/${adminPost.id}/submit`, undefined, { 'Idempotency-Key': key(), 'If-Match': `"${adminPost.version}"` })).json();
    expect((await ctv.get(`/staff/posts/${adminPost.id}`)).status()).toBe(404);
    expect((await ctv.post(`/staff/posts/${adminPost.id}/publish`, undefined, { 'If-Match': `"${adminSub.version}"` })).status()).toBe(404);
  });
});
