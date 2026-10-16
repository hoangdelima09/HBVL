import { test as base } from '@playwright/test';

export * from '@playwright/test';

/**
 * The contact page embeds a Google map. Tests must not depend on google.com being reachable or fast, so every request to Google's map hosts
 * from the test's own browser context is answered locally. (Contexts a test opens by hand are not stubbed; the page adds the frame only after
 * its own `load`, so those are not held up either.)
 */
export const test = base.extend<{ stubGoogleMaps: void }>({
  stubGoogleMaps: [
    async ({ context }, use) => {
      await context.route(/^https:\/\/(www\.google\.com|maps\.google\.com|maps\.gstatic\.com|maps\.googleapis\.com)\//, (r) =>
        r.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html lang="vi"><title>Google Maps (stub)</title><body><main><h1>Map</h1></main></body></html>',
        }),
      );
      await use();
    },
    { auto: true },
  ],
});
