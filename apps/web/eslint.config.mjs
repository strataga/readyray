import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports', prefer: 'type-imports' }],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
    },
  },
);
