import html from '@html-eslint/eslint-plugin';
import parser from '@html-eslint/parser';

// eslint-plugin-jsx-a11y does not apply here — there is no JSX. @html-eslint is the
// equivalent static guard for a plain HTML site. It is a cheap pre-commit net; the
// real coverage lives in tests/a11y.spec.js, because most of the barriers on this
// site are behavioural and invisible to any static linter.
export default [
  {
    files: ['**/*.html'],
    ignores: ['node_modules/**'],
    languageOptions: { parser },
    plugins: { '@html-eslint': html },
    rules: {
      '@html-eslint/require-img-alt': 'error',        // 1.1.1
      '@html-eslint/require-lang': 'error',           // 3.1.1
      '@html-eslint/require-title': 'error',          // 2.4.2
      '@html-eslint/no-positive-tabindex': 'error',   // 2.4.3
      '@html-eslint/no-skip-heading-levels': 'error', // 1.3.1
      '@html-eslint/require-button-type': 'error',
      '@html-eslint/require-frame-title': 'error',    // 2.4.1 / 4.1.2
      '@html-eslint/no-abstract-roles': 'error',      // 4.1.2
      '@html-eslint/no-aria-hidden-body': 'error',
      '@html-eslint/require-meta-viewport': 'error',  // 1.4.4
      '@html-eslint/no-duplicate-id': 'error',        // 4.1.1
    },
  },
];
