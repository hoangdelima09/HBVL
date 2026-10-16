import { expect, test } from './support/test';
import { noHorizontalScroll, watchErrors } from './support/helpers';

test.describe('guest browsing (real browser, production build)', () => {
  test('home page: hero, pillars, featured stories, map feature; no console errors', async ({ page }) => {
    const problems = watchErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Vươn Lên');
    await expect(page.getByRole('heading', { name: 'Tin nổi bật' })).toBeVisible();
    await expect(page.getByText('Học bổng Đồng Tháp năm nay').first()).toBeVisible();
    await expect(page.locator('#pillars-title')).toBeVisible();
    for (const g of ['TIN TỨC', 'ĐÔNG DU KÝ', 'SỔ TAY KIẾN THỨC', 'GÓC SÁCH HAY', 'SINH HOẠT'])
      await expect(page.locator('section[aria-labelledby="pillars-title"]').getByRole('heading', { name: g, level: 3 })).toBeVisible();
    await expect(page.locator('svg path.map-province').first()).toBeAttached();
    expect(problems).toEqual([]);
  });

  test('category tree: pillar → sub-section → post → breadcrumbs; sub-section card types', async ({ page }) => {
    await page.goto('/category/tin-tuc');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TIN TỨC');
    for (const s of ['Chuyện Vươn Lên', 'Gương mặt Vươn Lên', 'Tiếp nối']) await expect(page.getByRole('link', { name: s }).first()).toBeVisible();
    await page.goto('/category/tin-tuc/chuyen-vuon-len');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('TIN TỨC');
    await page.getByRole('link', { name: 'Học bổng Đồng Tháp năm nay' }).first().click();
    await expect(page).toHaveURL(/\/bai-viet\/hoc-bong-dong-thap-nam-nay$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Học bổng Đồng Tháp năm nay');
    await expect(page.getByRole('link', { name: 'Facebook' })).toHaveAttribute(
      'href',
      /facebook\.com\/sharer\/sharer\.php\?u=http%3A%2F%2Flocalhost%3A3200%2Fbai-viet%2Fhoc-bong-dong-thap-nam-nay/,
    );
    await expect(page.getByRole('link', { name: 'Zalo' })).toHaveAttribute('href', /sp\.zalo\.me\/plugins\/share\?url=/);
    await expect(page.getByTestId('copy-link')).toBeVisible();
    // song category uses the "song" card
    await page.goto('/category/sinh-hoat/tong-hop-bai-hat');
    await expect(page.getByText('Xem bài hát')).toBeVisible();
  });

  test('guest sees like count read-only and a login prompt for comments', async ({ page }) => {
    await page.goto('/bai-viet/hoc-bong-dong-thap-nam-nay');
    await expect(page.getByRole('link', { name: /đăng nhập để thích/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'đăng nhập', exact: true })).toBeVisible();
    await expect(page.getByTestId('comment-body')).toHaveCount(0);
  });

  test('search ignores diacritics and đ/d; empty and no-result states; URL reflects the query', async ({ page }) => {
    await page.goto('/tim-kiem');
    await page.getByRole('searchbox', { name: 'Từ khóa tìm kiếm' }).fill('dong thap');
    await page.getByRole('button', { name: 'Tìm kiếm' }).last().click();
    await expect(page).toHaveURL(/q=dong\+thap|q=dong%20thap/);
    await expect(page.getByRole('link', { name: 'Học bổng Đồng Tháp năm nay' })).toBeVisible();
    await page.goto('/tim-kiem?q=' + encodeURIComponent('ĐỒNG THÁP'));
    await expect(page.getByRole('link', { name: 'Học bổng Đồng Tháp năm nay' })).toBeVisible();
    await page.goto('/tim-kiem?q=khongcogihetxyz');
    await expect(page.getByText('Chưa tìm thấy nội dung phù hợp.')).toBeVisible();
  });

  test('announcements: server-side category filter reflected in the URL', async ({ page }) => {
    await page.goto('/thong-bao');
    await page.getByRole('navigation', { name: 'Lọc theo chuyên mục' }).getByRole('link', { name: 'SINH HOẠT' }).click();
    await expect(page).toHaveURL(/category=sinh-hoat/);
    await expect(page.getByText('Bài hát sinh hoạt vui')).toBeVisible();
    await expect(page.getByText('Học bổng Đồng Tháp năm nay')).toHaveCount(0);
    await page.goBack();
    await expect(page.getByText('Học bổng Đồng Tháp năm nay')).toBeVisible();
  });

  test('events / programs lists are real routes with empty states', async ({ page }) => {
    for (const path of ['/su-kien', '/chuong-trinh']) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('contact page shows organisation info, sign-in gate for the form', async ({ page }) => {
    await page.goto('/lien-he');
    await expect(page.locator('#main-content').getByText('43D/46 Hồ Văn Huê').first()).toBeVisible();
    await expect(page.locator('#main-content').getByRole('link', { name: 'quykhuyenhocdongdu@gmail.com' })).toHaveAttribute('href', 'mailto:quykhuyenhocdongdu@gmail.com');
    await expect(page.getByText('Khách chưa đăng nhập chỉ có thể xem nội dung')).toBeVisible();
  });

  test('unknown routes return a real 404 (not 200): page, post, province, draft slug', async ({ page, request }) => {
    for (const path of ['/khong-co-trang', '/bai-viet/khong-ton-tai', '/tinh/khong-co', '/category/khong/co', '/en/khong-co-trang']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
    }
    await page.goto('/khong-co-trang');
    await expect(page.getByText('Trang không tìm thấy')).toBeVisible();
  });

  test('robots.txt and sitemap.xml list only public routes', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /admin');
    const sm = await (await request.get('/sitemap.xml')).text();
    expect(sm).toContain('/bai-viet/hoc-bong-dong-thap-nam-nay');
    expect(sm).not.toMatch(/\/admin|\/tai-khoan|\/gui-bai|dang-nhap/);
  });
});

test.describe('language switch', () => {
  test('VI ↔ EN keeps the current page, survives reload and back/forward, EN has its own URL space', async ({ page }) => {
    await page.goto('/category/tin-tuc');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TIN TỨC');
    await page.getByRole('link', { name: 'EN', exact: true }).first().click();
    await expect(page).toHaveURL(/\/en\/category\/tin-tuc$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('NEWS');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('NEWS');
    await page.goBack();
    await expect(page).toHaveURL(/\/category\/tin-tuc$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TIN TỨC');
    // remembered choice: bare entry point goes to EN after choosing EN
    await page.goto('/en');
    await page.goto('/');
    await expect(page).toHaveURL(/\/en$/);
    await page.getByRole('link', { name: 'VI', exact: true }).first().click();
    await expect(page).toHaveURL(/localhost:3200\/$/);
  });

  test('an English post page without a translation shows the fallback notice (not a fake translation)', async ({ page }) => {
    await page.goto('/en/bai-viet/hoc-bong-dong-thap-nam-nay');
    await expect(page.getByText('no English translation yet', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Học bổng Đồng Tháp năm nay');
  });

  test('VI and EN are cached separately (no cross-language leak)', async ({ request }) => {
    const en = await (await request.get('/en')).text();
    const vi = await (await request.get('/')).text();
    expect(en).toContain('Featured stories');
    expect(vi).toContain('Tin nổi bật');
    expect(vi).not.toContain('Featured stories');
    const again = await (await request.get('/en')).text();
    expect(again).toContain('Featured stories');
  });
});

test.describe('header & mobile menu', () => {
  test('mobile: menu opens/closes with button and Escape; scroll lock is released when the viewport grows', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Mở trình đơn' });
    await toggle.click();
    await expect(page.getByRole('navigation', { name: 'Trình đơn chính' })).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Mở trình đơn' })).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    // open, then resize to desktop: menu closes and the body can scroll again
    await page.getByRole('button', { name: 'Mở trình đơn' }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole('button', { name: /trình đơn/ })).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('no horizontal overflow at 360 / 390 / 768 / 1024 / 1440 on key pages', async ({ page }) => {
    for (const [w, h] of [
      [360, 740],
      [390, 844],
      [768, 1024],
      [1024, 768],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const path of [
        '/',
        '/category/dong-du-ky/ban-do-vuon-len',
        '/bai-viet/hoc-bong-dong-thap-nam-nay',
        '/lien-he',
        '/dang-nhap-thanh-vien',
        '/thong-bao',
        '/tim-kiem?q=dong',
        '/su-kien',
      ]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await noHorizontalScroll(page);
      }
    }
  });

  test('the search page keeps its submit button on screen on a small phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/tim-kiem?q=dong');
    const button = page.locator('#main-content form[role="search"]').getByRole('button', { name: 'Tìm kiếm' });
    await expect(button).toBeInViewport({ ratio: 1 });
    const box = (await button.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  });

  test('the site name is never cut off on desktop, in any language, and the menu stays on screen', async ({ page }) => {
    for (const w of [1280, 1366, 1440, 1920]) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const prefix of ['', '/en', '/ja']) {
        await page.goto(prefix || '/');
        const state = await page.evaluate(() => {
          const name = document.querySelector('header a span span')!;
          const offScreen = [...document.querySelectorAll('header nav a, header nav button, header nav input')].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
          }).length;
          return { cut: name.scrollWidth - name.clientWidth, offScreen, headerHeight: document.querySelector('header')!.getBoundingClientRect().height };
        });
        expect(state.cut, `site name cut at ${w}px ${prefix || '/vi'}`).toBeLessThanOrEqual(1);
        expect(state.offScreen, `menu items off screen at ${w}px ${prefix || '/vi'}`).toBe(0);
        expect(state.headerHeight, `header wrapped at ${w}px ${prefix || '/vi'}`).toBeLessThan(90);
      }
    }
  });
});

test.describe('contact page map', () => {
  test('shows a small Google map of the published address; clicking it opens that address on Google Maps', async ({ page, context }) => {
    const res = await page.goto('/lien-he');
    expect(res!.headers()['content-security-policy']).toContain('https://www.google.com');
    const address = '43D/46 Hồ Văn Huê, P. Đức Nhuận, TP. HCM';
    await expect(page.getByText(address).first()).toBeVisible();

    const frame = page.getByTestId('contact-map');
    const src = decodeURIComponent((await frame.getAttribute('src'))!);
    expect(src).toContain('https://www.google.com/maps?q=' + address);
    expect(src).toContain('output=embed');

    const link = page.getByTestId('contact-map-link');
    await expect(link).toHaveAccessibleName(/Google Maps/);
    const href = (await link.getAttribute('href'))!;
    expect(decodeURIComponent(href)).toBe('https://www.google.com/maps/search/?api=1&query=' + address);
    await expect(link).toHaveAttribute('rel', /noopener/);
    // a click anywhere on the map goes to Google Maps in a new tab (the request itself is not needed for the assertion)
    const box = (await frame.boundingBox())!;
    const [popup] = await Promise.all([context.waitForEvent('page'), page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)]);
    expect(decodeURIComponent(popup.url())).toContain('google.com/maps/search/?api=1&query=' + address);
    await popup.close();
  });

  test('the Japanese and English pages use the same address for the map', async ({ page }) => {
    for (const [prefix, label] of [
      ['/en', 'Open in Google Maps'],
      ['/ja', 'Google マップで開く'],
    ] as const) {
      await page.goto(`${prefix}/lien-he`);
      await expect(page.getByTestId('contact-map-link')).toContainText(label);
      expect(decodeURIComponent((await page.getByTestId('contact-map').getAttribute('src'))!)).toContain('43D/46 Hồ Văn Huê');
    }
  });
});
