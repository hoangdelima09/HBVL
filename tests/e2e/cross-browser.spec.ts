import { expect, test } from '@playwright/test';
import { uiLogin } from './support/helpers';

// Smoke on Firefox (the primary suite runs on Chromium).
test('public smoke: home, post, search, map', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Vươn Lên');
  await page.goto('/bai-viet/hoc-bong-dong-thap-nam-nay');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Học bổng Đồng Tháp năm nay');
  await page.goto('/tim-kiem?q=dong+thap');
  await expect(page.getByRole('link', { name: 'Học bổng Đồng Tháp năm nay' })).toBeVisible();
  await page.goto('/category/dong-du-ky/ban-do-vuon-len');
  await expect(page.locator('path.map-province')).toHaveCount(34);
  // The bounding-box centre of a concave province can sit over a neighbour, so select it the keyboard way (also the a11y path).
  await page.locator('path[data-province="dong-thap"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('map-members')).toContainText('ĐOÀN TRUNG NHÂN');
});

test('sign-in through the UI and like a post', async ({ page }) => {
  await uiLogin(page, 'memberA', { returnTo: '/bai-viet/hoc-bong-dong-thap-nam-nay' });
  await expect(page.getByTestId('like-button')).toBeVisible();
  const c = page.getByTestId('like-count');
  const before = Number(await c.innerText());
  await page.getByTestId('like-button').click();
  await expect(c).toHaveText(String(before + 1));
  await page.getByTestId('like-button').click();
  await expect(c).toHaveText(String(before));
});
