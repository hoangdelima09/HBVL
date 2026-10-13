import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], environment: 'node', globals: false },
  plugins: [
    // Nest relies on emitted decorator metadata for DI; esbuild (Vitest default) does not emit it.
    swc.vite({
      module: { type: 'es6' },
      jsc: { target: 'es2023', parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } },
    }),
  ],
});
