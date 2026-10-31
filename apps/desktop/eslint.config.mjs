import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import base from '../../eslint.config.mjs';
export default [
  ...base,
  { files: ['src/**', 'test/**'], languageOptions: { globals: { ...globals.browser } } },
  // hook depois de um return antecipado derrubou o app (React #310 ao aparecer a atualização)
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
];
