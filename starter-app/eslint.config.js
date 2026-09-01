import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'android', 'ios', 'mock-backend/dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Architecture rule 4/8: pages and features go through shared/api, never raw fetch.
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use shared/api/client instead.' }],
      // Layer boundaries (FSD): lower layers must not import from higher ones.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@app/*', '@pages/*'], message: 'entities/features/shared must not import app or pages.' },
          ],
        },
      ],
    },
  },
  {
    // app/ and pages/ may import anything below them; relax the boundary rule there.
    files: ['src/app/**', 'src/pages/**', 'src/main.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // shared/ is the bottom layer: it may not import entities or features either.
    files: ['src/shared/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@app/*', '@pages/*', '@entities/*', '@features/*'], message: 'shared/ must not import higher layers.' },
          ],
        },
      ],
    },
  },
  {
    // The API client is the one place raw fetch is allowed.
    files: ['src/shared/api/client.ts', 'src/test/**', 'mock-backend/**'],
    rules: { 'no-restricted-globals': 'off' },
  },
);
