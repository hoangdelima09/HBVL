// Screenshot helper: node e2e/shots.mjs <outDir> — captures key pages at 390/768/1024/1440 for visual review.
import { chromium } from '@playwright/test';
import sharp from 'sharp';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const out = process.argv[2] ?? '../docs/screenshots';
const pages = [
  ['home', '/'],
  ['map', '/category/dong-du-ky/ban-do-vuon-len'],
  ['category', '/category/tin-tuc'],
  ['login', '/dang-nhap-thanh-vien'],
  ['contact', '/lien-he'],
  ['post', '/bai-viet/tai-thu-1'],
  ['province', '/tinh/dong-thap'],
  ['search', '/tim-kiem?q=hoc+bong'],
  ['home-en', '/en'],
];
const sizes = [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
];
const browser = await chromium.launch();
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200));
  });
  for (const [name, path] of pages) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(600);
    // WebP keeps the committed screenshots small (full-page PNGs are ~600 KB each).
    await sharp(await page.screenshot({ fullPage: true }))
      .webp({ quality: 78 })
      .toFile(`${out}/${name}-${w}.webp`);
    console.log('shot', name, w);
  }
  await ctx.close();
}
await browser.close();
