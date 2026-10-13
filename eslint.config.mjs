// ESLint flat config shared by every workspace package (run `pnpm lint`).
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/generated/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.runtime/**',
      '**/next-env.d.ts',
      'reports/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'off', // Nest/Prisma patterns
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-control-regex': 'off', // rejecting control characters in user input is intentional
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  // Nest relies on emitted metadata: constructor-injected classes must be value imports.
  { files: ['apps/api/src/**/*.ts'], rules: { '@typescript-eslint/consistent-type-imports': 'off' } },
  // CLIs, scripts and tests print on purpose.
  {
    files: ['apps/api/src/cli/**', 'apps/api/src/migration/**', 'scripts/**', 'packages/database/**', 'tests/**', 'apps/web/scripts/**', 'apps/api/dev.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx,mjs}'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // Client-side hydration (`useEffect(() => { setX(...) })` after mount/fetch) is the pattern used here; these rules target React Compiler adoption.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      '@next/next/no-img-element': 'off', // images come from our own resizing media pipeline (/api/v1/media/:id/:variant)
    },
  },
  { files: ['tests/load/hbvl.js'], languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } } },
  { files: ['tests/e2e/**'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
