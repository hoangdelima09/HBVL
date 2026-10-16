import { expect, test, type Page } from './support/test';
import { mail, uiLogin, users } from './support/helpers';

/** Password step only — stops at the two-factor form. */
async function passwordOnly(page: Page, key: 'mfaMember' | 'admin2', portal: string) {
  const u = users()[key]!;
  await page.goto(portal);
  await page.getByLabel(/Tên đăng nhập hoặc email/).fill(u.username);
  await page
    .getByLabel(/^Mật khẩu/)
    .first()
    .fill(u.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Xác thực hai lớp' })).toBeVisible();
  return u;
}

test.describe.serial('lost authenticator: member asks, administrator decides; administrator recovers by e-mail link', () => {
  test('a member who only typed the password is not signed in anywhere else on the site', async ({ page }) => {
    await passwordOnly(page, 'mfaMember', '/dang-nhap-thanh-vien');
    await page.goto('/tai-khoan');
    await expect(page.getByText('Vui lòng đăng nhập.')).toBeVisible();
  });

  test('MEMBER: e-mailed code → request sent to the administrators', async ({ page }) => {
    const u = await passwordOnly(page, 'mfaMember', '/dang-nhap-thanh-vien');
    await page.getByText('Mất thiết bị xác thực?').click();
    await page.getByTestId('mfa-recovery-send').click();
    const m = await mail.waitFor((x) => x.To.some((a) => a.Address === u.email) && x.Subject.includes('Mã xác nhận yêu cầu gỡ xác thực'));
    const code = /(\d{6})/.exec(m.Subject)![1]!;
    await page.getByTestId('mfa-recovery-code').fill(code);
    await page.getByTestId('mfa-recovery-note').fill('Em đổi điện thoại mới và quên chuyển ứng dụng xác thực.');
    await page.getByTestId('mfa-recovery-submit').click();
    await expect(page.getByTestId('mfa-request-sent')).toContainText('Đã gửi yêu cầu tới quản trị viên');
    // every administrator is e-mailed
    for (const key of ['admin', 'admin2'] as const) {
      await mail.waitFor((x) => x.To.some((a) => a.Address === users()[key]!.email) && x.Subject.includes('Yêu cầu gỡ xác thực 2 lớp'));
    }
  });

  test('ADMIN approves in the admin area; the member is e-mailed and signs in with the password alone', async ({ page, browser }) => {
    const u = users().mfaMember!;
    await uiLogin(page, 'admin');
    await page.goto('/admin');
    await expect(page.getByTestId('stat-Yêu cầu gỡ xác thực')).toHaveText('1');
    await page.goto('/admin/yeu-cau-xac-thuc');
    const item = page.getByTestId('mfa-request').filter({ hasText: u.username });
    await expect(item).toContainText('quên chuyển ứng dụng xác thực');
    await item.getByTestId('mfa-approve').click();
    await page.getByTestId('mfa-decision-note').fill('Đã gọi điện xác minh.');
    await page.getByRole('button', { name: 'Gỡ xác thực', exact: true }).click();
    await expect(page.getByText('Đã gỡ xác thực 2 lớp và gửi email').first()).toBeVisible();

    const told = await mail.waitFor((x) => x.To.some((a) => a.Address === u.email) && x.Subject.includes('Đã gỡ xác thực 2 lớp'));
    expect(await mail.text(told.ID)).toContain('Đã gọi điện xác minh.');

    const member = await (await browser.newContext()).newPage();
    await uiLogin(member, 'mfaMember'); // the helper sees no MFA form now and lands on the account page
    await expect(member.getByRole('heading', { level: 1 })).toContainText('Tài khoản của bạn');
    await member.close();
  });

  test('ADMIN lost the authenticator: an e-mailed link removes it; the admin area asks to enable it again', async ({ page }) => {
    const u = await passwordOnly(page, 'admin2', '/dang-nhap-quan-tri');
    await page.getByText('Mất thiết bị xác thực?').click();
    await page.getByTestId('mfa-send-link').click();
    await expect(page.getByTestId('mfa-link-sent')).toBeVisible();
    const m = await mail.waitFor((x) => x.To.some((a) => a.Address === u.email) && x.Subject.includes('Liên kết gỡ xác thực 2 lớp'));
    const text = await mail.text(m.ID);
    expect(text).not.toMatch(/\b\d{6}\b/); // a link, never a code
    const link = /https?:\/\/\S+\/go-xac-thuc\?token=\S+/.exec(text)![0];

    await page.goto(new URL(link).pathname + new URL(link).search);
    await page.getByTestId('mfa-reset-confirm').click();
    await expect(page.getByTestId('mfa-reset-done')).toBeVisible();
    // the link is single-use
    await page.goto(new URL(link).pathname + new URL(link).search);
    await page.getByTestId('mfa-reset-confirm').click();
    await expect(page.getByTestId('mfa-reset-invalid')).toBeVisible();

    await page.goto('/dang-nhap-quan-tri');
    await page.getByLabel(/Tên đăng nhập hoặc email/).fill(u.username);
    await page
      .getByLabel(/^Mật khẩu/)
      .first()
      .fill(u.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
    await expect(page.getByText('Cần xác thực hai lớp (MFA)')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bật MFA trong Tài khoản' })).toBeVisible();
  });

  test('ADMIN forgot the password: the admin form promises a link, and the e-mail carries a link only', async ({ page }) => {
    const u = users().admin2!;
    await page.goto('/dang-nhap-quan-tri');
    await page.getByRole('link', { name: 'Quên mật khẩu?' }).click();
    await expect(page).toHaveURL(/cong=quan-tri/);
    await page.getByLabel('Email').fill(u.email);
    await page.getByRole('button', { name: 'Gửi liên kết về email' }).click();
    await expect(page.getByTestId('admin-reset-sent')).toBeVisible();
    const m = await mail.waitFor((x) => x.To.some((a) => a.Address === u.email) && x.Subject.includes('Đặt lại mật khẩu quản trị'));
    const text = await mail.text(m.ID);
    expect(m.Subject).not.toMatch(/\d{6}/);
    expect(text).not.toMatch(/\b\d{6}\b/);
    expect(text).toMatch(/dat-lai-mat-khau\?token=\S+&cong=quan-tri/);
  });
});
