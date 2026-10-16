import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { apiLogin } from './support/helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = bad.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} — ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
  expect(summary, `${name}: serious/critical accessibility violations`).toEqual([]);
}

test.describe('WCAG 2.2 AA (axe) — public pages, desktop and mobile', () => {
  const pages: [string, string][] = [
    ['home', '/'],
    ['category', '/category/tin-tuc'],
    ['sub-category (song cards)', '/category/sinh-hoat/tong-hop-bai-hat'],
    ['post', '/bai-viet/hoc-bong-dong-thap-nam-nay'],
    ['map', '/category/dong-du-ky/ban-do-vuon-len'],
    ['province', '/tinh/dong-thap'],
    ['search', '/tim-kiem?q=dong+thap'],
    ['contact', '/lien-he'],
    ['member login', '/dang-nhap-thanh-vien'],
    ['announcements', '/thong-bao'],
    ['english home', '/en'],
    ['japanese home', '/ja'],
    ['japanese map', '/ja/category/dong-du-ky/ban-do-vuon-len'],
    ['404', '/khong-co-trang'],
  ];
  for (const [name, path] of pages) {
    test(`${name} (1440px)`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      await audit(page, name);
    });
  }
  for (const [name, path] of pages.slice(0, 6)) {
    test(`${name} (390px)`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await audit(page, `${name} mobile`);
    });
  }
  test('map with a selected province (dialog-free keyboard flow)', async ({ page }) => {
    await page.goto('/category/dong-du-ky/ban-do-vuon-len');
    const da = page.locator('path[data-province="dong-thap"]');
    await da.focus();
    await page.keyboard.press('Enter');
    await expect(da).toHaveAttribute('aria-pressed', 'true');
    await audit(page, 'map selected');
  });
  test('mobile menu open', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Mở trình đơn' }).click();
    await audit(page, 'mobile menu');
  });
});

test.describe('WCAG 2.2 AA — authenticated areas', () => {
  test('admin dashboard, posts list and CTV queue', async ({ page, context }) => {
    await page.goto('/');
    await apiLogin(context, 'admin');
    for (const path of ['/admin', '/admin/bai-viet', '/admin/nguoi-dung', '/admin/cai-dat', '/admin/to-cao']) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      await audit(page, path);
    }
  });
  test('collaborator: posts, reports and members screens', async ({ page, context }) => {
    await page.goto('/');
    await apiLogin(context, 'ctv');
    for (const path of ['/cong-tac-vien', '/cong-tac-vien/bai-viet', '/cong-tac-vien/to-cao', '/cong-tac-vien/thanh-vien']) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      await audit(page, path);
    }
  });
  test('member account and editor', async ({ page, context }) => {
    await page.goto('/');
    await apiLogin(context, 'memberA');
    for (const path of ['/tai-khoan', '/gui-bai', '/bai-cua-toi', '/gui-y-kien']) {
      await page.goto(path);
      await audit(page, path);
    }
  });
});
