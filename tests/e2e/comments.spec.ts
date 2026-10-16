import { expect, test } from './support/test';
import { uiLogin } from './support/helpers';

const POST = '/bai-viet/hanh-trinh-quang-ngai';
const FIRST = `Bình luận gốc ${Date.now().toString(36)}`;
const EDITED = `${FIRST} — đã sửa lại`;

test.describe.serial('editing and deleting comments (author, guest, staff)', () => {
  test('the author edits a comment; the old text is kept and shown under "đã chỉnh sửa"', async ({ page }) => {
    await uiLogin(page, 'memberB', { returnTo: POST });
    await page.getByTestId('comment-body').fill(FIRST);
    await page.getByTestId('comment-submit').click();
    const item = page.getByTestId('comment').filter({ hasText: FIRST });
    await expect(item).toBeVisible();

    await item.getByTestId('comment-edit').click();
    await item.getByTestId('comment-edit-body').fill(EDITED);
    await item.getByTestId('comment-edit-save').click();
    await expect(page.getByText('Đã lưu chỉnh sửa.').first()).toBeVisible();
    const edited = page.getByTestId('comment').filter({ hasText: EDITED });
    await expect(edited.getByTestId('comment-body-text')).toHaveText(EDITED);
    await expect(edited.getByTestId('comment-edited')).toContainText('đã chỉnh sửa');
  });

  test('a guest sees the current text and can open the earlier version; nobody else gets edit or delete', async ({ page }) => {
    await page.goto(POST);
    const item = page.getByTestId('comment').filter({ hasText: EDITED });
    await expect(item).toBeVisible();
    await expect(item.getByTestId('comment-edit')).toHaveCount(0);
    await expect(item.getByTestId('comment-delete')).toHaveCount(0);
    await item.getByTestId('comment-edited').click();
    await expect(item.getByTestId('comment-history')).toContainText(FIRST);
  });

  test('another member can report but not edit or delete it', async ({ page }) => {
    await uiLogin(page, 'memberA', { returnTo: POST });
    const item = page.getByTestId('comment').filter({ hasText: EDITED });
    await expect(item.getByTestId('report-comment')).toBeVisible();
    await expect(item.getByTestId('comment-edit')).toHaveCount(0);
    await expect(item.getByTestId('comment-delete')).toHaveCount(0);
  });

  test('the author deletes it; it disappears for everyone', async ({ page, browser }) => {
    await uiLogin(page, 'memberB', { returnTo: POST });
    const item = page.getByTestId('comment').filter({ hasText: EDITED });
    await expect(item.getByTestId('report-comment')).toHaveCount(0); // you do not report yourself
    await item.getByTestId('comment-delete').click();
    await page.getByRole('button', { name: 'Xóa', exact: true }).last().click();
    await expect(page.getByText('Đã xóa bình luận.').first()).toBeVisible();
    await expect(page.getByTestId('comment').filter({ hasText: EDITED })).toHaveCount(0);

    const guest = await (await browser.newContext()).newPage();
    await guest.goto(POST);
    await expect(guest.getByText(EDITED)).toHaveCount(0);
    await guest.close();
  });

  test('a collaborator can remove a member comment straight from the page', async ({ page, browser }) => {
    const text = `Bình luận để CTV gỡ ${Date.now().toString(36)}`;
    const member = await (await browser.newContext()).newPage();
    await uiLogin(member, 'memberA', { returnTo: POST });
    await member.getByTestId('comment-body').fill(text);
    await member.getByTestId('comment-submit').click();
    await expect(member.getByTestId('comment').filter({ hasText: text })).toBeVisible();
    await member.close();

    await uiLogin(page, 'ctv', { returnTo: POST });
    await page.goto(POST);
    const item = page.getByTestId('comment').filter({ hasText: text });
    await expect(item.getByTestId('comment-edit')).toHaveCount(0); // staff remove, never rewrite
    await item.getByTestId('comment-delete').click();
    await expect(page.getByRole('dialog')).toContainText('với tư cách người kiểm duyệt');
    await page.getByRole('button', { name: 'Xóa', exact: true }).last().click();
    await expect(page.getByTestId('comment').filter({ hasText: text })).toHaveCount(0);
  });
});
