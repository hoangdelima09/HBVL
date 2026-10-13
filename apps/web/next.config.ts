import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';

// Dev/test: pick up the repo-root .env (Next only reads the app directory). In production variables come from the environment.
const rootEnv = new URL('../../.env', import.meta.url).pathname;
if (process.env.NODE_ENV !== 'production' && existsSync(rootEnv)) loadDotenv({ path: rootEnv, quiet: true });

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  reactStrictMode: true,
  // Static security headers; the per-request CSP (with nonce) is set in src/proxy.ts.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          ...(process.env.COOKIE_SECURE === 'true' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
        ],
      },
    ];
  },
  images: { unoptimized: true }, // images are already re-encoded (WebP variants) by the API; avoids a second image pipeline and SSRF surface
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};
export default config;
