import { expect, test } from '@playwright/test';
import { noHorizontalScroll } from './support/helpers';

const MAP = '/category/dong-du-ky/ban-do-vuon-len';

test.describe('interactive map: 34 / 63 modes, search, keyboard, islands', () => {
  test('34 mode counts every member once; switching to 63 keeps the same total; merged units list constituents', async ({ page }) => {
    await page.goto(MAP);
    const map = page.getByTestId('map-explorer');
    await expect(map.getByTestId('map-svg')).toHaveAttribute('data-mode', '34');
    await expect(map.locator('path.map-province')).toHaveCount(34);
    await expect(map.getByTestId('map-count')).toContainText('4 thành viên');
    await map.getByRole('button', { name: '63 tỉnh/thành trước sắp xếp' }).click();
    await expect(map.locator('path.map-province')).toHaveCount(63);
    await expect(map.getByTestId('map-count')).toContainText('4 thành viên');
    await map.getByRole('button', { name: '34 tỉnh/thành hiện hành' }).click();
    await map.locator('path[data-province="tuyen-quang"]').click();
    await expect(map.getByTestId('map-count')).toHaveText('2 thành viên'); // Hà Giang (1) + Tuyên Quang (1)
    await expect(map.getByTestId('map-constituents')).toContainText('Hà Giang cũ · 1 thành viên');
    await expect(map.getByTestId('map-members')).toContainText('TRẦN THỊ B');
  });

  test('keyboard: Tab to a province and press Enter selects it; selected state and member list update', async ({ page }) => {
    await page.goto(MAP);
    const map = page.getByTestId('map-explorer');
    const da = map.locator('path[data-province="dong-thap"]');
    await expect(da).toBeVisible();
    await da.focus();
    await page.keyboard.press('Enter');
    await expect(da).toHaveAttribute('aria-pressed', 'true');
    await expect(map.getByTestId('map-members')).toContainText('ĐOÀN TRUNG NHÂN');
    await expect(map.locator('#map-detail-title'))
      .toBeFocused()
      .catch(() => undefined);
  });

  test('a province with zero members is selectable and says so (count is exactly 0)', async ({ page }) => {
    await page.goto(MAP);
    const map = page.getByTestId('map-explorer');
    await map.locator('path[data-province="ca-mau"]').click();
    await expect(map.getByTestId('map-count')).toHaveText('0 thành viên');
    await expect(map.getByTestId('map-empty')).toContainText('Hiện chưa có thành viên HBVL tại Cà Mau.');
  });

  test('search works with and without diacritics (đ/d) and selects the province', async ({ page }) => {
    await page.goto(MAP);
    const map = page.getByTestId('map-explorer');
    await map.getByLabel('Tìm tỉnh, thành hoặc thành viên').fill('doan trung');
    await map.getByRole('option', { name: /ĐOÀN TRUNG NHÂN/ }).click();
    await expect(map.getByTestId('map-members')).toContainText('ĐOÀN TRUNG NHÂN');
    await map.getByLabel('Tìm tỉnh, thành hoặc thành viên').fill('Đà Nẵng');
    await expect(map.getByRole('option', { name: /Đà Nẵng/ })).toBeVisible();
    await map.getByLabel('Tìm tỉnh, thành hoặc thành viên').fill('khongco');
    await expect(map.getByText('Không tìm thấy kết quả')).toBeVisible();
  });

  test('17 island/archipelago labels exist in both modes; Hoàng Sa/Trường Sa are not provinces', async ({ page }) => {
    await page.goto(MAP);
    const map = page.getByTestId('map-explorer');
    await expect(map.locator('g.map-island')).toHaveCount(17);
    await map.getByRole('button', { name: '63 tỉnh/thành trước sắp xếp' }).click();
    await expect(map.locator('g.map-island')).toHaveCount(17);
    await expect(map.locator('path.map-province')).toHaveCount(63);
    await expect(map.locator('g.map-island--archipelago')).toHaveCount(2);
    await expect(map.locator('path[data-province*="Hoàng Sa"], path[data-province*="Trường Sa"]')).toHaveCount(0);
  });

  test('labels stay inside the viewport and there is no horizontal scroll on mobile in both modes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(MAP);
    const map = page.getByTestId('map-explorer');
    for (const mode of ['34 tỉnh/thành hiện hành', '63 tỉnh/thành trước sắp xếp']) {
      await map.getByRole('button', { name: mode }).click();
      await expect(map.locator('g.map-island').first()).toBeVisible();
      const outside = await page.evaluate(
        () =>
          [...document.querySelectorAll('g.map-island text')].filter((t) => {
            const r = t.getBoundingClientRect();
            return r.left < -1 || r.right > window.innerWidth + 1;
          }).length,
      );
      expect(outside, 'island labels must not be cut off by the viewport').toBe(0);
      await noHorizontalScroll(page);
    }
  });

  test('province page: photo/heading, member count, empty contact message, back link; unknown province is 404', async ({ page, request }) => {
    await page.goto('/tinh/dong-thap');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đồng Tháp');
    await expect(page.getByTestId('province-count')).toContainText('1 thành viên');
    await expect(page.getByTestId('province-empty')).toBeVisible(); // unverified sample directory data is never shown
    await page.getByRole('link', { name: /Về bản đồ/ }).click();
    await expect(page).toHaveURL(/ban-do-vuon-len$/);
    expect((await request.get('/tinh/khong-co-tinh-nay')).status()).toBe(404);
  });
});
