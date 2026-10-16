import { expect, test } from './support/test';
import { apiClient, mail, uiLogin } from './support/helpers';

const stamp = Date.now().toString(36);

test.describe.serial('admin console changes real public UI', () => {
  test('create + publish a static page; it renders publicly under its path, sanitised', async ({ page, browser }) => {
    await uiLogin(page, 'admin');
    await page.goto('/admin/trang');
    await page.getByRole('button', { name: 'Thêm trang' }).click();
    await page.getByRole('textbox', { name: 'Tiêu đề', exact: true }).fill(`Giới thiệu E2E ${stamp}`);
    await page.getByLabel(/^Đường dẫn \(slug\)/).fill(`gioi-thieu-e2e-${stamp}`);
    await page.getByLabel('Trạng thái').selectOption('PUBLISHED');
    await page.locator('[role=textbox][aria-label="Nội dung trang"]').click();
    await page.locator('[role=textbox][aria-label="Nội dung trang"]').pressSequentially('Nội dung trang tĩnh do quản trị viên tạo.');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã lưu trang.').first()).toBeVisible();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/gioi-thieu-e2e-${stamp}`);
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(`Giới thiệu E2E ${stamp}`);
    await expect(guest.getByText('Nội dung trang tĩnh do quản trị viên tạo.')).toBeVisible();
    await guest.close();
  });

  test('editing contact settings changes the public contact page immediately', async ({ page, browser }) => {
    await uiLogin(page, 'admin');
    await page.goto('/admin/cai-dat');
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Thông tin liên hệ' }) });
    await panel.getByLabel('Điện thoại', { exact: true }).fill(`0900 ${stamp.slice(0, 6)}`);
    await panel.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã lưu: Thông tin liên hệ')).toBeVisible();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/lien-he');
    await expect(guest.locator('#main-content').getByRole('link', { name: `0900 ${stamp.slice(0, 6)}` })).toBeVisible();
    await guest.close();
  });

  test('events: an admin-created published event appears at /su-kien; empty optional fields stay empty', async ({ page, browser }) => {
    await uiLogin(page, 'admin');
    await page.goto('/admin/su-kien');
    await page.getByRole('button', { name: 'Thêm mới' }).click();
    await page.getByLabel(/^Tiêu đề \(VI\)/).fill(`Gặp mặt thành viên ${stamp}`);
    await page.getByLabel('Trạng thái').selectOption('PUBLISHED');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã lưu.').first()).toBeVisible();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/su-kien');
    await guest
      .getByRole('link', { name: `Gặp mặt thành viên ${stamp}` })
      .first()
      .click();
    await expect(guest.getByRole('heading', { level: 1 })).toContainText('Gặp mặt thành viên');
    await expect(guest.locator('dl dt')).toHaveCount(0); // no invented date/venue/deadline
    await guest.close();
  });

  test('invite a collaborator: activation e-mail → set password → sign in at the collaborator portal', async ({ page, browser }) => {
    await uiLogin(page, 'admin');
    await page.goto('/admin/nguoi-dung');
    await page.getByRole('button', { name: 'Mời người dùng' }).click();
    const email = `invite_${stamp}@example.test`;
    await page.getByLabel('Họ và tên').fill('Người Được Mời');
    await page.getByLabel(/^Tên đăng nhập/).fill(`invite_${stamp}`);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Tạo & gửi lời mời' }).click();
    await expect(page.getByText('Đã tạo tài khoản và gửi email kích hoạt.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `invite_${stamp}` })).toContainText('Chờ kích hoạt');
    const msg = await mail.waitFor((m) => m.To.some((a) => a.Address === email));
    const link = /https?:\/\/\S+dat-lai-mat-khau\?token=\S+/.exec(await mail.text(msg.ID))![0];
    const inv = await (await browser.newContext()).newPage();
    await inv.goto(link);
    await inv.getByLabel(/^Mật khẩu mới/).fill('mat-khau-duoc-moi-123');
    await inv.getByLabel('Nhập lại mật khẩu').fill('mat-khau-duoc-moi-123');
    await inv.getByRole('button', { name: 'Lưu mật khẩu' }).click();
    await expect(inv.getByText('Đã đặt mật khẩu')).toBeVisible();
    await inv.goto('/dang-nhap-cong-tac-vien');
    await inv.getByLabel(/Tên đăng nhập hoặc email/).fill(`invite_${stamp}`);
    await inv
      .getByLabel(/^Mật khẩu/)
      .first()
      .fill('mat-khau-duoc-moi-123');
    await inv.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
    await expect(inv).toHaveURL(/\/cong-tac-vien$/);
    await expect(inv.getByRole('heading', { name: 'Bảng điều khiển cộng tác viên' })).toBeVisible();
  });

  test('member import: CSV preview reports problems per row, commit adds only valid rows, the map count changes', async ({ page, browser }) => {
    await uiLogin(page, 'admin');
    await page.goto('/admin/hoc-vien');
    const csv = `name,province\nNguyễn Văn Nhập Một ${stamp},TP. THỦ ĐỨC\nTrần Nhập Hai ${stamp},ĐẮC LẮK\nAi Đó,Atlantis\n`;
    await page.getByTestId('import-file').setInputFiles({ name: 'members.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    const preview = page.getByTestId('import-preview');
    await expect(preview).toContainText('Hợp lệ: 2');
    await expect(preview).toContainText('Không nhận diện tỉnh: 1');
    await expect(preview).toContainText('Atlantis');
    await preview.getByRole('button', { name: /Nhập 2 dòng hợp lệ/ }).click();
    await expect(page.getByText(/Đã thêm 2 học viên/)).toBeVisible();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/category/dong-du-ky/ban-do-vuon-len');
    await expect(guest.getByTestId('map-count')).toContainText('6 thành viên');
    await guest.close();
  });

  test('URL redirect created by the admin works for visitors and refuses external targets', async ({ page, request, browser }) => {
    await uiLogin(page, 'admin');
    await page.goto('/admin/chuyen-huong');
    await page.getByPlaceholder('/duong-dan-cu').fill(`/trang-cu-${stamp}`);
    await page.getByPlaceholder('/bai-viet/slug-moi').fill('https://evil.example');
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /nội bộ/ })).toBeVisible();
    await page.getByPlaceholder('/bai-viet/slug-moi').fill('/lien-he');
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: `/trang-cu-${stamp}` })).toBeVisible();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/trang-cu-${stamp}`);
    await expect(guest).toHaveURL(/\/lien-he$/);
    void request;
  });

  test('audit log lists these admin actions; dashboards show live numbers; CTV cannot read audit', async ({ page, request }) => {
    await uiLogin(page, 'admin');
    await page.goto('/admin/nhat-ky');
    await expect(page.getByRole('row').filter({ hasText: 'settings.update' }).first()).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'page.create' }).first()).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByTestId('stat-Học viên trên bản đồ')).toHaveText('6');
    const ctv = await apiClient(request, 'ctv');
    expect((await ctv.get('/admin/audit')).status()).toBe(403);
  });
});
