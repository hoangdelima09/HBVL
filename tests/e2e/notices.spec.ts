import { expect, test } from './support/test';
import { apiClient, uiLogin, users } from './support/helpers';

const SUBJECT = 'Góp ý về chú giải bản đồ';
const DEFAULT = '123456789';

test.describe.serial('feedback alerts and administrator password reset', () => {
  test('a member sends feedback; the collaborator sees it in the bell, opens it, and the alert disappears', async ({ page, request }) => {
    const member = await apiClient(request, 'memberC');
    const sent = await member.post('/feedback', { subject: SUBJECT, message: 'Nên thêm chú giải màu cho bản đồ.' });
    expect(sent.status()).toBe(201);

    await uiLogin(page, 'ctv');
    await page.goto('/cong-tac-vien');
    const count = page.getByTestId('bell-count');
    await expect(count).toBeVisible();
    const before = Number(await count.innerText());
    await page.getByTestId('bell').click();
    const item = page.getByRole('region', { name: 'Thông báo' }).getByRole('link', { name: new RegExp(SUBJECT) });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(/\/cong-tac-vien\/gop-y\?open=/);
    await expect(page.getByTestId('feedback-message')).toContainText('Nên thêm chú giải màu cho bản đồ.');
    // read ⇒ gone for this person (the list is reloaded from the server)
    await page.goto('/cong-tac-vien');
    await page.getByTestId('bell').click();
    await expect(page.getByRole('region', { name: 'Thông báo' }).getByRole('link', { name: new RegExp(SUBJECT) })).toHaveCount(0);
    if (before > 1) await expect(page.getByTestId('bell-count')).toHaveText(String(before - 1));
    else await expect(page.getByTestId('bell-count')).toHaveCount(0);

    // the administrator still has their own unread alert for it
    const adminApi = await apiClient(await (await import('@playwright/test')).request.newContext(), 'admin');
    const n = await (await adminApi.get('/me/notifications')).json();
    expect(n.items.some((i: { title: string; readAt: string | null }) => i.title.includes(SUBJECT) && i.readAt === null)).toBe(true);
  });

  test('ADMIN resets a member to the default password; the member must choose a new one before using the site', async ({ page, browser }) => {
    const m = users().memberC!;
    await uiLogin(page, 'admin');
    await page.goto('/admin/nguoi-dung');
    await page.getByRole('searchbox').first().fill(m.username);
    const row = page.getByRole('row').filter({ hasText: m.username });
    await row.getByTestId('reset-password').click();
    await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toContainText('123456789');
    await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).last().click();
    await expect(page.getByText(/Đã đặt lại mật khẩu về mặc định/).first()).toBeVisible();
    // no reset button for administrators
    await page.getByRole('searchbox').first().fill('e2e_admin');
    await expect(page.getByRole('row').filter({ hasText: 'e2e_admin' }).getByTestId('reset-password')).toHaveCount(0);

    const person = await (await browser.newContext()).newPage();
    await person.goto('/dang-nhap-thanh-vien');
    await person.getByLabel(/Tên đăng nhập hoặc email/).fill(m.username);
    await person
      .getByLabel(/^Mật khẩu/)
      .first()
      .fill(DEFAULT);
    await person.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
    await expect(person.getByTestId('must-change')).toBeVisible();
    await expect(person.getByText('Bạn cần đổi mật khẩu')).toBeVisible();
    // the rest of the account page is not offered while the change is pending
    await expect(person.getByText('Xác thực hai lớp (TOTP)')).toHaveCount(0);
    await person.getByLabel('Mật khẩu hiện tại').fill(DEFAULT);
    await person.getByLabel(/^Mật khẩu mới/).fill(m.password); // back to the suite's password so later tests can still sign in
    await person.getByLabel('Nhập lại mật khẩu mới').fill(m.password);
    await person.getByRole('button', { name: 'Đổi mật khẩu' }).click();
    await expect(person.getByTestId('must-change')).toHaveCount(0);
    await expect(person.getByRole('heading', { level: 1 })).toContainText('Tài khoản của bạn');
    await person.close();
  });
});
