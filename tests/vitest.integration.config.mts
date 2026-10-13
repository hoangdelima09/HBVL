import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/**/*.spec.ts'],
    environment: 'node',
    globalSetup: ['integration/support/global-setup.ts'],
    fileParallelism: false, // one shared PostgreSQL/Redis; files run sequentially, tests inside a file share state deliberately
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { TEST_DB_NAME: 'hbvl_test' },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: { target: 'es2023', parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } },
    }),
  ],
});
