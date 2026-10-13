import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { watchErrors } from './support/helpers';

// The E2E API runs with an empty GEMINI_API_KEY, so the assistant answers in retrieval-only mode here (the AI path has its own integration test).
test.describe('site assistant (real browser, production build)', () => {
  test('guest asks about a published article: answer + source link, then follows the source', async ({ page }) => {
    const problems = watchErrors(page);
    await page.goto('/');
    await page.getByTestId('chat-open').click();
    const panel = page.getByTestId('chat-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('#chat-input')).toBeFocused();

    await page.locator('#chat-input').fill('Học bổng Đồng Tháp năm nay có gì?');
    await page.keyboard.press('Enter');
    const answer = panel.getByTestId('chat-answer').last();
    await expect(answer).toContainText('Học bổng Đồng Tháp năm nay');
    const source = answer.getByRole('link', { name: 'Học bổng Đồng Tháp năm nay' });
    await expect(source).toHaveAttribute('href', '/bai-viet/hoc-bong-dong-thap-nam-nay');

    const axe = await new AxeBuilder({ page }).include('[data-testid="chat-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    await source.click();
    await expect(page).toHaveURL(/\/bai-viet\/hoc-bong-dong-thap-nam-nay$/);
    expect(problems).toEqual([]);
  });

  test('off-topic question gets a polite "not found"; Escape closes and returns focus; HTML in the question is shown as text', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('chat-open').click();
    await page.locator('#chat-input').fill('<img src=x onerror=window.__xss=1> giá bitcoin hôm nay');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-answer').last()).toContainText('chưa tìm thấy thông tin');
    await expect(page.getByTestId('chat-panel')).toContainText('<img src=x onerror=window.__xss=1>');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-panel')).toHaveCount(0);
    await expect(page.getByTestId('chat-open')).toBeFocused();
  });

  test('English site: UI and fallback message are in English; works at phone width without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/en');
    await page.getByRole('button', { name: 'Open the Q&A assistant' }).click();
    await page.locator('#chat-input').fill('bitcoin price today');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-answer').last()).toContainText("couldn't find this on the website");
    const box = await page.getByTestId('chat-panel').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
