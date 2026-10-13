import { expect, test } from '@playwright/test';
import { apiClient, mail, uiLogin } from './support/helpers';

test.describe('feedback inbox: member → collaborator + admin only', () => {
  const subject = `Góp ý E2E ${Date.now().toString(36)}`;
  const message = "Nội dung góp ý có dấu, O'Reilly và đường dẫn C:\\notes\\new.";

  test('member sends feedback; text is stored verbatim; cooldown blocks an immediate second send', async ({ page }) => {
    await uiLogin(page, 'memberA');
    await page.goto('/dong-gop-y-kien'); // legacy alias
    await expect(page).toHaveURL(/\/gui-y-kien$/);
    await page.getByLabel('Tiêu đề').fill(subject);
    await page.getByLabel('Nội dung ý kiến').fill(message);
    await page.getByRole('button', { name: 'Gửi cho ban biên tập' }).click();
    await expect(page.getByText('Ý kiến đã được gửi thành công.')).toBeVisible();
    await page.getByLabel('Tiêu đề').fill('Gửi ngay lần hai');
    await page.getByLabel('Nội dung ý kiến').fill('Nội dung lần hai');
    await page.getByRole('button', { name: 'Gửi cho ban biên tập' }).click();
    await expect(page.getByText('Vui lòng đợi một phút trước khi gửi ý kiến tiếp theo.')).toBeVisible();
    await expect(page.getByLabel('Nội dung ý kiến')).toHaveValue('Nội dung lần hai'); // input kept on failure
  });

  test('collaborator reads it, adds an internal note and a status; the sender text is unchanged', async ({ page }) => {
    await uiLogin(page, 'ctv');
    await page.goto('/cong-tac-vien/gop-y');
    await page.getByRole('button', { name: subject }).click();
    await expect(page.getByTestId('feedback-message')).toHaveText(message);
    await page.getByLabel('Trạng thái xử lý').selectOption('IN_PROGRESS');
    await page.getByLabel(/Ghi chú nội bộ/).fill('Đã chuyển cho nhóm kỹ thuật.');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã cập nhật.').first()).toBeVisible();
    await page.getByRole('button', { name: subject }).click();
    await expect(page.getByTestId('feedback-message')).toHaveText(message);
    await expect(page.getByText(/Đang xử lý — Đã chuyển cho nhóm kỹ thuật./)).toBeVisible();
  });

  test('members and guests cannot read the inbox (UI and API); the member never sees /cong-tac-vien/gop-y', async ({ page, request, browser }) => {
    const member = await apiClient(request, 'memberB');
    for (const path of ['/staff/feedback', '/staff/feedback/counts']) expect((await member.get(path)).status()).toBe(403);
    const ctx = await browser.newContext();
    expect((await (await browser.newContext()).request.get('/api/v1/staff/feedback')).status()).toBe(401);
    const p = await ctx.newPage();
    await uiLogin(p, 'memberB');
    await p.goto('/cong-tac-vien/gop-y');
    await expect(p.getByText('Bạn không có quyền vào khu vực này')).toBeVisible();
    void page;
  });
});

test.describe('contact inbox: member → admin only; e-mail is a notification, not the record', () => {
  const subject = `Liên hệ E2E ${Date.now().toString(36)}`;
  let receipt = '';

  test('member sends a message: stored first, receipt shown, Mailpit receives the notification via the worker', async ({ page }) => {
    await uiLogin(page, 'memberB');
    await page.goto('/lien-he');
    await page.getByLabel(/^Họ và tên/).fill('Trần Thị Liên Hệ');
    await page.getByLabel('Tiêu đề').fill(subject);
    await page.getByLabel(/^Nội dung/).fill('Tôi muốn biết thêm về học bổng. Đồng Tháp.');
    await page.getByRole('button', { name: 'Gửi tin nhắn' }).click();
    await expect(page.getByText('Đã tiếp nhận tin nhắn!')).toBeVisible();
    receipt = (await page.getByTestId('receipt-code').innerText()).trim();
    expect(receipt).toMatch(/^LH-\d{4}-\d{6}$/);
    const msg = await mail.waitFor((m) => m.Subject.includes(receipt));
    expect(msg.To[0]!.Address).toBe(process.env.CONTACT_INBOX_EMAIL ?? 'quykhuyenhocdongdu@gmail.com');
    // a second send right away is refused but keeps the text
    await page.goto('/lien-he');
    await page.getByLabel(/^Nội dung/).fill('Tin thứ hai');
    await page.getByRole('button', { name: 'Gửi tin nhắn' }).click();
    await expect(page.getByText('Vui lòng đợi một phút trước khi gửi tiếp.')).toBeVisible();
    await expect(page.getByLabel(/^Nội dung/)).toHaveValue('Tin thứ hai');
  });

  test('admin sees it with the honest mail state, can mark it processed; collaborator cannot read it', async ({ page, browser, request }) => {
    await uiLogin(page, 'admin');
    await page.goto('/admin/lien-he');
    await page.getByRole('button', { name: receipt }).click();
    await expect(page.getByTestId('contact-message')).toContainText('Tôi muốn biết thêm về học bổng.');
    await expect(page.getByText('Máy chủ mail đã nhận').first()).toBeVisible(); // SMTP accepted — never "Đã giao"
    await expect(page.getByText('Đã giao', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Trả lời qua email' })).toHaveAttribute('href', /^mailto:/);
    await page.getByRole('button', { name: 'Đánh dấu đã xử lý' }).click();
    await expect(page.getByText('Đã cập nhật.').first()).toBeVisible();

    const ctv = await apiClient(request, 'ctv');
    expect((await ctv.get('/admin/contact')).status()).toBe(403);
    const memberApi = await apiClient(request, 'memberA');
    expect((await memberApi.get('/admin/contact')).status()).toBe(403);
    const cp = await (await browser.newContext()).newPage();
    await uiLogin(cp, 'ctv');
    await cp.goto('/admin/lien-he');
    await expect(cp.getByText('Bạn không có quyền vào khu vực này')).toBeVisible();
  });
});
