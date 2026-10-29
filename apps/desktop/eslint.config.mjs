import globals from 'globals';
import base from '../../eslint.config.mjs';
export default [...base, { files: ['src/**', 'test/**'], languageOptions: { globals: { ...globals.browser } } }];
