import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      curly: 'error',
      eqeqeq: ['error', 'always'],
      'no-throw-literal': 'error',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // node:test's describe/it return promises the runner already tracks.
      '@typescript-eslint/no-floating-promises': 'off',
      // Test doubles satisfy async interfaces without doing async work.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Tests patch the module loader, which means touching methods unbound.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
