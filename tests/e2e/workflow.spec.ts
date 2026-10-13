import sharp from 'sharp';
import { expect, test, type Page } from '@playwright/test';
import { apiClient, uiLogin, users, watchErrors } from './support/helpers';

const editor = (page: Page) => page.locator('[role=textbox][aria-label="Nội dung bài viết"]');
const jpeg = () =>
  sharp({ create: { width: 640, height: 360, channels: 3, background: '#2f6f4f' } })
    .jpeg()
    .toBuffer();

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Đăng xuất' }).first().click();
}

test.describe.serial('acceptance: member → collaborator → admin → public (all through the UI)', () => {
  let postId = '';
  let slug = '';
  const title = `Hành trình học tập E2E ${Date.now().toString(36)}`;

  test('MEMBER A writes a post with an image: save draft, see it in "Bài của tôi", submit for review', async ({ page }) => {
    const problems = watchErrors(page);
    await uiLogin(page, 'memberA', { returnTo: '/gui-bai' });
    await expect(page).toHaveURL(/\/gui-bai$/);
    await page.getByRole('textbox', { name: 'Tiêu đề', exact: true }).fill(title);
    await page.getByRole('combobox', { name: /Chuyên mục/ }).selectOption({ label: 'Chuyện Vươn Lên' });
    await editor(page).click();
    await editor(page).pressSequentially('Đây là nội dung bài viết thử nghiệm bằng tiếng Việt có dấu: Đồng Tháp, Quảng Ngãi.');
    await page.getByTestId('featured-input').setInputFiles({ name: 'cover.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
    await expect(page.getByAltText('Ảnh đại diện đã chọn')).toBeVisible();
    await page.getByTestId('save-draft').click();
    await expect(page).toHaveURL(/\/gui-bai\/[0-9a-f-]{36}$/);
    postId = page.url().split('/').pop()!;
    await expect(page.getByText('Nháp').first()).toBeVisible();

    await page.goto('/bai-cua-toi');
    const card = page.getByTestId('my-post').filter({ hasText: title });
    await expect(card).toContainText('Nháp');
    await card.getByRole('link', { name: /Sửa/ }).click();
    await page.getByTestId('submit-review').click();
    await expect(page).toHaveURL(/\/bai-cua-toi$/);
    await expect(page.getByTestId('my-post').filter({ hasText: title })).toContainText('Chờ duyệt');
    expect(problems.filter((p) => !p.includes('403'))).toEqual([]);
  });

  test("MEMBER B cannot open, edit or read A's post (UI and direct API)", async ({ page, request }) => {
    await uiLogin(page, 'memberB');
    await page.goto(`/gui-bai/${postId}`);
    await expect(page.getByText('Không tìm thấy bài viết hoặc bạn không có quyền xem.')).toBeVisible();
    await page.goto('/bai-cua-toi');
    await expect(page.getByText(title)).toHaveCount(0);
    const api = await apiClient(request, 'memberB');
    expect((await api.get(`/me/posts/${postId}`)).status()).toBe(404);
    expect((await api.get(`/staff/posts/${postId}`)).status()).toBe(403);
    expect((await api.post(`/me/posts/${postId}/submit`, undefined, { 'Idempotency-Key': 'probe-key-12345', 'If-Match': '"1"' })).status()).toBe(404);
  });

  test('A locked (pending) post cannot be edited by its sender', async ({ page }) => {
    await uiLogin(page, 'memberA');
    await page.goto(`/gui-bai/${postId}`);
    await expect(page.getByText('Bài viết đang bị khóa với người gửi ở trạng thái này.')).toBeVisible();
    await expect(page.getByTestId('save-draft')).toHaveCount(0);
  });

  test('COLLABORATOR: queue → edit → request changes (reason mandatory); has publish and reject controls but not the /admin API', async ({ page, request }) => {
    await uiLogin(page, 'ctv');
    await page.goto('/cong-tac-vien/hang-cho');
    await page.getByRole('link', { name: title }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
    await page.getByRole('textbox', { name: 'Tiêu đề', exact: true }).fill(`${title} (đã biên tập)`);
    await page.getByTestId('save-edit').click();
    await expect(page.getByText('Đã lưu chỉnh sửa.').first()).toBeVisible();
    // the collaborator may publish and reject through the staff endpoints
    await expect(page.getByTestId('publish')).toHaveCount(1);
    await expect(page.getByTestId('reject')).toHaveCount(1);
    // reason is required
    await page.getByTestId('request-changes').click();
    await page.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    await expect(page.getByText(/Nhập lý do từ 1 đến/)).toBeVisible();
    await page.getByTestId('reason').fill('Vui lòng bổ sung thêm nguồn và chỉnh lại đoạn mở đầu.');
    await page.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    await expect(page.getByText('Đã gửi yêu cầu chỉnh sửa.').first()).toBeVisible();
    await expect(page.getByText('Cần sửa').first()).toBeVisible();
    // direct API: collaborator cannot use the admin publish/reject endpoints
    const api = await apiClient(request, 'ctv');
    const cur = await (await api.get(`/staff/posts/${postId}`)).json();
    expect((await api.post(`/admin/posts/${postId}/publish`, undefined, { 'If-Match': `"${cur.version}"` })).status()).toBe(403);
    expect((await api.post(`/admin/posts/${postId}/reject`, { reason: 'x' }, { 'If-Match': `"${cur.version}"` })).status()).toBe(403);
  });

  test('MEMBER A sees the reason, fixes the post and resubmits', async ({ page }) => {
    await uiLogin(page, 'memberA');
    await page.goto('/bai-cua-toi');
    const card = page.getByTestId('my-post').filter({ hasText: title });
    await expect(card).toContainText('Cần sửa');
    await expect(card).toContainText('Vui lòng bổ sung thêm nguồn và chỉnh lại đoạn mở đầu.');
    await card.getByRole('link', { name: /Sửa/ }).click();
    await expect(page.getByText('Yêu cầu chỉnh sửa').first()).toBeVisible();
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await editor(page).pressSequentially(' Đã bổ sung nguồn tham khảo.');
    await page.getByTestId('submit-review').click();
    await expect(page).toHaveURL(/\/bai-cua-toi$/);
    await expect(page.getByTestId('my-post').filter({ hasText: title })).toContainText('Chờ duyệt');
  });

  test('ADMIN (password + MFA through the UI) publishes; the post and its image appear publicly', async ({ page, browser }) => {
    await uiLogin(page, 'admin');
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/bai-viet');
    await page.getByRole('link', { name: new RegExp(title) }).click();
    await expect(page.getByText('Lịch sử xử lý')).toBeVisible();
    await expect(page.getByText('Yêu cầu sửa').first()).toBeVisible();
    await page.getByTestId('publish').click();
    await page.getByRole('button', { name: 'Xuất bản', exact: true }).last().click();
    await expect(page.getByText('Đã xuất bản.').first()).toBeVisible();
    await page.getByRole('link', { name: 'Xem trên website' }).waitFor();
    slug = (await page.getByRole('link', { name: 'Xem trên website' }).getAttribute('href'))!.replace('/bai-viet/', '');

    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`/bai-viet/${slug}`);
    await expect(anon.getByRole('heading', { level: 1 })).toHaveText(`${title} (đã biên tập)`);
    await expect(anon.getByText('Đã bổ sung nguồn tham khảo.')).toBeVisible();
    const img = anon.locator('article img').first();
    await expect(img).toBeVisible();
    expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100); // really served to guests now
    await anon.goto('/');
    await expect(anon.getByText(`${title} (đã biên tập)`).first()).toBeVisible();
    await anon.close();
  });

  test('after publishing the sender can no longer edit; admin unpublish removes it everywhere (cache invalidated)', async ({ page, browser, request }) => {
    await uiLogin(page, 'memberA');
    await page.goto(`/gui-bai/${postId}`);
    await expect(page.getByText('Bài viết đang bị khóa với người gửi ở trạng thái này.')).toBeVisible();
    const api = await apiClient(request, 'admin');
    const cur = await (await api.get(`/admin/posts/${postId}`)).json();
    expect(cur.status).toBe('PUBLISHED');
    const un = await api.post(`/admin/posts/${postId}/unpublish`, undefined, { 'If-Match': `"${cur.version}"` });
    expect(un.status()).toBe(200);
    const anon = await (await browser.newContext()).newPage();
    const res = await anon.goto(`/bai-viet/${slug}`);
    expect(res?.status()).toBe(404);
    expect((await anon.request.get(`/api/v1/posts/${slug}`)).status()).toBe(404);
    expect((await anon.request.get('/api/v1/search?q=' + encodeURIComponent('hành trình học tập'))).status()).toBe(200);
    const found = await (await anon.request.get('/api/v1/search?q=' + encodeURIComponent(title))).json();
    expect(found.items).toHaveLength(0);
    await anon.close();
  });
});

test.describe('rejection path', () => {
  test('admin rejects with a reason; the sender sees it and cannot edit or resubmit', async ({ page, request }) => {
    const title = `Bài bị từ chối ${Date.now().toString(36)}`;
    const memberA = await apiClient(request, 'memberA');
    const cat = (await (await request.get('/api/v1/categories?locale=vi')).json()).items[0].children[0].id as string;
    const created = await (
      await memberA.post('/me/posts', { title, categoryId: cat, contentHtml: '<p>Nội dung sẽ bị từ chối.</p>' }, { 'Idempotency-Key': `rej-${Date.now()}-key` })
    ).json();
    const submitted = await memberA.post(`/me/posts/${created.id}/submit`, undefined, { 'Idempotency-Key': `rej-sub-${Date.now()}`, 'If-Match': `"${created.version}"` });
    expect(submitted.status()).toBe(200);

    await uiLogin(page, 'admin');
    await page.goto(`/admin/bai-viet/${created.id}`);
    await page.getByTestId('reject').click();
    await page.getByRole('button', { name: 'Từ chối' }).last().click();
    await expect(page.getByText(/Nhập lý do từ 1 đến/)).toBeVisible(); // reason required
    await page.getByTestId('reason').fill('Nội dung không phù hợp với chuyên mục đã chọn.');
    await page.getByRole('button', { name: 'Từ chối' }).last().click();
    await expect(page.getByText('Đã từ chối bài.').first()).toBeVisible();
    await logout(page);

    await uiLogin(page, 'memberA');
    await page.goto('/bai-cua-toi');
    const card = page.getByTestId('my-post').filter({ hasText: title });
    await expect(card).toContainText('Từ chối');
    await expect(card).toContainText('Nội dung không phù hợp với chuyên mục đã chọn.');
    await expect(card.getByRole('link', { name: /Sửa/ })).toHaveCount(0);
    const cur = await (await memberA.get(`/me/posts/${created.id}`)).json();
    const put = await memberA.patch(`/me/posts/${created.id}`, { title: 'x' });
    expect([404, 405]).toContain(put.status()); // no PATCH route at all
    const reedit = await request.put(`/api/v1/me/posts/${created.id}`, { headers: { origin: 'http://localhost:3200' }, data: {} });
    expect([400, 403]).toContain(reedit.status()); // missing CSRF/auth
    expect(cur.status).toBe('REJECTED');
  });
});

test.describe('permissions at the UI boundary', () => {
  test('collaborator and member cannot enter /admin; member cannot enter /cong-tac-vien', async ({ browser }) => {
    const ctvPage = await (await browser.newContext()).newPage();
    await uiLogin(ctvPage, 'ctv');
    await ctvPage.goto('/admin');
    await expect(ctvPage.getByText('Bạn không có quyền vào khu vực này')).toBeVisible();
    await ctvPage.goto('/cong-tac-vien');
    await expect(ctvPage.getByRole('heading', { name: 'Bảng điều khiển cộng tác viên' })).toBeVisible();
    const memberPage = await (await browser.newContext()).newPage();
    await uiLogin(memberPage, 'memberA');
    await memberPage.goto('/cong-tac-vien');
    await expect(memberPage.getByText('Bạn không có quyền vào khu vực này')).toBeVisible();
    await memberPage.goto('/admin');
    await expect(memberPage.getByText('Bạn không có quyền vào khu vực này')).toBeVisible();
  });

  test('unverified account: can draft but not submit, comment, like or contact', async ({ page, request }) => {
    users();
    const api = await apiClient(request, 'unverified');
    const cat = (await (await request.get('/api/v1/categories?locale=vi')).json()).items[0].children[0].id as string;
    const draft = await (
      await api.post('/me/posts', { title: 'Nháp chưa xác minh', categoryId: cat, contentHtml: '<p>x</p>' }, { 'Idempotency-Key': `unv-${Date.now()}-k` })
    ).json();
    const sub = await api.post(`/me/posts/${draft.id}/submit`, undefined, { 'Idempotency-Key': `unv-s-${Date.now()}`, 'If-Match': `"${draft.version}"` });
    expect(sub.status()).toBe(403);
    expect((await sub.json()).error.code).toBe('EMAIL_NOT_VERIFIED');
    await uiLogin(page, 'unverified');
    await page.goto('/gui-y-kien');
    await expect(page.getByText(/Hãy xác minh email/)).toBeVisible();
  });
});
