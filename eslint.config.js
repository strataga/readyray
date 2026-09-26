import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports', prefer: 'type-imports' },
      ],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
]);
