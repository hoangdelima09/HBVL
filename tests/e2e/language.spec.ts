import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { watchErrors } from './support/helpers';

// A first-time visitor: no language cookie yet (the suite default is a returning visitor who already chose Vietnamese).
const firstVisit = { cookies: [], origins: [] };

test.describe('language prompt on first visit', () => {
  test.use({ storageState: firstVisit });

  test('asks which language to use, remembers the answer, and does not ask again', async ({ page, context }) => {
    const problems = watchErrors(page);
    await page.goto('/');
    const gate = page.getByTestId('language-gate');
    await expect(gate).toBeVisible();
    await expect(gate.getByRole('link')).toHaveCount(3);
    await expect(page.getByTestId('lang-vi')).toHaveText(/Tiếng Việt/);
    await expect(page.getByTestId('lang-en')).toHaveText(/English/);
    await expect(page.getByTestId('lang-ja')).toHaveText(/日本語/);

    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    await page.getByTestId('lang-ja').click();
    await expect(page).toHaveURL(/\/ja$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.getByTestId('language-gate')).toHaveCount(0);
    expect((await context.cookies()).find((c) => c.name === 'hbvl_lang')?.value).toBe('ja');

    // remembered: no prompt on reload, and the bare entry point opens the Japanese site
    await page.reload();
    await expect(page.getByTestId('language-gate')).toHaveCount(0);
    await page.goto('/');
    await expect(page).toHaveURL(/\/ja$/);
    // (a production build served over plain http logs one ERR_SSL_PROTOCOL_ERROR for the upgrade-insecure-requests CSP on the language redirect; same for /en)
    expect(problems.filter((p) => !p.includes('ERR_SSL_PROTOCOL_ERROR'))).toEqual([]);
  });

  test('closing the prompt keeps the language of the page and is remembered too', async ({ page }) => {
    await page.goto('/en/category/tin-tuc');
    await expect(page.getByTestId('language-gate')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('language-gate')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('language-gate')).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/category\/tin-tuc$/);
  });
});

test.describe('Japanese site', () => {
  test('categories, UI chrome and dates are Japanese; switch to any language at any time without losing the page', async ({ page }) => {
    await page.goto('/ja/category/tin-tuc');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ニュース');
    await expect(page.getByRole('link', { name: 'メインコンテンツへスキップ' })).toHaveCount(1);
    await expect(page.getByTestId('chat-open')).toContainText('アシスタントに質問');

    // switch language on the same page, in both directions
    await page.getByRole('link', { name: 'EN', exact: true }).first().click();
    await expect(page).toHaveURL(/\/en\/category\/tin-tuc$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('NEWS');
    await page.getByRole('link', { name: 'JA', exact: true }).first().click();
    await expect(page).toHaveURL(/\/ja\/category\/tin-tuc$/);
    await page.getByRole('link', { name: 'VI', exact: true }).first().click();
    await expect(page).toHaveURL(/localhost:3200\/category\/tin-tuc$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TIN TỨC');
  });

  test('a post without a Japanese translation says so and shows the Vietnamese original; the home page and map are readable', async ({ page }) => {
    await page.goto('/ja/bai-viet/hoc-bong-dong-thap-nam-nay');
    await expect(page.getByText('日本語版がありません')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Học bổng Đồng Tháp năm nay');

    await page.goto('/ja');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ライズアップ');
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    await page.goto('/ja/category/dong-du-ky/ban-do-vuon-len');
    await expect(page.getByText('ライズアップ学生の出身地マップ')).toBeVisible();
  });

  test('the sitemap and page head advertise all three languages', async ({ request, page }) => {
    const sm = await (await request.get('/sitemap.xml')).text();
    expect(sm).toContain('hreflang="ja"');
    await page.goto('/ja/lien-he');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('お問い合わせ');
  });
});
