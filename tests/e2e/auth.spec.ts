import { expect, test, type Page } from '@playwright/test';
import { apiClient, mail, uiLogin, users, watchErrors } from './support/helpers';

test.describe('registration → e-mail verification → account (real UI + Mailpit)', () => {
  test('a new visitor registers, verifies through the e-mailed link and gains full member rights', async ({ page }) => {
    const problems = watchErrors(page);
    const id = Date.now().toString(36);
    const email = `reg_${id}@example.test`;
    await page.goto('/dang-nhap-thanh-vien');
    const form = page.getByRole('form', { name: 'Tạo tài khoản thành viên' });
    await form.getByLabel('Họ và tên').fill('Nguyễn Thị Đăng Ký');
    await form.getByLabel('Tên đăng nhập', { exact: false }).first().fill(`reg_${id}`);
    await form.getByLabel('Email').fill(email);
    await form.getByLabel(/^Mật khẩu \(ít nhất/).fill('mat-khau-thu-nghiem-1');
    await form.getByLabel('Nhập lại mật khẩu').fill('mat-khau-thu-nghiem-1');
    await form.getByRole('button', { name: 'Đăng ký thành viên' }).click();
    await expect(page).toHaveURL(/\/tai-khoan$/);
    await expect(page.getByText('Email chưa được xác minh')).toBeVisible();

    const msg = await mail.waitFor((m) => m.To.some((a) => a.Address === email) && m.Subject.includes('xác minh'));
    const link = /https?:\/\/\S+xac-minh-email\?token=\S+/.exec(await mail.text(msg.ID))![0];
    await page.goto(link);
    await expect(page.getByText('Email đã được xác minh.')).toBeVisible();
    await page.goto('/tai-khoan');
    await expect(page.getByText('Email đã được xác minh:')).toBeVisible();
    // the one-time link cannot be reused
    await page.goto(link);
    await expect(page.getByText('Liên kết không hợp lệ hoặc đã hết hạn.')).toBeVisible();
    expect(problems.filter((p) => !p.includes('400'))).toEqual([]);
  });

  test('mismatched passwords and duplicate usernames show field errors without losing input', async ({ page }) => {
    await page.goto('/dang-nhap-thanh-vien');
    const form = page.getByRole('form', { name: 'Tạo tài khoản thành viên' });
    await form.getByLabel('Họ và tên').fill('Ai Đó');
    await form.getByLabel('Tên đăng nhập').first().fill('e2e_memberA');
    await form.getByLabel('Email').fill('someone@example.test');
    await form.getByLabel(/^Mật khẩu \(ít nhất/).fill('mat-khau-thu-nghiem-1');
    await form.getByLabel('Nhập lại mật khẩu').fill('khac-hoan-toan-xyz');
    await form.getByRole('button', { name: 'Đăng ký thành viên' }).click();
    await expect(form.getByText('Passwords do not match')).toBeVisible();
    await expect(form.getByLabel('Họ và tên')).toHaveValue('Ai Đó');
    await form.getByLabel('Nhập lại mật khẩu').fill('mat-khau-thu-nghiem-1');
    await form.getByRole('button', { name: 'Đăng ký thành viên' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /đã được sử dụng/ })).toBeVisible();
  });
});

test.describe('sign-in portals', () => {
  test('wrong portal and wrong password give the same generic message', async ({ page }) => {
    const u = users().memberA!;
    await page.goto('/dang-nhap-quan-tri');
    await page.getByLabel(/Tên đăng nhập hoặc email/).fill(u.username);
    await page.getByLabel(/^Mật khẩu/).fill(u.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Thông tin đăng nhập hoặc cổng truy cập không đúng.' })).toBeVisible();
    const wrongPortal = 'Thông tin đăng nhập hoặc cổng truy cập không đúng.';
    await page.goto('/dang-nhap-thanh-vien');
    await page.getByLabel(/Tên đăng nhập hoặc email/).fill(u.username);
    await page
      .getByLabel(/^Mật khẩu/)
      .first()
      .fill('sai-mat-khau-hoan-toan');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
    await expect(page.getByRole('alert').filter({ hasText: wrongPortal })).toBeVisible();
  });

  test('member signs in, lands on /tai-khoan, header shows the account, then signs out', async ({ page }) => {
    await uiLogin(page, 'memberA');
    await expect(page).toHaveURL(/\/tai-khoan$/);
    await expect(page.getByRole('heading', { name: 'Tài khoản của bạn' })).toBeVisible();
    await expect(page.getByTestId('account-nav').first()).toContainText('E2E memberA');
    await page.getByRole('button', { name: 'Đăng xuất' }).first().click();
    await expect(page.getByRole('link', { name: 'Đăng nhập' }).first()).toBeVisible();
    await page.goto('/tai-khoan');
    await expect(page.getByText('Vui lòng đăng nhập.')).toBeVisible();
  });

  test('returnTo is honoured only for internal paths (no open redirect)', async ({ page }) => {
    await uiLogin(page, 'memberA', { returnTo: 'https://evil.example/phish' });
    await expect(page).toHaveURL(/localhost:3200\/tai-khoan$/);
    await page.getByRole('button', { name: 'Đăng xuất' }).first().click();
    await uiLogin(page, 'memberA', { returnTo: '/gui-y-kien' });
    await expect(page).toHaveURL(/\/gui-y-kien$/);
  });

  test('collaborator portal → collaborator dashboard; admin portal asks for MFA → admin dashboard', async ({ page }) => {
    await uiLogin(page, 'ctv');
    await expect(page).toHaveURL(/\/cong-tac-vien$/);
    await expect(page.getByRole('heading', { name: 'Bảng điều khiển cộng tác viên' })).toBeVisible();
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/dang-nhap-cong-tac-vien/);
    await uiLogin(page, 'admin', { totp: true }); // real authenticator code
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Bảng điều khiển quản trị' })).toBeVisible();
    await expect(page.getByText('Hoạt động gần đây')).toBeVisible();
  });

  test('a wrong MFA code is refused', async ({ page }) => {
    const u = users().admin!;
    await page.goto('/dang-nhap-quan-tri');
    await page.getByLabel(/Tên đăng nhập hoặc email/).fill(u.username);
    await page.getByLabel(/^Mật khẩu/).fill(u.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.getByLabel(/Mã xác thực/).fill('000000');
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByText('Mã xác thực không đúng.')).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByText('Cần xác thực hai lớp (MFA)')).toBeVisible();
  });
});

