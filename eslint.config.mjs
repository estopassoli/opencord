// Configuração ESLint compartilhada (flat config). `any` proibido salvo exceção documentada.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      'spikes/**',
      '.tools/**',
      '**/*.config.*',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // consistent-type-imports desativado: quebraria a injeção de dependências do NestJS (metadata de decorators).
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
