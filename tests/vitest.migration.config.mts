import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['migration/**/*.spec.ts'],
    environment: 'node',
    globalSetup: ['migration/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: { target: 'es2023', parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } },
    }),
  ],
});