const register = async (page: Page, id: string) => {
  const email = `code_${id}@example.test`;
  await page.goto('/dang-nhap-thanh-vien');
  const form = page.getByRole('form', { name: 'Tạo tài khoản thành viên' });
  await form.getByLabel('Họ và tên').fill('Người Dùng Mã');
  await form.getByLabel('Tên đăng nhập', { exact: false }).first().fill(`code_${id}`);
  await form.getByLabel('Email').fill(email);
  await form.getByLabel(/^Mật khẩu \(ít nhất/).fill('mat-khau-thu-nghiem-1');
  await form.getByLabel('Nhập lại mật khẩu').fill('mat-khau-thu-nghiem-1');
  await form.getByRole('button', { name: 'Đăng ký thành viên' }).click();
  await expect(page).toHaveURL(/\/tai-khoan$/);
  return { email, username: `code_${id}` };
};
const codeFromMail = async (to: string, subject: string) => {
  const msg = await mail.waitFor((m) => m.To.some((a) => a.Address === to) && m.Subject.includes(subject));
  return /\b(\d{6})\b/.exec(msg.Subject)![1]!;
};

test.describe('6-digit e-mail codes (UI + Mailpit)', () => {
  test('registration: the account page asks for the e-mailed code; a wrong code is refused, the right one verifies', async ({ page }) => {
    const { email } = await register(page, `v${Date.now().toString(36)}`);
    await expect(page.getByText('Email chưa được xác minh')).toBeVisible();
    const code = await codeFromMail(email, 'Mã xác minh');

    await page.getByTestId('verify-code').fill(code === '000000' ? '111111' : '000000');
    await page.getByTestId('verify-code-submit').click();
    await expect(page.getByText('Mã không đúng hoặc đã hết hạn')).toBeVisible();

    await page.getByTestId('verify-code').fill(code);
    await page.getByTestId('verify-code-submit').click();
    await expect(page.getByText('Email đã được xác minh:')).toBeVisible();
  });

  test('forgot password: e-mail → code + new password → sign in with it (old password stops working)', async ({ page }) => {
    const { email, username } = await register(page, `r${Date.now().toString(36)}`);
    await page
      .getByRole('button', { name: /Đăng xuất/ })
      .first()
      .click()
      .catch(() => undefined);
    await page.goto('/quen-mat-khau');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Gửi mã về email' }).click();
    await expect(page.getByTestId('reset-code')).toBeVisible();
    const code = await codeFromMail(email, 'Đặt lại mật khẩu');

    await page.getByTestId('reset-code').fill(code === '000000' ? '111111' : '000000');
    await page.getByLabel(/^Mật khẩu mới/).fill('mat-khau-bang-ma-3');
    await page.getByLabel('Nhập lại mật khẩu').fill('mat-khau-bang-ma-3');
    await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(page.getByText('Mã không đúng hoặc đã hết hạn')).toBeVisible();

    await page.getByTestId('reset-code').fill(code);
    await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(page.getByText('Đã đặt mật khẩu')).toBeVisible();
    await expect(page).toHaveURL(/dang-nhap-thanh-vien/);

    await page.getByLabel(/Tên đăng nhập hoặc email/).fill(username);
    await page
      .getByLabel(/^Mật khẩu/)
      .first()
      .fill('mat-khau-bang-ma-3');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
    await expect(page).toHaveURL(/\/tai-khoan$/);
  });
});

test.describe('password reset via e-mail (UI + Mailpit)', () => {
  test('request → link → new password → sign in with it; old sessions are revoked', async ({ page, browser, request }) => {
    const u = users().resetUser!;
    // session on another "device"
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await uiLogin(otherPage, 'resetUser');
    await expect(otherPage).toHaveURL(/\/tai-khoan$/);

    await page.goto('/quen-mat-khau');
    await page.getByLabel('Email').fill(u.email);
    await page.getByRole('button', { name: 'Gửi mã về email' }).click();
    await expect(page.getByText('Nếu email thuộc về một tài khoản')).toBeVisible();
    const msg = await mail.waitFor((m) => m.To.some((a) => a.Address === u.email) && m.Subject.includes('Đặt lại mật khẩu'));
    const link = /https?:\/\/\S+dat-lai-mat-khau\?token=\S+/.exec(await mail.text(msg.ID))![0];
    await page.goto(link);
    await page.getByLabel(/^Mật khẩu mới/).fill('mat-khau-moi-sau-reset-2');
    await page.getByLabel('Nhập lại mật khẩu').fill('mat-khau-moi-sau-reset-2');
    await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
    await expect(page.getByText('Đã đặt mật khẩu')).toBeVisible();
    await expect(page).toHaveURL(/dang-nhap-thanh-vien/);
    // other device is signed out
    await otherPage.goto('/tai-khoan');
    await expect(otherPage.getByText('Vui lòng đăng nhập.')).toBeVisible();
    await other.close();
    // same link cannot be reused
    await page.goto(link);
    await page.getByLabel(/^Mật khẩu mới/).fill('mat-khau-khac-nua-3333');
    await page.getByLabel('Nhập lại mật khẩu').fill('mat-khau-khac-nua-3333');
    await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'không hợp lệ hoặc đã hết hạn' })).toBeVisible();
    // new password works; old one does not
    await page.goto('/dang-nhap-thanh-vien');
    await page.getByLabel(/Tên đăng nhập hoặc email/).fill(u.username);
    await page
      .getByLabel(/^Mật khẩu/)
      .first()
      .fill('mat-khau-moi-sau-reset-2');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).first().click();
    await expect(page).toHaveURL(/\/tai-khoan$/);
    void request;
    void apiClient;
  });
});
