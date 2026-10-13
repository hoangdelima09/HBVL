import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { ports } from './support/env';

const repo = resolve(__dirname, '../..');

/**
 * E2E runs the PRODUCTION build (API + worker + Next) against an isolated database (`hbvl_e2e`), Redis db 6, bucket `hbvl-e2e`
 * and the shared local Mailpit. Build first:  pnpm build   (the config does not rebuild).
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './support/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: resolve(repo, 'playwright-report'), open: 'never' }]],
  outputDir: resolve(repo, 'test-results'),
  use: {
    baseURL: `http://localhost:${ports.web}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    // The site asks for a language on the first visit (no `hbvl_lang` cookie). Tests start as a returning visitor who already chose Vietnamese;
    // the language prompt itself is covered in language.spec.ts with an empty storage state.
    storageState: { cookies: [{ name: 'hbvl_lang', value: 'vi', domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] },
  },
  projects: [
    { name: 'chromium', testIgnore: /a11y|cross-browser/, use: { ...devices['Desktop Chrome'] } },
    { name: 'a11y', testMatch: /a11y\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-smoke', testMatch: /cross-browser\.spec\.ts/, use: { ...devices['Desktop Firefox'] } },
  ],
});
